---
name: seed-content
description: Add or edit seeded CMS content — content pages, cards (contentHtml / contentImage / contentHtmlImage / contentLatex), and their images. Use when asked to add or change landing/content pages or seeded screenshots.
---

# Seed content

Add content pages and cards to the seed SQL so they survive `./run reset`. Read first:

- CLAUDE.md sections "Content / CMS system", "Content seed format", "Seeding content images"
- `.claude/rules/files-storage.md` — seeded-asset invariant (MinIO + `files` row, `seed-*` keys)
- `.claude/rules/db-schema.md` — seed UUID conventions

## Procedure

1. **Edit the content seed file** (`init-scripts/seed-landing.sql` or the relevant `seed-*.sql`). Content UUIDs use the `00000000-0000-0000-0000-XXXXXXXXXXXX` prefix, hardcoded and sequential.
2. **Page node** — a `contentPage` component linked as a child of the root `content_menu` node via `components_relationships(parent_id, child_id, position)`; position sets nav order in `Landing.tsx`.
3. **Cards** — leaf children of the page, position sets display order. `data` JSONB per type:
   - `contentHtml` → `data.html`
   - `contentImage` → `data.src` + `data.alt`
   - `contentHtmlImage` → `data.html` + `data.src`
   - `contentLatex` → `data.html` (HTML with KaTeX math)
4. **Images** — PNG under `pwa/public/` (e.g. `pwa/public/screenshots/`); reference it **only** as the origin-relative `"src": "/api/files/seed-<basename>/download-by-key"`. Never a static path, never an absolute host. The `backend.js` startup block (search `seed-`) seeds each PNG into MinIO + a `files` row on boot.
5. **Verify HTML strings** are valid inside SQL single quotes (escape `'` as `''`) and that every card's parent link and position are present — an unlinked card silently never renders.
6. **Do not run the app.** Finish by telling the user to run `./run reset` (wipes DB + MinIO) to re-run the seeds.
