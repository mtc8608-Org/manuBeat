---
name: new-api
description: Add a backend capability end-to-end (table → GraphQL resolver or REST route → permissions → Api.ts wrapper). Use when asked to add an entity, query, mutation, or API endpoint.
---

# New API

Add a backend capability as one vertical slice. The conventions live in `.claude/rules/` — read them first, do not improvise:

- `.claude/rules/backend-api.md` — module layout, auth model, owner-scoping invariant, resolver style
- `.claude/rules/db-schema.md` — init-script conventions, seed UUIDs, reset semantics

## Procedure

1. **Pick the transport.** Entity CRUD → GraphQL resolvers. File upload/download, binary/PDF streaming, or Python orchestration → REST route. Don't build both for the same operation.
2. **Table(s)** — framework tables go in `init-scripts/01-init-db.sql`; domain tables (forks only) in `02-init-<domain>.sql`, per `db-schema.md`. Remember: editing init-scripts means the user must `./run reset` (DB + MinIO wipe) — say so at the end.
3. **Clone the closest existing module**, don't write from scratch:
   - GraphQL → clone the closest module in `schema/resolvers/framework/`; for the `APP_COLS`/`WRITABLE` owner-scoping pattern the reference is manuHunter's `schema/resolvers/jobs/applications.js`. Output types go in `schema/types.js`. Register the module in `schema/index.js` (`Query`/`Mutation` spreads) under the domain's `// [DOMAIN]` banner.
   - REST → `routes/framework/files.js` (files); for Python orchestration the reference is manuHunter's `routes/cv/compile.js`. Register in `backend.js` under the domain banner.
4. **Permissions** — add every new GraphQL operation name to the right tier in `permissions.js` with a `// [DOMAIN]` comment. The `public` tier is frozen (`componentByName` only — never add to it): every other operation requires a valid JWT, and an unlisted operation (query or mutation) is admin-only by default. If it goes in the `registered`/`user` tiers, the resolver **must** owner-scope (non-admin sees/touches only `user_id = ctx.user.id` rows); REST handlers check `req.user` and ownership themselves, comparing `req.user.tier`, never the role name.
5. **Api.ts wrapper** — named function(s) in the domain's section of `pwa/src/services/Api.ts` using the `gql` helper or `http` instance. Pages call these, never raw fetch.
6. **Check upstream relevance** — if any part is framework-generic (not domain-specific), it belongs in manuSpine first, or gets flagged via the `flag-upstream` skill into `.claude/memory/framework-upstream-candidates.md`.
7. **Do not run the app.** Finish by stating the command: `./run reset` if init-scripts changed (note the data loss), plain `./run` otherwise.
