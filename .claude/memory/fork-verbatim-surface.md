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
  | grep -vE '(App\.tsx|constants\.ts|types\.ts|Api\.ts)'
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
was legitimate divergence — manuHunter's were all fork-behind (`ICON_MAP` inlined
before upstream extracted `icons.ts`, hand-rolled CSV link before `downloadBlob`,
`isAdmin`/`isUser` equality before `hasTier`, old `patchFile` signature,
`ImagePicker` before the publish-on-select fix); manuBeat's `Surveys.tsx` stats
tab was an unflagged fork edit. That is the whole case for this rule: when a
framework file differs, it is almost always debt, not design.
