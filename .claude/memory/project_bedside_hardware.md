---
name: project_bedside_hardware
description: Hardware shopping list & constraints for the manuBeat bedside data-collection Pi
metadata: 
  node_type: memory
  type: project
  originSessionId: aa2640e5-69dd-4186-affa-0e2fa4e36fce
---

Bedside telemetry hardware for the manuBeat data-collection Pi (see [[project_bedside_pi]], [[project_bedside_server]]).

**The hardware in hand:** Raspberry Pi 4 Model B Rev 1.2, Raspbian 10 (buster), at `pi@raspberrypi.local` (192.168.0.174 on the user's LAN). Mounted board = **Waveshare High-Precision AD/DA Board (ADS1256**, 8-ch 24-bit SPI ADC + DAC8552). NB: this is the *AD/DA Board*, NOT Waveshare's product literally named "High-Precision AD HAT" (that one uses the ADS1263). Onboard demo sensors confirmed by live test: **AIN0 = potentiometer, AIN1 = photoresistor (LDR)**; AIN2–AIN7 float ~2 V. Pins: CS=GPIO22, DRDY=GPIO17, RST=GPIO18, SPI mode 1, on-board 2.5 V ref. SSH key auth from the dev box is installed.

**Pi 5 build variant (planned, UK/GBP):** Full shopping list with vendor links + prices in repo at `docs/pi5-bedside-hardware.csv` (The Pi Hut primary vendor, gathered 2026-06). Core ≈ £291 (Pi 5 8GB £168, 27W PSU £11.50, Active Cooler £4.80, RTC battery £4.80, ADS1256 AD/DA board £33.60, M.2 HAT+ £11.50, 256GB NVMe £57.60); + safety/UPS extras ≈ £410. Key Pi-5-vs-Pi-4 deltas: (1) **onboard RTC** → no DS3231 HAT, just the official rechargeable RTC cell; (2) **PCIe/NVMe** → M.2 HAT+ uses the PCIe FPC ribbon, NOT the 40-pin header, so it does **not** conflict with the ADS1256 HAT (cleanest combo); (3) needs **27W/5A PD PSU**; (4) **active cooling mandatory**. Stacking tension is worse on Pi 5: ADS1256 HAT + UPS HAT + PoE HAT all want the 40-pin header → pick a subset or use stacking headers. The official Pi PoE+ HAT is NOT Pi-5 compatible (use Waveshare PoE HAT G/F).

**Pico (microcontroller) variant explored (2026-06-30):** BOM at `docs/pico-bedside-hardware.csv`. Verdict — a Pico is a great *sensor front-end* (deterministic SPI sampling, no OS = no unclean-shutdown corruption, instant boot) but a weak *full edge gateway* (no Linux → store-and-forward, TLS uplink, OTA fleet mgmt must be hand-rolled; this is what the [[project_bedside_pi]] / manuEdge Python agent already does on a real Pi). Recommended part if pursued: **WIZnet W5500-EVB-Pico2** (£11.20) = RP2350 (520KB RAM, TLS-capable) + hardwired W5500 Ethernet. Core Pico BOM ≈ £48, ≈ £70 with isolation/PoE. Two honest gaps: true patient-safe RS-232 isolation needs a custom ADM3251E board (no breakout), and full-SPI-bus isolation isn't a catalogue part. Best architecture if going this route = **hybrid**: Pico does acquisition, a Pi gateway aggregates + uplinks — not Pico-only.
- Pi 4 → no NVMe/PCIe (that's Pi 5). "SSD" means **USB 3.0 SSD** (Pi 4 boots from USB).
- 40-pin GPIO header is occupied by the ADC HAT → prefer **USB peripherals**; more HATs need stacking headers + vertical clearance. PoE HAT is OK (uses separate 4-pin PoE header).

**The real SD-card killer is unclean power-off, not write volume.** So the plan is: get writes off the SD (USB SSD boot + log2ram + noatime, disable swap) AND never lose power dirtily (UPS with safe-shutdown signal).

**Minimum viable bedside buy:** USB SSD + UPS (safe-shutdown) + official 5V/3A USB-C PSU + RTC module + isolated USB-RS232. Covers won't-corrupt, won't-lose-time, won't-leak-current.

Hospital-specific must-nots-forget:
- **RTC module** — Pi 4 has no battery clock; if NTP is blocked on the biomed VLAN, timestamps reset on reboot. Medical data needs trustworthy time. (DS3231/PCF8523 on I²C, or USB GPS as alt time source.)
- **USB galvanic isolator** — patient-safety, not optional once wired to patient-connected gear; a mains-powered Pi sharing ground creates leakage-current paths (IEC 60601). Also prefer **isolated** RS-232.
- Genuine **FTDI** USB-RS232 (avoid Prolific clones).
- Wired Ethernet / PoE preferred over Wi-Fi for reliability + security.
- Active cooling for 24/7 + stacked HAT; wipeable/mountable enclosure.
