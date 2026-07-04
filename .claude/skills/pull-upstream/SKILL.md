---
name: pull-upstream
description: Merge manuSpine framework updates into this fork and resolve the expected conflicts. Use in a fork (manuHunter, manuBeat, …) when asked to pull/merge framework or upstream updates.
---

# Pull framework updates into this fork

Runs in a **fork**. Brings upstream (manuSpine) changes down with a real merge — **never cherry-pick**. The upstream remote and local clone path are in this fork's CLAUDE.md "Framework upstream" section.

## Procedure

1. **Preflight.** Working tree must be clean (ask the user to commit/stash otherwise). Read the upstream clone's `.claude/memory/framework-upstream-candidates.md` **Landed** section first — its recorded deviations are the map of conflicts you are about to hit.

2. **Merge.**
   ```bash
   git fetch upstream && git merge upstream/master
   ```

3. **Resolve conflicts by file class:**
   - **App-tuned files** — `nodejs/permissions.js`, `nodejs/schema/index.js`, `pwa/src/constants.ts`, seed SQL, `secrets-registry.js`, nav (`Menu.tsx`/`AppHeader.tsx`): these legitimately differ per app. Keep the fork's domain entries/tier placements, take upstream's structural/mechanism changes. Where a Landed entry records a deliberate deviation (e.g. whether a `public` tier exists), the **fork's** stance wins here unless the entry says otherwise.
   - **Framework files** (shell components, `lib/`, framework resolvers/routes, rules/skills): take upstream. If the fork had local edits to a framework file, that's a missed `flag-upstream` — flag it now, then still take upstream and re-apply the fork edit on top.
   - **`framework-upstream-candidates.md`**: take upstream's version (it is the source of truth); re-append any Pending entries that exist only locally.
   - Never resolve by cherry-picking or `--ours`/`--theirs` wholesale across the merge.

4. **Post-merge check, without running the stack** (never execute `./run`/docker):
   - `node --check` on merged `nodejs/**/*.js` files that had conflicts.
   - `npx tsc --noEmit` in `pwa/` — compare against pre-merge if unsure whether an error is new.
   - Grep for leftover conflict markers: `git grep -nE '^(<<<<<<<|=======$|>>>>>>>)'`.

5. **Domain follow-ups.** Upstream changes can demand fork-side work beyond the merge (e.g. new permission tiers need domain ops placed in a tier; new seeded forms may need a domain-shaped replacement). List these; do them only with the user's go-ahead.

6. **Hand off.** Commit the merge, then state the command the user must run: `./run reset` if init-scripts changed upstream (data loss — say so), `./run rebuild <svc>` for Dockerfile/deps changes, plain `./run` otherwise.
