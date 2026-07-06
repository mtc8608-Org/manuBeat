# Memory Index

<!-- One line per memory file. Keep under 200 lines. -->
<!-- Standing rules live in CLAUDE.md; UI conventions in .claude/rules/; procedures in .claude/skills/. -->

- [User: Manuel](user-manuel.md) — senior full-stack/PhD; treat as senior, no trailing summaries
- [ManuLab context](manulab-context.md) — manuSpine is the OSS framework every ManuLab app forks; body-analogy app family; the bigger federated-research vision; keep this repo domain-free
- [Sibling apps](sibling-apps.md) — pointers to the forks (manuHunter, manuBeat) and where their memory lives
- [Served multi-user plan](served-multi-user-plan.md) — all ManuLab apps are single-user today but will be served multi-user; never take single-user shortcuts in framework or app design
- [Idea ledger](idea-ledger.md) — local-only, gitignored: brainstorm verdicts (adopted / parked / rejected) with the deciding argument and next step; written by the `brainstorm` skill
- [Deployment plan](deployment-plan.md) — local-only, gitignored (personal infra): Hetzner hosting decisions and provisioning walkthrough; platform layer LIVE since 2026-07-06 (Caddy + wildcard cert on manu-01, zero apps mapped); next: manuSpine prod compose behind it
- [Framework sync ledger](framework-upstream-candidates.md) — the 2026-07-02 manuHunter port is fully landed; the Landed section is now the fork-side merge map (per-item deviations + conflict notes) read by pull-upstream; Pending holds future flag-upstream entries; neither fork has merged the batch yet
- [User account keychain plan](user-account-keychain-plan.md) — port spec: user_profile + encrypted user_secrets keychain (write-only API, secrets-registry.js) + Users backoffice page; shipped in manuHunter 2026-07-02
- [Mobile app path](mobile-app-path.md) — Capacitor removed 2026-07-04 (unused, CVE-carrying); PWA install covers most needs; re-add procedure if a fork ever needs app-store/native APIs
- [EChart owned wrapper](echart-owned-wrapper.md) — chart glue is ours (charts/EChart.tsx), engine stays echarts ^6; echarts-for-react removed; manuBeat must swap 3 imports on next pull-upstream
- [Project file tree](project-file-tree.md) — annotated repo map; consult before asserting structure or placing files; update in the same commit as any directory add/move/remove
