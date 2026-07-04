# Memory Index

<!-- One line per memory file. Keep under 200 lines. -->
<!-- Standing rules live in CLAUDE.md; UI conventions in .claude/rules/; procedures in .claude/skills/. -->

- [User: Manuel](user-manuel.md) — senior full-stack/PhD; treat as senior, no trailing summaries
- [ManuLab context](manulab-context.md) — manuSpine is the OSS framework every ManuLab app forks; body-analogy app family; the bigger federated-research vision; keep this repo domain-free
- [Sibling apps](sibling-apps.md) — pointers to the forks (manuHunter, manuBeat) and where their memory lives
- [Served multi-user plan](served-multi-user-plan.md) — all ManuLab apps are single-user today but will be served multi-user; never take single-user shortcuts in framework or app design
- [Idea ledger](idea-ledger.md) — brainstorm verdicts: adopted / parked / rejected ideas with the deciding argument and next step; written by the `brainstorm` skill
- [Deployment plan](deployment-plan.md) — local-only, gitignored (personal infra): Hetzner hosting decisions, provisioned infra walkthrough, self-test commands, and the open prod-compose/Caddy/consolidation design
- [Framework sync ledger](framework-upstream-candidates.md) — the 2026-07-02 manuHunter port is fully landed; the Landed section is now the fork-side merge map (per-item deviations + conflict notes) read by pull-upstream; Pending holds future flag-upstream entries; neither fork has merged the batch yet
- [User account keychain plan](user-account-keychain-plan.md) — port spec: user_profile + encrypted user_secrets keychain (write-only API, secrets-registry.js) + Users backoffice page; shipped in manuHunter 2026-07-02
