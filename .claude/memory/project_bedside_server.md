---
name: project_bedside_server
description: Server-side architecture for the manuBeat bedside telemetry / device data-collection system
metadata: 
  node_type: memory
  type: project
  originSessionId: aa2640e5-69dd-4186-affa-0e2fa4e36fce
---

Server-side design for the manuBeat bedside telemetry system (edge Pis stream medical-device data to the server → DB; frontend shows connected Pis + live data). See [[project_bedside_pi]] and [[project_bedside_hardware]].

**Core mental model:** a fleet of edge agents that **buffer locally and dial home**. Server is a **registry + ingest + realtime fan-out**. Two driving principles: (1) edge buffers, never blocks — zero data loss is the bar; (2) **Pi dials out, server never reaches in** (biomed VLANs are firewalled; outbound-only is easier to get through hospital security).

**Slots into manuBeat's domain pattern** (`02-init-<domain>.sql`, `routes/<domain>/`, `resolvers/<domain>/`, frontend pages). New domain name: **`telemetry`** (or `edge`).

Server pieces to build:
- **Enrollment/registry API** — Pis register, get identity + per-device credentials (tokens or mTLS, separate from the human JWT/admin/user roles).
- **Ingest service** — accepts streams, validates, **dedupes** (on `node_id + device + channel + seq/timestamp` → idempotent backfill), writes. NOTE: per CLAUDE.md, **Python is computation-only, no DB writes** → ingest + persistence stay in **Node**; Python is for signal processing/feature extraction.
- **Data model** — `edge_nodes`, `devices`, `channels`, `patients`/`encounters` (patient–bed–Pi binding over time — the hardest modeling problem; a bed/Pi is reused across patients), `readings` (time-series), `node_heartbeats`, **audit log** (PHI requires it).
- **Time-series storage** — high sample rates dwarf current tables. Options: Postgres **partitioned tables**, **TimescaleDB** extension, or **raw waveforms → MinIO** (already running) + downsampled summaries in PG. Choice driven by expected sample rate (few Hz vs kHz waveforms = very different designs) — STILL TO DECIDE.
- **Realtime fan-out to frontend** — GraphQL **subscriptions** / WS channel. Current `graphql-http` is request/response only; live view needs a WS transport added.

**Frontend (PWA) additions:** Fleet page (list Pis: online/offline from heartbeat, bound patient/bed, devices, last-sample-time, health) reusing `DataTable`/`ResourcePanel`; **Live monitor reuses existing `plot`/`plotGrid` component types + `FormRenderer`**; config UI (sample rates, channel enable, patient/bed binding); alerts (data stopped / offline / out-of-range).

**Open decisions (still to lock):** transport (HTTPS-batched for MVP vs MQTT long-term), storage strategy (above), intended-use boundary (research/monitoring vs clinical → sets regulatory ceiling IEC 62304/MDR/FDA), topology (assume server **on-prem in hospital** for PHI).

**Suggested phasing:** MVP = 1 Pi, ADS1256 only, SQLite buffer → HTTPS-batched → Node ingest → `edge_nodes`/`readings`, Fleet page + 1 live plot. Then harden (heartbeats, store-and-forward backfill, per-Pi auth, patient binding). Then scale (MQTT, RS-232 + LAN drivers, time-series storage, alerts, fleet provisioning).
