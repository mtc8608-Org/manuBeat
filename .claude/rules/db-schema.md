---
paths:
  - "init-scripts/**"
---

# DB schema conventions

## No migrations — reset only

The schema exists only as `init-scripts/*.sql`, run alphabetically on a **fresh** postgres volume. There is no migration system: to change the schema, edit the init script in place (never write `ALTER` migration files) — the change takes effect only after `./run reset`, which wipes the DB **and MinIO**. Any task that touches `init-scripts/` must end by telling the user to run `./run reset` and noting the data loss. Never run it yourself.

## File layout

- `01-init-db.sql` — framework schema + seeds. In manuSpine, keep it domain-free — changes flow down to every fork via merge (CLAUDE.md "Framework downstream"); in a fork, framework-generic changes belong upstream first.
- `02-init-<domain>.sql` — one file per domain (added by forks); runs after `01`, so framework tables (`users`, `files`, `components`, …) already exist and can be referenced.
- `seed-*.sql` — content seeds; run last alphabetically.

## Table style

- `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`; snake_case tables/columns; `TEXT` over `VARCHAR`; `TIMESTAMPTZ` with `created_at`/`updated_at DEFAULT NOW()`.
- FKs with explicit behaviour: `ON DELETE CASCADE` for owned children and join rows, `ON DELETE SET NULL` for attribution (`files.uploaded_by`).
- `CREATE INDEX` on every FK column used in lookups (`idx_<table>_<col>`).
- File header is a `-- ════` banner block stating what the domain is; sections wrapped in `-- #region` / `-- #endregion` with a one-line comment on intent. Enum-ish TEXT columns list their values in a trailing comment.

## Seed UUIDs

Hardcode every seed UUID that code references (never `uuid_generate_v4()` for those), and keep a stable per-purpose prefix:

- Framework seeds: `c51c1e5f-5cc1-4b77-8832-2d10cc97XXXX`
- Content seeds: `00000000-0000-0000-0000-XXXXXXXXXXXX`
- Domain seeds (in forks): pick one stable prefix per form/group and stick to it (manuHunter's jobs domain uses `aaaaf001-…`/`aaaaf002-…`)

Seed names/UUIDs used by the frontend are mirrored in `pwa/src/constants.ts` with a comment naming the init script as source of truth.

**App-overridable seed names collide.** `components.name` (and other seeded name columns) are UNIQUE, and `ON CONFLICT (id) DO NOTHING` does not cover a name clash — two seeds with the same name abort DB init. So a framework seed that apps are expected to replace under the same name (e.g. `form_user_profile`) can only exist on ONE side: the fork that seeds its own version must delete the framework block during `pull-upstream`, and the ledger entry must say so.

## Owned seed rows

Rows with a user FK are seeded with the owner NULL (the admin user is created by Node at startup, after init scripts run). If a seed must belong to the admin, add an idempotent claim in `backend.js`'s startup block (`UPDATE ... SET owner_id = $admin WHERE owner_id IS NULL ...` — worked example: manuHunter's CV seed ownership block).
