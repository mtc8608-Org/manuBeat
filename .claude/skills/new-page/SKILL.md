---
name: new-page
description: Scaffold a new page in pwa/src/pages following the repo page conventions (structure, banners, SplitPageLayout template, registration). Use when asked to create a new page or area.
---

# New page

Scaffold a new frontend page that follows the repo conventions from the start. The conventions themselves live in `.claude/rules/` — read them, do not improvise:

- `.claude/rules/code-reuse.md` — which shell component to use for each need
- `.claude/rules/page-structure.md` — file header, section order, figlet banners, JSX region comments, naming
- `.claude/rules/page-template.md` — the five SplitPageLayout left-column rules

## Procedure

1. **Determine area and page name.** Every page belongs to an area with a single shared `AREA_NAV.<AREA>` list in `pwa/src/constants.ts`. Adding a page to an existing area means appending to that area's *one* list (same order everywhere); a new area gets a new list. Never create a per-page nav variant.
2. **Clone the closest existing page** in `pwa/src/pages/` as the starting point (e.g. list + tabbed detail → `surveys/Surveys.tsx`; list + detail → `backoffice/Files.tsx`). Do not write a page from scratch.
3. **Apply the rules files** listed above: 3-line file header, REFS/STATE/LOAD/HANDLERS/RENDER order, `leftTabs` + `ResourcePanel` `fetcher`/`refreshToken`, right column always a `TabPanel`, modals via `ModalShell` under a `Modals` region comment.
4. **Generate figlet banners** for each major section (column 0, reuse standard names/art):
   ```bash
   npx figlet-cli -f "Block" -w 200 "SECTION NAME" | sed 's/[_|]/█/g'
   ```
   Prefer copying the exact banner blocks from an existing page when the section name matches.
5. **Register the page:**
   - Route in `pwa/src/App.tsx` (`PrivateRoute` or `AdminRoute` per the page's auth requirement).
   - Nav entry in `pwa/src/Menu.tsx`.
   - Constants (`AREA_NAV`, panel configs, form names) in `pwa/src/constants.ts` (forks mark domain entries `// [MY DOMAIN]`).
6. **Do not run the app.** Finish by stating which `./run` command the user must run (per CLAUDE.md "Running the project").
