---
name: idea-ledger
description: Brainstorm verdict ledger — ideas adopted, parked, or rejected, each with the deciding argument and its next step
metadata:
  node_type: memory
  type: project
---

# Idea ledger

Written by the `brainstorm` skill (see `.claude/skills/brainstorm/SKILL.md` for
the entry template and lifecycle rules). Adopted ideas graduate to per-topic
`<topic>-plan.md` files or straight to implementation; rejected entries exist
so decisions are not re-litigated.

## Adopted

- **Deploy the ecosystem on Hetzner (2026-07-04)** —
  Context: brainstorm on hosting manuSpine + forks (GPU deferred); infrastructure provisioned same day.
  Verdict: one small Hetzner cloud box (sized from measured ~650 MiB total prod-relevant footprint of two stacks), custom domain delegated to Hetzner DNS for wildcard TLS via DNS-01. Infrastructure provisioned and verified 2026-07-04. Machine, domain, IP, and the provisioning walkthrough live in the **local-only (gitignored)** `deployment-plan.md` — instance details stay out of this public framework repo.
  Next: brainstorm the plan's "Design still open" section (prod compose, Caddy, consolidation), then implement.

## Parked

(none yet)

## Rejected

(none yet)
