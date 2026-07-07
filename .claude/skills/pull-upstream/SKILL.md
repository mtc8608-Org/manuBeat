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
   - **Fork identity files** — `pwa/index.html` (title, app-name metas), `pwa/package.json` name/description (+ lockfile name fields), `pwa/ionic.config.json`, `.env.example`/`.env.prod.example` (compose project, DB name, MinIO user), `pwa/public/favicon.png`, README branding, and seeded content/figures that carry the app's name or domain imagery: the **fork's** identity always wins. Take upstream's structural changes to these files, but merge them *around* the fork's names/branding — never let a merge rename the app back to the framework. Same rule forward: anything new and user-facing added during the merge or follow-ups is named after the fork, not the framework.
   - **App-tuned files** — `nodejs/permissions.js`, `nodejs/schema/index.js`, `pwa/src/constants.ts`, seed SQL, `secrets-registry.js`, nav (`Menu.tsx`/`AppHeader.tsx`): these legitimately differ per app. Keep the fork's domain entries/tier placements, take upstream's structural/mechanism changes. Where a Landed entry records a deliberate deviation (e.g. whether a `public` tier exists), the **fork's** stance wins here unless the entry says otherwise.
   - **Framework files** (shell components, `lib/`, framework resolvers/routes, rules/skills): take upstream. If the fork had local edits to a framework file, that's a missed `flag-upstream` — flag it now, then still take upstream and re-apply the fork edit on top. After taking upstream for shared rules/skills, scan them for **role-inverting wording** — statements true only in manuSpine ("this repo is the framework", "keep it domain-free", "lives here") that would misdirect a session running in the fork — and re-word those lines fork-side (this is a recorded exception to take-upstream, not drift).
   - **`.claude/memory/`** — split by ownership: the fork keeps `--ours` for its perspective memories (context/sibling/plan files that upstream imported and rewrote from its own viewpoint — these AA-conflict every merge; the fork's viewpoint wins); take upstream for the sync ledger and for genuinely new upstream memory files. `MEMORY.md` is always a hand-merge: keep the fork's index as base, add lines for new upstream arrivals, skip upstream-gitignored ones (they never arrive).
   - **`framework-upstream-candidates.md`**: take upstream's version (it is the source of truth); re-append any Pending entries that exist only locally.
   - Never resolve by cherry-picking or `--ours`/`--theirs` wholesale across the merge.

4. **Post-merge check, without running the stack** (never execute `./run`/docker):
   - `node --check` on merged `nodejs/**/*.js` files that had conflicts.
   - `npx tsc --noEmit` in `pwa/` — compare against pre-merge if unsure whether an error is new. Expect duplicated declarations/blocks where upstream ported the fork's own code to a different file position — resolve by keeping one copy, not by re-placing code.
   - Grep for leftover conflict markers: `git grep -nE '^(<<<<<<<|=======$|>>>>>>>)'`.
   - **Identity sweep** — conflict resolution only sees files that conflicted; new upstream files carrying the framework name merge in silently. `grep -ri manuspine` over the app-facing surface (`pwa/` except `node_modules`, `init-scripts/`, env examples, `nodejs/` user-facing strings) and rename hits to the fork. Deliberate upstream references stay: README fork/upstream sections, `.claude/`, and seed content that *describes* the framework (e.g. a CV entry or "built on manuSpine" credit).
   - Run the **`exposure-auditor`** agent (full auth-surface gate: tiers, owner scoping, REST guards, gate mechanism) and the **`dead-code-auditor`** agent (code orphaned or superseded by the merge). Fix confirmed findings before committing.

5. **Domain follow-ups.** Upstream changes can demand fork-side work beyond the merge (e.g. new permission tiers need domain ops placed in a tier; new seeded forms may need a domain-shaped replacement). List these; do them only with the user's go-ahead. If directories were added/moved/removed, update the fork's `project-file-tree.md` in the same commit.

6. **Hand off.** Commit the merge, then state the command the user must run: `./run reset` if init-scripts changed upstream (data loss — say so), `./run rebuild <svc>` for Dockerfile/deps changes, plain `./run` otherwise.

7. **Close the loop upstream.** In the upstream clone, update the **Fork status** section of `.claude/memory/framework-upstream-candidates.md` (this fork has now merged; note the date and any new deviations recorded during resolution) and commit there. This step lives here because the fork session is the one that knows the merge happened.
