# Memory Index

<!-- One line per memory file. Keep under 200 lines. -->
<!-- Standing rules live in CLAUDE.md; UI conventions in .claude/rules/; procedures in .claude/skills/. -->

- [Framework upstream workflow](project_framework_upstream.md) — manuSpine is the parent framework; use `git fetch upstream && git merge upstream/master` to pull updates into manuBeat
- [Bedside telemetry — hardware](project_bedside_hardware.md) — Pi 4 + Waveshare ADS1256 AD HAT shopping list & hospital hardware constraints
- [Bedside telemetry — server](project_bedside_server.md) — server-side registry/ingest/realtime design for edge Pis streaming device data to manuBeat
- [Bedside telemetry — Pi agent](project_bedside_pi.md) — headless edge-agent architecture (drivers, store-and-forward buffer, dial-out uplink) + ADS1256 working facts
- [Never run ./run](feedback_never_run.md) — never execute ./run/docker yourself; always end by stating which ./run command to use
- [Data Collection domain](project_bedside_domain.md) — bedside admin area: patients=survey answers; bedside_nodes/beds/bed_assignments/patient_files schema
- [ManuLab context](manulab-context.md) — manuSpine is the OSS framework every ManuLab app forks; body-analogy app family; the bigger federated-research vision; manuBeat is the cardio/bedside fork
- [Sibling apps](sibling-apps.md) — pointers to the other apps (manuSpine upstream, manuHunter) and where their memory lives
- [Served multi-user plan](served-multi-user-plan.md) — all ManuLab apps are single-user today but will be served multi-user; never take single-user shortcuts in framework or app design
- [Fork verbatim surface](fork-verbatim-surface.md) — inside `pwa/src` only five wiring surfaces may differ from Spine (App.tsx, constants.ts, types.ts, Api.ts, new `pages/<domain>/`); everything else is verbatim upstream, and the measured app-tuned surface for `nodejs/`/`python/`/`init-scripts/` is recorded too — includes the diff recipe to check a fork
- [Framework sync ledger](framework-upstream-candidates.md) — the Landed sections are the fork-side merge map (per-item deviations + conflict notes) read by pull-upstream; manuBeat merged the whole backlog through `9d05b7a` on 2026-08-27
- [User secrets keychain](user-secrets-keychain.md) — LANDED design record: user_profile + encrypted user_secrets keychain (write-only API, secrets-registry.js) + Users backoffice page; invariants codified in rules/backend-api.md
- [Mobile app path](mobile-app-path.md) — Capacitor removed 2026-07-04 (unused, CVE-carrying); PWA install covers most needs; re-add procedure if a fork ever needs app-store/native APIs
- [EChart owned wrapper](echart-owned-wrapper.md) — chart glue is ours (charts/EChart.tsx), engine stays echarts ^6; echarts-for-react removed; manuBeat swapped its 3 imports in the 2026-08-27 merge
- [Model stack upstream](model-stack-upstream.md) — python/library is a verbatim port of CardioPulmonaryModel's library/; the three deliberate divergences, the sync recipe, and what stayed behind
- [GPU gives no benefit](gpu-no-benefit.md) — POLICY: GPU off by default everywhere; benchmarked 1.7–2.7x SLOWER than CPU for the batched SI calibration
- [Model initialisation](model-initialisation.md) — how Y0 is seeded via stateSetup.configureStates: the injected inputs beyond the structural JSON, and where they come from
- [Model Sandbox schema](model-sandbox-schema.md) — the sandbox is driven by modelSchema.ts, a pure registry mirroring modelGen's dispatch; where to add an equation type, and the config drifts its tests pin
- [SI default migration plan](si-default-migration-plan.md) — inherited upstream plan to make SI the one stack and delete legacy modelClass/modelEq; 0% built
- [Project file tree](project-file-tree.md) — annotated repo map (upstream's; manuBeat adds its bedside/medical/models/surveys dirs); consult before asserting structure or placing files; update in the same commit as any directory add/move/remove
