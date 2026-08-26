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
byte-identical copy of manuSpine.** Scoped to `pwa/src`: the same analysis has
not been done for `nodejs/`, `init-scripts/` or `python/`.

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

## Evidence (2026-08-26)

Checked against both forks ([[sibling-apps]]). **Not one** shell or context diff
was legitimate divergence. manuBeat's `Surveys.tsx` stats tab was an unflagged
fork edit; manuHunter's entire delta was fork-behind.

manuHunter's case is the sharp one, because it was measured rather than eyeballed.
Its `pwa/src` showed **16 findings** — 8 differing framework files (`ImagePicker`,
`AdminRoute`, `AppHeader`, `AreaShell`, `DataTable`, `Menu`, `AuthContext`,
`backoffice/Files`), 3 missing upstream additions (`TierRoute.tsx`, `icons.ts`,
`utils/`), 1 stale fork-only file (`UserRoute.tsx`), and the 4 app-tuned files.
Hashing each differing file against every historical manuSpine blob for its path
placed **all 8 at a specific older upstream commit** — none carried fork content.
And the 16 findings were exactly the 16 `pwa/src` files touched by the 14 upstream
commits it had not merged: a perfect 1:1 — the entire delta is what one
`git merge upstream/master` resolves.

`Menu.tsx` was the only subtle one, and it is worth naming as its own category:
it was upstream-at-`060bbfe` **plus two hand-written nav `<IonList>` blocks**.
Not drift — those blocks were the correct way to add an area *before* `NAV_AREAS`
existed. Legitimate-then, debt-now. When a file moves from app-tuned to verbatim,
the fork's old edits to it do not become violations retroactively; they become
migration work, and the merge is where they turn into data.

That is the whole case for this rule: when a framework file differs, it is
almost always debt, not design — and the way to tell is to check the fork's blob
against upstream's history, not to read the diff and judge it.
