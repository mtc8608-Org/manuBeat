---
name: fork-verbatim-surface
description: Inside pwa/src only five wiring surfaces may differ between a fork and manuSpine; everything else is verbatim upstream, with a diff recipe to verify it
metadata:
  node_type: memory
  type: project
---

# The verbatim surface in `pwa/src`

Forks extend the framework; they do not fork it. Inside `pwa/src` that means a
hard split — **five wiring surfaces carry domain content, everything else is a
byte-identical copy of manuSpine.** `pwa/src` is where the rule is sharpest and
where the recipe below applies; the other services have a wider app-tuned
surface, measured under "Beyond `pwa/src`".

## App-tuned — the only files allowed to differ

Take upstream's structural/mechanism changes, keep the fork's entries:

- `App.tsx` — domain `<PrivateRoute>`/`<TierRoute>` registrations.
- `constants.ts` — `ROUTE`, `NAV_AREAS`, `AREA_NAV`, `FORM_ID`, `PANEL_CONFIG`
  domain entries, appended under `// [MY DOMAIN]`. Biggest diff by far, and
  since the tier/nav work it also absorbs what used to be hand-edited in
  `Menu.tsx`/`AppHeader.tsx`.
- `interfaces/types.ts` — domain types appended after the framework shapes.
- `services/Api.ts` — domain wrappers, extra `Domain` keys and their `OPS`
  blocks, appended.
- `pages/<domain>/` — fork-only folders (`jobs/`, `cv/`, `bedside/`, `models/`).
  New directories, never edits to framework pages.

**Appended, not edited.** These four files are app-tuned, not fork-owned: the
allowance is for adding domain entries, not for reshaping the framework blocks
around them. Moving a framework field, specialising a framework comment to a
domain, or inserting stray whitespace in a framework region is drift that buys
a conflict on the next merge for nothing.

## Verbatim — take upstream wholesale, never hand-edit fork-side

- **`components/`, the entire tree** — `charts/`, `content/`, `forms/`,
  `routing/`, `shell/`. Includes the three nav components: `Menu.tsx`,
  `AppHeader.tsx` and `AreaShell.tsx` render from `NAV_AREAS`, so adding an area
  is a `constants.ts` entry, never a component edit.
- **`contexts/`** — `AuthContext.tsx`, `ThemeContext.tsx`. Tier logic
  (`hasTier`, the `ROLE_TIERS` ladder) is framework, not app.
- **`utils/`**
- **`main.tsx`, `setupTests.ts`, `vite-env.d.ts`, `katex-auto-render.d.ts`**
- **`theme/variables.css`** — verbatim *until a deliberate rebrand*. The palette
  is the one legitimate divergence in this list, and it belongs here and nowhere
  else. Both forks are still identical to upstream.
- **`pages/public/`, `pages/user/`, `pages/backoffice/`, `pages/surveys/`** —
  with a caveat: a fork does not have to *have* these pages. Dropping an area it
  does not need is fine (manuBeat has no `pages/user/`, no `Users.tsx`/
  `Roles.tsx`). The rule is **if present, identical** — a framework page that
  exists but differs is debt, a framework page that is absent is a choice.

## Verifying a fork

```bash
diff -rq /home/cabsman/Documents/projects/manuSpine/pwa/src <fork>/pwa/src \
  | grep -vE 'src/(App\.tsx|constants\.ts|interfaces/types\.ts|services/Api\.ts)'
```

Every surviving line is a finding. Read them as:

- `Files … differ` on a verbatim file → either merge debt (fork behind) or an
  unflagged fork edit to a framework file. Both resolve the same way: take
  upstream, re-apply the fork's edit on top, and run `flag-upstream` so the edit
  becomes a port candidate in [[framework-upstream-candidates]].
- `Only in manuSpine/…` → an upstream addition the fork has not merged yet.
- `Only in <fork>/…` → legitimate only for a new `pages/<domain>/` folder or a
  genuinely fork-local domain component; anything else is a missed
  `flag-upstream`.
- A framework page missing from the fork → legitimate, per the caveat above.

The recipe compares working trees, so it also catches a fork that is merely
*behind*. Before reading a pile of findings as drift, check the lag first:
`git fetch upstream && git log --oneline HEAD..upstream/master` in the fork.

## Beyond `pwa/src`

The hard split does not hold outside `pwa/src` — the other services have a wider
app-tuned surface — but the *shape* is the same: a small named set of files
legitimately differs, plus fork-only domain directories. Measured against
manuHunter 2026-08-26. This is observed fact rather than a mandate, but a file
outside these sets that differs is worth the same blob-history check:

- **`nodejs/`** — four app-tuned files: `backend.js` (domain route
  registrations), `permissions.js` (tier placement), `schema/index.js` (resolver
  merge), `schema/types.js` (domain GraphQL types). Plus fork-only
  `routes/<domain>/` and `schema/resolvers/<domain>/`. Everything else — `lib/`,
  framework routes and resolvers, the framework helpers in `schema/helpers/` —
  is verbatim.
- **`python/`** — `api/main.py` (router includes) and `Dockerfile` (domain system
  deps, e.g. TeX Live), plus fork-only `api/domains/<domain>/`. manuBeat widens
  this: `Dockerfile.prod` gains `hdf5-tools` plus `COPY library ./library` /
  `COPY config ./config`, and the fork adds four top-level dirs under `python/`
  (`library/`, `config/`, `run_*/`, `notebookData/`) with `Dockerfile.notebook`
  and `requirements.notebook.txt`. All [MEDICAL]-commented — see
  [[model-stack-upstream]].
- **`docker-compose.yml`** — manuBeat's three deviations, all commented in the file:
  the five MinIO variables handed to the `python` service, the fork-only `jupyter`
  service (both `[MEDICAL]`), and MinIO's host ports moved to `9100`/`9101` because
  9000/9001 collide constantly on a dev box. Only the host side moved — in-network
  MinIO is still `minio:9000`, so `MINIO_PORT` stays 9000. The prod compose has none
  of the three (it publishes no ports at all). A `pull-upstream` merge must keep all
  three and never widen the first.
- **`scripts/`** — fork-only; upstream has no such directory.
- **`init-scripts/`** — `01-init-db.sql` and `seed-landing.sql` (a fork may
  delete a framework seed block that its own richer same-name form replaces, and
  its landing content is its own), plus fork-only `02-init-<domain>.sql` and
  seed files.
- **Fork identity** — `pwa/index.html`, `pwa/package.json` (+ lockfile name
  fields), `pwa/ionic.config.json`, `pwa/public/favicon.png`, `.env*`,
  `README.md`, `CLAUDE.md`, `.gitignore`. Never verbatim: the fork's identity
  always wins.
- **`.claude/`** — rules and skills are framework files taken wholesale, with one
  recorded exception: lines whose wording is role-inverting fork-side ("this repo
  is the framework", "keep it domain-free") are re-worded in the fork. Memory
  splits by ownership — the fork keeps its perspective files, takes upstream's
  sync ledger. Both exceptions are `pull-upstream` step 3, not drift.

## Current state (2026-08-26)

Checked against both forks ([[sibling-apps]]).

- **manuHunter — clean.** After merging through `161e57e` the recipe returns its
  four app-tuned files and its two `pages/cv` + `pages/jobs` folders, nothing
  else; every other file under `pwa/src` is byte-identical to upstream. The
  earlier audit's 16 findings were all closed by that merge.
- **manuBeat — outstanding.** Has not merged since before the port. Its
  `Surveys.tsx` stats tab is an unflagged fork edit and must be flagged, then
  re-applied on top of upstream. Everything else it carries is fork-behind.

Across both forks, **not one** shell or context diff has ever turned out to be
legitimate divergence.

### Known-legitimate exception — read before flagging

manuHunter's `user` rung is **empty by design**: jobs, CV *and surveys* all sit
in `registered`, owner-scoped in the resolvers. So its `App.tsx` keeps surveys on
`PrivateRoute` where upstream uses `TierRoute minTier="user"`, and its
`NAV_AREAS` SURVEYS entry reads `tier: 'registered'`. Nav and route guards mirror
the **fork's** `permissions.js`, never upstream's — a merge that silently takes
upstream's guard here hides a page the fork's own permissions grant. Recorded in
[[framework-upstream-candidates]].

### Two lessons worth keeping

- **Check the blob, not the diff.** manuHunter's 16 findings read like drift and
  were not one bit of it. Hashing each differing file against every historical
  manuSpine blob for its path placed all 8 differing framework files at a single
  older upstream commit, and the 16 findings turned out to be exactly the 16
  `pwa/src` files touched by the 14 commits it had not merged — a 1:1 match with
  what one `git merge upstream/master` resolves. When a framework file differs it
  is almost always debt, not design; blob-history matching is how you prove it
  instead of reading the diff and judging.
- **Legitimate-then, debt-now is its own category.** `Menu.tsx` was
  upstream-at-`060bbfe` **plus** two hand-written nav `<IonList>` blocks — not
  drift, but the correct way to add an area *before* `NAV_AREAS` existed. When a
  file moves from app-tuned to verbatim, the fork's old edits to it do not become
  violations retroactively; they become migration work, and the merge is where
  they turn into data.
