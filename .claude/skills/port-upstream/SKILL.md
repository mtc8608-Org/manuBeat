---
name: port-upstream
description: Recreate the pending framework-generic changes from framework-upstream-candidates.md into manuSpine (the upstream framework). Use in manuSpine when asked to port/migrate upstream candidates or sync a fork's framework work back.
---

# Port upstream candidates into manuSpine

Runs in **manuSpine**. Recreates the Pending entries of `.claude/memory/framework-upstream-candidates.md` here, reading the fork's source as reference — **never cherry-pick** (CLAUDE.md "Framework downstream"). Fork paths come from that CLAUDE.md section; the entries themselves come from the `flag-upstream` skill.

## Procedure

1. **Read the port list.** Every Pending entry: Where/What/Strip/Decisions/Depends. Build the work breakdown from it.

2. **Classify the deltas — launch `diff-classifier` agents in parallel**, one per area, each told the two repo roots, its area, and the expected changes from the list:
   - frontend components (`pwa/src/components/`)
   - backend + DB (`nodejs/`, `init-scripts/`, env files, `docker-compose.yml`)
   - pages + wiring (`pwa/src/pages/`, `contexts/`, `services/Api.ts`, `constants.ts`, `App.tsx`, `interfaces/`)
   - infra (service Dockerfiles) — fold into backend+DB unless large
   The reports drive steps 4–5; trust their copy-wholesale/exclude/removal flags but spot-check anything surprising.

3. **Resolve Decisions before writing code.** Every `Decisions:` field is a genuine user choice — ask them all up front in one batch (AskUserQuestion / plan questions), never silently pick. Also surface any *deviation* you intend (manuSpine keeping behaviour the fork removed, or vice versa).

4. **Recreate in dependency order, commit per logical unit** (subjects ≤50 chars, no Co-Authored-By):
   shell components → DB init → backend (lib → resolvers/permissions → routes) → frontend auth/Api → pages → wiring (constants/App/nav) → infra.
   Rules of thumb:
   - When a file's full diff is the delta, **copy the file wholesale** from the fork rather than hand-applying hunks.
   - **Port into the same file position as the fork source.** When adding a block the fork already has (functions in `Api.ts`, type fields, exports), place it where the fork placed it — positional drift makes the fork's next merge stack both copies as a duplicated block or duplicate identifier instead of merging clean.
   - **Strip domain residue** per the entry's `Strip:` field — reword comments and seed descriptions to framework-neutral, drop domain op names/packages; never leave fork-domain terms in framework files.
   - **Dual-audience wording in shared `.claude/` files.** Rules, skills, and any doc that forks inherit must read correctly in both repo roles — say "in manuSpine … / in a fork …" instead of "this repo" / "here". A line like "keep this repo domain-free" is role-inverting inside a fork and forces fork-side rewording on every merge.
   - **Never port removals** of things manuSpine relies on (classifier report section f) — e.g. seeding blocks, mounts, public content access.
   - App-level shapes (profile forms, tier placement of ops) are per-app decisions: seed a minimal generic version here, note that forks override. If the generic seed shares a **UNIQUE-constrained name** with the fork's own seed (e.g. `components.name`), the Landed entry must say which side deletes its block — two same-name seeds abort DB init.

5. **Verify without running the stack** (never execute `./run`/docker):
   - Backend: `node --check` every touched `.js` file.
   - Frontend: `npx tsc --noEmit` in `pwa/`; if it errors, re-run against the pre-port commit (`git stash` → tsc → `git stash pop`) to separate pre-existing failures from regressions. Only regressions block.

6. **Update the port list** (upstream copy, this repo): move each ported entry to **Landed** with the date, one or two lines each, and **record every deviation explicitly** — deviations are the conflict map `pull-upstream` uses in the forks. State the **concrete fork-side merge action**, not just the deviation: "fork deletes upstream's d050 block from 01-init-db.sql" is actionable; "fork's seed fields win" leaves the next merge session to rediscover the mechanics. Keep un-ported entries in Pending with a note if partially done.

7. **Hand off.** State the command the user must run: `./run reset` if init-scripts changed, `./run rebuild <svc>` for Dockerfile/deps, `./run rebuild-reset <svc>` for both — and list the manual checks worth doing. Forks pick everything up via the `pull-upstream` skill.
