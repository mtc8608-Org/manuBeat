---
name: project_bedside_pi
description: Pi edge-agent architecture for the manuBeat bedside telemetry system
metadata: 
  node_type: memory
  type: project
  originSessionId: aa2640e5-69dd-4186-affa-0e2fa4e36fce
---

Edge-agent design for the manuBeat bedside Pi (reads medical devices, buffers, streams to server). See [[project_bedside_server]] and [[project_bedside_hardware]].

**Production replaces the VNC/desktop workflow with a headless systemd service.** Two principles: edge buffers & never blocks (hospital network blips → keep sampling, backfill on reconnect, zero data loss); Pi dials OUT (server never reaches in).

Agent layers:
- **Device drivers** — one plugin per device type, common interface (`read() → normalized samples`). The thing that grows over time. ADS1256 (SPI ADC) is the first/prototype driver (working probe + stream scripts already on the Pi: `~/ads1256_probe.py`, `~/ads1256_stream.py`). Next: `pyserial` for RS-232; TCP socket for LAN devices.
- **Sampler/scheduler** — per-device sample rates; **timestamp at the source** (edge time, not arrival time) + monotonic **sequence number** per stream (server dedupes on these).
- **Local buffer (store-and-forward)** — SQLite or on-disk append queue; survives reboots/outages; uplink drains it. THE most important reliability piece. Put it on the USB SSD, not the SD.
- **Uplink client** — outbound TLS, batches + acks, idempotent.
- **Health/heartbeat** — periodic online status, CPU temp, disk free, last-sample-time per device, agent version → the frontend's "is it alive" signal.
- **Config agent** — pulls config from server (which channels, sample rates, **which patient/bed this Pi is bound to**).
- **Watchdog** — auto-restart on crash; boringly reliable + unattended.

**ADS1256 working facts** (from live testing): SPI mode 1, max ~1 MHz, CS=GPIO22 DRDY=GPIO17 RST=GPIO18; STATUS chip-ID nibble reads 3 = ADS1256 confirmed; single-ended read = set MUX `(ch<<4)|0x08` → SYNC → WAKEUP → wait DRDY → RDATA → 3 bytes two's-complement; voltage = `raw * 2*Vref / 0x7FFFFF` with Vref=2.5. Onboard: AIN0=pot, AIN1=photoresistor. Libs present: `spidev`, `RPi.GPIO`, `gpiozero`. `i2c-tools` NOT installed; I²C bus empty.

**SD-wear stopgaps until SSD arrives:** log2ram (logs in RAM), mount `noatime`, disable swap, move SQLite buffer to SSD once present.

**Locked design decisions (2026-06-30 brainstorm):**
- **Unifying data model:** a "segment" = an HDF5 Index Table row (contiguous uninterrupted run of samples; a gap → new entry). The Pi emits two wire record kinds: **TimeseriesSegment** (→ HDF5 `numerics/`/`waves/`) and **Event** (→ `episodic/`/`annotations/`). `summaries/` is server-derived (Python); `patient.info`/`presentation`/`definitions` are server/static. One shared **modality registry** maps `modality → group/hz/units/metric/composite` + quality bits.
- **Buffer backend: RAM-only (`memory`) for now** (volatile, OK for prototype); SSD-WAL is the production target behind a `buffer.backend` config switch.
- **Code delivery: git-pull + systemctl restart** for now (signed-OTA / pre-baked image later). Runtime config is **pulled** by ConfigAgent.
- HDF5 format follows Cabeleira et al. paper at `pwa/public/HDF5 based data format...pdf`. Time bases: Index Table start_time µs since 1/1/1970; quality/episodic/annotation ms since 1/1/1970; summaries Excel days since 1/1/1990.
- **Full written plan lives at `docs/telemetry-bedside-plan.md`** in the repo. Pin shared contracts (Segment/Event schema, modality registry, ingest API, HDF5 mapping) before coding.
- **Pi agent code lives in a SEPARATE repo `manuEdge`** = https://github.com/mtc8608/manuEdge (cloned at `/home/cabsman/Documents/projects/manuEdge`, SSH remote `git@github.com:mtc8608/manuEdge.git`). Python package name `manuedge`. Not in manuBeat: git-pull onto SD-only Pi stays small; own deps (spidev/RPi.GPIO) + cadence; keeps manuSpine upstream merges clean. The **shared contract + docs stay in manuBeat as source of truth**; the agent vendors a copy in `src/manuedge/contract/` with `SCHEMA_VERSION` the ingest endpoint validates. Server-side `telemetry` domain still lives in manuBeat.
- **manuEdge scaffold DONE (2026-06-30, native systemd, not Docker).** Runtime decided native systemd — Docker adds SD wear + SPI/GPIO passthrough fuss without removing host SPI-enable; reserve Docker for the manuBeat server. Layers built: `drivers/` (base + ads1256 prototype, hw imports lazy so it imports on a dev box), `sampler.py` (SegmentAssembler: gap/size/age flush, per-stream seq, quality transitions), `buffer/` (memory backend; sqlite_ssd stubbed), `uplink.py` (httpx HTTPS batch POST to `/api/telemetry/ingest`, idempotent, backoff), `heartbeat.py` (→ `/api/telemetry/heartbeat`), `config.py`/`config_agent.py`, `main.py` (sampler thread + asyncio uplink/heartbeat + sd_notify). Plus `systemd/manuedge.service`, `scripts/firstboot.sh` (blank SD→running: enable SPI, log2ram/noatime/swap-off, clone, venv, install service; per-device `agent.toml` dropped on `/boot/firmware/`), `scripts/deploy.sh` (git-pull+restart), `config/agent.example.toml`, tests (6 passing). Provisioning target: Raspberry Pi OS Lite Bookworm 64-bit (NOT current buster).
- **Self-contained orchestration via `./run`** (mirrors manuBeat's `./run`): `dev` = mock server + synthetic agent together (compose-up equivalent, clean teardown); `mock`/`agent`/`test`/`setup`/`clean`; Pi: `install`/`update`/`logs`/`status`. Builds its own venv on first use. Dev pipeline verified working (synthetic ECG/ABP → mock server prints ingest).
- **`./run flash` = one-command SD baker** ("Imager automated", Linux laptop). Decisions (2026-06-30): network = Ethernet preferred + Wi-Fi fallback (baked NM connection, autoconnect-priority -10); SSH = key-only (bakes ~/.ssh/*.pub, locks password); prompts per card for node_id/hostname, server URL, enrollment token, Wi-Fi; shared defaults remembered in `.run/flash-profile.env` (NEVER secrets). Flow: downloads RPiOS Lite arm64 (cached `.run/images/`), confirms removable device (refuses system disk, ERASE confirm), dd-writes, injects on boot partition: SSH key, Wi-Fi, `dtparam=spi=on`, hostname, per-device `agent.toml`, and `firstrun.sh` hooked via cmdline.txt (Imager `systemd.run=` mechanism). firstrun (1st boot) configures OS+WiFi+user then installs a one-shot `manuedge-bootstrap.service` that on the 2nd (networked) boot clones repo + runs `scripts/firstboot.sh` (SPI, log2ram/noatime/swap-off, venv, install `manuedge.service`, `touch /opt/manuedge/.installed`). Files: `scripts/flash.sh`, `provisioning/firstrun.body.sh`. `--dry-run` verified (artifacts only, no device touched); NOT yet tested on real hardware/boot — validate on first card.
- Also added `synthetic` driver + `scripts/mock_server.py` (stdlib) for hardware-free end-to-end testing.

**P1 COMPLETE & VERIFIED ON REAL HARDWARE (2026-06-30).** Full pipeline live: Pi → ADS1256 (AIN0 pot / AIN1 LDR) → segments → `/api/bedside/ingest` → manuBeat, node online, real ADC data stored. Server is the existing manuBeat **`bedside` domain** (NOT a new telemetry domain): committed manuBeat master `7dabb5a` (ingest+heartbeat REST with device-token Bearer auth, dedupe, `realtime.js` WS hub `/ws/bedside`, `latestSegments`/`bedsideStreams`/`nodeHeartbeats`, patients detached from surveys → first-class `patients` table + app-domain demographic form, Monitor page echarts via WS, Devices node+token UI, 5s auto-refresh). manuEdge master `72d7b79` (flash hardening). pwa runs a **live-reload dev server** (bind-mounted, `serve --external`) so frontend edits hot-reload — no rebuild. manuBeat `./run` uses **sudo** (can't drive headless from agent); bring stack up with `docker compose` directly + clear `.persist` via a root alpine container.

**Hard-won gotchas flashing the real Pi:**
- Latest RPi OS is **Debian 13 (Trixie)**, Lite has **no git** preinstalled → bootstrap must `apt install git` before clone (fixed).
- **Wi-Fi country must be 2-letter ISO (GB), NOT a dialing code (+44)** — invalid regdomain soft-blocks the radio, Pi never connects. Flasher now validates; firstrun re-asserts `iw reg set GB` + `rfkill unblock` every boot before NetworkManager.
- RPi OS first-boot **account wizard** hijacks the console on tty1 → firstrun now disables `userconfig.service`. Also added tty1 **console autologin** (key-only SSH otherwise locks you out when Wi-Fi is down).
- node `node_key` MUST exactly equal the agent's `node_id`; token is per-node (rotate in Devices UI → bake as `enrollment_token`).
- Pi reachable at 192.168.0.174 (MAC dc:a6:32, Pi OUI); laptop 192.168.0.239; SSH **from the laptop** (has the private key), key-only by default.

NEXT: P2 HDF5 archiver (Python→patient file, paper format); map ain0/ain1 to real modalities; consider `[pi]` extra on Trixie (RPi.GPIO may not build — prefer lgpio/gpiozero).
