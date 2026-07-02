# Memory Index

<!-- One line per memory file. Keep under 200 lines. -->
<!-- Standing rules live in CLAUDE.md; UI conventions in .claude/rules/; procedures in .claude/skills/. -->

- [User: Manuel](user-manuel.md) — senior full-stack/PhD; treat as senior, no trailing summaries
- [ManuLab context](manulab-context.md) — manuSpine is the OSS framework every ManuLab app forks; body-analogy app family; the bigger federated-research vision; keep this repo domain-free
- [Sibling apps](sibling-apps.md) — pointers to the forks (manuHunter, manuBeat) and where their memory lives
- [Served multi-user plan](served-multi-user-plan.md) — all ManuLab apps are single-user today but will be served multi-user; never take single-user shortcuts in framework or app design
- [Framework upstream candidates](framework-upstream-candidates.md) — THE PORT LIST: framework-generic code flagged in manuHunter to recreate here (tiers/roles/lockdown, user_profile + secrets keychain, SinglePanelLayout, PdfViewer, FormRenderer lines/code types, DataTable filters, collapsible columns, BuildKit apt cache); `.claude/` layout already landed — note the rules/skills describe the post-port target state
- [User account keychain plan](user-account-keychain-plan.md) — port spec: user_profile + encrypted user_secrets keychain (write-only API, secrets-registry.js) + Users backoffice page; shipped in manuHunter 2026-07-02
