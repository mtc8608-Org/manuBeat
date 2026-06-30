# Bedside Telemetry — Architecture & Build Plan

> Edge Raspberry Pis read medical devices, buffer locally, and dial home to manuBeat,
> which fans data out live and archives it into HDF5 files following the CENTER-TBI
> data format (Cabeleira et al., *HDF5 based data format for archiving complex
> neuro-monitoring data in TBI patients*).
>
> Status: planning. First module = Waveshare ADS1256 ADC. Build the **whole stack
> pluggably** with the ADC as the only loaded driver.

---

## 0. Locked decisions

| Decision | Choice | Notes |
|---|---|---|
| Buffer backend (now) | **RAM-only** (`memory`) | Volatile; acceptable for bench/prototype. SSD-WAL is the production target behind a `buffer.backend` switch. |
| Buffer backend (target) | SQLite WAL on USB SSD | OS page cache keeps the working set in RAM for free; durable across power loss. |
| Code delivery (now) | **git-pull + systemd restart** | We already SSH into the Pi. Signed-OTA / pre-baked image come later. |
| Runtime config delivery | ConfigAgent **pulls** from server registry | Honors "Pi dials out, server never reaches in". |
| Wire protocol (MVP) | HTTPS batched POST | MQTT considered for scale later. |
| Ingest / persistence | **Node** | Per CLAUDE.md: Python is computation-only, no DB writes. |
| HDF5 archiver + summaries | **Python (h5py)** | Writing `.h5` to MinIO/disk is not a DB write → rule respected. |

---

## 1. The unifying insight: a "segment" = an HDF5 Index Table row

The paper models every dataset as a series of **uninterrupted continuous streams**, each
described by an **Index Table** entry: `start_index`, `start_time` (µs since 1/1/1970),
`duration` (sample count), `sampling_frequency` (Hz). A gap → a new entry.

That is exactly what the store-and-forward edge produces: a contiguous run of samples that
ends whenever the sensor drops out or sampling is interrupted. **So we use one data model
end to end** — the Pi emits *segments* that are pre-digested Index Table rows, and the
server's archival step is nearly mechanical: append samples, add one Index row, append
Quality rows.

### Two wire record kinds cover the whole paper

| Wire record | HDF5 destination | Carries |
|---|---|---|
| **TimeseriesSegment** | `numerics/<modality>` (≤1 Hz) and `waves/<modality>` (waveforms; `waves/EEG/<channel>` for composite) | `stream_id`, modality, channel, group, `start_time_us`, `sampling_hz`, `seq`, `samples: float32[]`, `quality: [(offset_or_ts, code)]`, + static `units/metric/location/source` |
| **Event** | `episodic/` and `annotations/` | `code`, `ts_ms`, `duration`, `comment`, `value` |

Server-derived / out-of-band (NOT emitted by the Pi):
- `summaries/` — minute & hour averages → **computation → Python**.
- `patient.info`, `presentation` — from registry / patient-bed binding.
- `definitions` — static: meaning of the quality bitset, index struct, event types. Written once.

### Time conventions (from the paper — keep them exact)
- Index Table `start_time`: **µs** since 1/1/1970.
- Quality Table / episodic / annotations timestamps: **ms** since 1/1/1970.
- Summaries timestamp: Excel serial date (days since 1/1/1990).

> Trustworthy time is load-bearing for the whole Index Table. RTC module (DS3231/PCF8523)
> is required on the Pi if NTP is blocked on the biomed VLAN.

### The modality registry (shared contract)
A single registry maps `modality → { group: numerics|waves, default_hz, units, metric,
composite?: channels[] }` plus the quality-bit definitions. A driver only declares *"I
produce `abp`"*; everything downstream (grouping, units, HDF5 placement, quality decoding)
is looked up. This is the contract the Pi, Node, and Python all share.

---

## 2. Pi edge agent (headless systemd, single asyncio process to start)

```
ModuleManager        loads drivers from config (ads1256 only, for now)
  Driver (iface)     describe() -> modalities/channels ; read() -> raw frames
Sampler/Scheduler    per-stream rate; SOURCE timestamp; monotonic seq;
                     chunks samples into Segments; a gap (DRDY timeout / read error)
                     closes the current segment and opens a new index entry
QualityTagger        per-sample -> quality bitset (clip / saturation / dropout)
                     emitted as quality transitions on the segment
Buffer               store-and-forward, swappable backend (memory | sqlite_ssd | sqlite_sd)
Uplink               outbound TLS, batched, acked, idempotent on (stream_id, seq)
ConfigAgent          pulls config: enabled channels, rates, patient/bed binding
Heartbeat            online, CPU temp, disk free, last-sample-time/stream, agent version
Watchdog             systemd Restart=always + sd_notify
```

### Driver interface (the part that grows over time)
```python
class Driver:
    def describe(self) -> list[StreamSpec]: ...   # modality, channel, hz, units...
    def start(self) -> None: ...
    def read(self) -> Iterable[RawFrame]: ...      # blocking SPI read in a thread
    def stop(self) -> None: ...
```
ADS1256 driver = thin refactor of `~/ads1256_probe.py` + `~/ads1256_stream.py` into this
interface. Working facts: SPI mode 1, ~1 MHz, CS=GPIO22, DRDY=GPIO17, RST=GPIO18, Vref=2.5;
single-ended read = set MUX `(ch<<4)|0x08` → SYNC → WAKEUP → wait DRDY → RDATA → 3 bytes
two's-complement; `V = raw * 2*Vref / 0x7FFFFF`. Bench sensors: AIN0=pot, AIN1=LDR.
Channel→modality mapping is **config**, so bench sensors map to real modalities with no
code change.

### Buffer (RAM-only now)
- Interface: `append(records)`, `drain(batch) -> ids`, `ack(ids)`.
- `memory` backend now: in-process deque / `:memory:` SQLite. **Volatile** — power blip loses
  the unacked window. Acceptable for prototype; documented limitation.
- `sqlite_ssd` backend later: `journal_mode=WAL`, `synchronous=NORMAL`, large batched commits,
  file on the USB SSD. Drop-in via config.
- Mitigations regardless: log2ram, `noatime`, swap off, UPS with safe-shutdown.

### Uplink
- Outbound HTTPS batch POST to the server ingest endpoint.
- Idempotent: server dedupes on `(node_id, stream_id, seq)` → safe to retry/backfill.
- Never blocks the sampler: on failure, records stay in the buffer; sampling continues.

---

## 3. Server side — new manuBeat `telemetry` domain

Follows the domain pattern (`init-scripts/02-init-telemetry.sql`, `routes/telemetry/`,
`schema/resolvers/telemetry/`, `python/api/domains/telemetry/`, PWA pages).

### Node (ingest + persistence + realtime)
- **Enrollment/registry API** — Pi self-enrolls with a one-time token, gets device identity
  + credentials (mTLS or device token, separate from human JWT roles).
- **Ingest endpoint** — accepts batches, validates, **dedupes** on `(node_id, stream_id,
  seq)`, writes to hot store, acks.
- **Realtime fan-out** — WS / GraphQL subscriptions (needs a WS transport added; current
  `graphql-http` is request/response only).
- **Data model** — `edge_nodes`, `devices`, `channels`, `patients`/`encounters`
  (patient↔bed↔Pi binding over time — the hard modeling problem; a bed/Pi is reused across
  patients), `readings` (hot time-series), `node_heartbeats`, `audit_log` (PHI requires it).

### Python (computation only)
- **HDF5 archiver** (h5py) — consumes ingested segments/events, appends to per-modality
  datasets, maintains **Index Table** + **Quality Table** per dataset, ScaleOffset
  compression for time-series, GZip-6 for summaries. Writes `definitions` once, root
  attributes, `patient.info`/`presentation` from the binding. Output `.h5` → MinIO/volume.
- **Summaries** — minute & hour averaging → `summaries/` group.

### Frontend (PWA)
- **Fleet page** — list Pis: online/offline (from heartbeat), bound patient/bed, devices,
  last-sample-time, health. Reuse `DataTable` / `ResourcePanel`.
- **Live monitor** — reuse existing `plot` / `plotGrid` component types + `FormRenderer`,
  fed by the WS stream.
- **Config UI** — sample rates, channel enable, patient/bed binding (writes registry the
  ConfigAgent pulls).
- **Alerts** — data stopped / offline / out-of-range.

---

## 4. HDF5 file layout (target archival format)

```
JohnDoe_<date>.h5            root attrs: most important metadata
├── numerics/                ≤1 Hz, 1-D float32, per modality
│   ├── etco2, spo2, pbto2, hr, temperature ...
│   └── (attrs per dataset: Index Table, Quality Table, Units, Location, Metric, Modality, Source)
├── waves/                   waveforms, 1-D float32, per modality
│   ├── abp, icp, ecg, cvp ...
│   └── EEG/  ECoG/          composite group: one dataset per channel (EEG.O1 ...)
├── summaries/               composite [Excel-ts, 1xN float32]; minute + hour datasets
├── episodic/                composite [Code, ts_ms, Duration, Comment, Value]
├── annotations/             composite [Code, ts_ms, Duration, Comment]
├── definitions/             eventTypes, indexStruct, qualityRef, qualityStruct
├── patient.info  (dataset)  [Field, Value] string pairs (demographics)
└── presentation  (dataset)  [Field, Value] string pairs (non-identifying clinical)
```
Index Table row: `[start_index i64, start_time_us i64, duration i64, sampling_hz f64]`.
Quality Table row: `[ts_ms u64, code u32]` (bitset valid until next entry).

---

## 5. Delivery to the Pi (two separate channels)

1. **Runtime config** — ConfigAgent pulls from the server registry on boot + periodic poll.
   Pi identifies via `device_id` + enrollment token. Outbound-only.
2. **Code** — *now:* git-pull on the Pi + `systemctl restart`. *Later:* signed-OTA bundle
   over the uplink (watchdog applies/rolls back — the only update path honoring
   "server never reaches in"), and/or a pre-baked pi-gen image with first-boot self-enroll
   for fleet provisioning.
3. **Identity/secrets** — first-boot enrollment: Pi generates a keypair, registers with a
   one-time token (QR/printed per device), server issues a device cert → mTLS thereafter.

---

## 6. Phasing

- **P0 — ADC driver.** Refactor probe/stream into the `Driver` interface emitting Segments.
  Local only; print/plot to verify.
- **P1 — end-to-end one channel.** Buffer (`memory`) + Uplink (HTTPS batch) + minimal Node
  ingest (store raw + ack + dedupe) + one live plot on a Fleet page.
- **P2 — HDF5 archiver.** Python/h5py: Segments → datasets + Index/Quality tables (the paper
  structure). Round-trip a recording.
- **P3 — production skeleton.** ConfigAgent, Heartbeat, Watchdog, WS live view, patient/bed
  binding, mTLS enrollment.
- **P4 — scale.** Summaries, more drivers (RS-232 via isolated FTDI, LAN/TCP), image + signed
  OTA provisioning, alerts, SSD-WAL buffer flip.

---

## 7. Shared contracts to pin before coding (do first)

These are the interfaces everything depends on; lock them once:
- **Segment** and **Event** wire schemas (field names, types, units, time bases).
- **Modality registry** schema (`modality → group/hz/units/metric/composite` + quality bits).
- **Ingest API** request/response (batch shape, ack/dedupe keys, error/backoff contract).
- **HDF5 mapping** table (modality → group/dataset path; quality bit meanings → `definitions`).
