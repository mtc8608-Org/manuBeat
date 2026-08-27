---
paths:
  - "nodejs/**"
  - "init-scripts/**"
---

# File storage conventions

## The invariant

Every stored file is a **MinIO object + a `files` row**, always both (`files` has `UNIQUE(bucket, key)`; `uploaded_by` records the owner). Never write files to the container filesystem, never put an object in MinIO without a `files` row, never store binary data in Postgres. The single exception: seeded/generated *content images* may be keyed MinIO objects served by `download-by-key` (below) — `backend.js` still inserts `files` rows for them at startup.

All file endpoints live in `routes/framework/files.js`; domain code reuses them rather than growing its own storage layer.

## Write / delete ordering

- **Upload**: `putObject` to MinIO first, then `INSERT INTO files`; if the insert fails, remove the MinIO object (rollback pattern in `files.js`). Keys are `` `${randomUUID()}-${originalname}` `` so filenames never collide.
- **Delete**: check ownership, delete the `files` row first (FK cascades detach link tables), then `removeObject` best-effort — a MinIO failure after the row is gone is a warning, not an error.

## Linking files to domain entities

Domain tables never store keys/paths — they join to `files(id)` through a link table with `ON DELETE CASCADE` on both sides (fork examples: manuHunter's `application_files`, `cv_artifacts`), optionally with a `kind` column. Uploading and linking are separate steps: `POST /api/files/upload` first, then a domain mutation records the association.

## Access and scoping

- `GET /api/files` — owner-scoped list (`uploaded_by = user`, admin sees all); delete is owner-or-admin.
- `GET /api/files/:id/download` — DB-row lookup, streams from MinIO with the stored mime/filename.
- `GET /api/files/:key/download-by-key` — same, resolved by the stable key known at seed time. It **must** go through the `files` table: reading MinIO directly would serve any object whose key is guessed, with no row to carry `is_public` or an owner.

### `is_public` — the content-asset flag

Both download routes are tokenless **only** for rows with `is_public = true`; everything else requires the owner or an admin, and answers with one message (`File not found or not authorised`) for missing and foreign rows alike so ids cannot be walked.

`is_public` means "this is CMS content" — it exists because an `<img>` tag cannot send the auth header and seeded/CMS images must render for anonymous visitors on Landing. Exactly **three** code paths set it, and a plain upload is never one of them:

1. the `/public` PNG seed scan in `backend.js`,
2. generated content images in `routes/framework/content.js`,
3. `ImagePicker` when an admin selects a file as a content image.

Never default it true, never set it on a user upload path, and never add a fourth writer without the same reasoning. Downloads also send `X-Content-Type-Options: nosniff` and serve anything outside a small inline allowlist (images + PDF) as `attachment` — an uploaded `.html` or scripted `.svg` must never execute on the app origin, where the JWT lives in `localStorage`.

## Seeded assets

Seed images as PNGs under `pwa/public/` (mounted read-only at `/public` in the nodejs container); the `backend.js` startup scan seeds each as MinIO key `seed-<basename>` with a `files` row (`ON CONFLICT DO NOTHING`), so they survive `./run reset`. Seed SQL references them **only** as the origin-relative `/api/files/seed-<filename>/download-by-key` — never as static paths like `/screenshots/foo.png`, and never with an absolute host (the same seed must work in dev behind the vite proxy and in prod behind Caddy).
