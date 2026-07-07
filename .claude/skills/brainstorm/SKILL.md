---
name: brainstorm
description: Structured brainstorm lifecycle — explore an idea (feature, architecture, deployment) in dialogue, record the verdicts in the idea ledger, and grow adopted ideas into update plans. Use when asked to brainstorm/think through something, to "record that decision", or to turn a decided idea into a plan.
---

# Brainstorm → record → plan

One lifecycle, three stages. Enter at whichever stage the request names: a
brainstorm request starts at **Explore**; "record this" jumps to **Record**;
"make a plan for X" jumps to **Plan**. This skill writes only ledger and plan
files under `.claude/memory/` — never code, and never the harness auto-memory.

Runs in manuSpine and in forks (it flows down via merge). The ledger and plans
are always the **current repo's** `.claude/memory/` — each app keeps its own.

## Stage 1 — Explore

A dialogue, not a report. Present a small number of genuinely different options
with tradeoffs, take a position, and push back when an option conflicts with
the constraints below. Do not start implementing anything.

Ground the discussion before opining:
- UI ideas → `ui-composer` (fan out 2–3 with different biases for real
  divergence) or the `which-component` skill.
- Anything non-trivial in-repo → `pattern-scout` for the closest existing
  pattern; `slice-mapper` when the idea spans layers.
- External topics (deployment targets, hosting, tooling) → web search, or the
  `deep-research` skill if the user wants depth.

Standing constraints every brainstorm must respect:
- manuSpine stays domain-free; domain ideas belong in forks. In a fork, note
  when the generic core of an idea would be `flag-upstream` material.
- No single-user shortcuts (`served-multi-user-plan.md`).
- Forks pull framework updates by merge, never cherry-pick — weigh migration
  cost on forks for any framework-shape change.

Close the stage explicitly: list the verdicts reached and ask which to record.
Never write to the ledger silently.

## Stage 2 — Record

Verdicts live in `.claude/memory/idea-ledger.md` under three sections:
**Adopted** (good idea, awaiting plan or implementation), **Parked** (maybe
later; record what would unpark it), **Rejected** (record *why*, so it is not
re-litigated in a future session).

Entry template (absolute dates, no relative ones):

```markdown
- **<Title> (<YYYY-MM-DD>)** —
  Context: <one line: what prompted the idea>
  Verdict: <what was decided and the deciding argument>
  Next: <plan file to write / implement directly / trigger condition — "none">
```

- If a new verdict supersedes or extends an existing entry, merge them; when an
  idea changes section (parked→adopted, adopted→implemented), move the entry
  and keep its history in one place.
- When an adopted idea is implemented, annotate the entry with the commit or
  delete it if the code now tells the whole story.
- Update the ledger's line in `MEMORY.md` only if its one-line hook no longer
  fits.

## Stage 3 — Plan

Grow an **Adopted** entry into a per-topic plan file
`.claude/memory/<topic>-plan.md`, following the existing plan files
(`served-multi-user-plan.md`, `user-secrets-keychain.md`): memory
frontmatter (`type: project`), then goal, decisions already made (link the
ledger entry), the design at implement-from-this detail, open decisions, and
implementation order. Use `slice-mapper` or the `Plan` agent to ground the
file list before writing the order.

Quality bar (same as `flag-upstream`): the plan may be executed months later by
a session that never saw the discussion — it must carry the intent and the
judgment calls, not just name the feature.

After writing: add the plan's index line to `MEMORY.md` and set the ledger
entry's `Next:` to point at the plan file.
