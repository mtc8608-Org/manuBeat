---
paths:
  - "nodejs/**"
---

# Backend API conventions

How the Node backend is organised and secured. Applies to every edit under `nodejs/`, not just new endpoints (procedure for new ones: the `new-api` skill).

## Module layout

- **GraphQL resolvers** — `schema/resolvers/<domain>/<things>.js` exporting `{ queries, mutations }`. Merged into `schema/index.js`'s `Query`/`Mutation` field spreads under a `// [DOMAIN]` banner comment. GraphQL output types live in `schema/types.js`.
- **REST routes** — `routes/<domain>/<things>.js` exporting an express router, registered in `backend.js` with `server.use('/api', require('./routes/<domain>/<things>'))` under the same `// [DOMAIN]` banner.
- GraphQL for entity CRUD; REST only for what GraphQL handles badly: file upload/download, binary/PDF streaming, orchestration endpoints that call Python (`routes/framework/files.js`, `routes/framework/compute.js`; fork example: manuHunter's `routes/cv/compile.js`).

## Auth model (how it actually works)

- A JWT middleware in `backend.js` attaches `req.user` (or `null`) to every request, guarantees `req.user.tier` (the roles-table tier resolved at login and carried in the JWT), and always continues; nothing is blocked at the middleware level.
- **All auth checks compare `req.user.tier` / `ctx.user.tier`** ('registered' < 'user' < 'admin'), never the role name — role names live in the `roles` table and alias onto a tier (backoffice Roles page; `new-role` skill). A new check written against `user.role === 'admin'` is a bug.
- **REST routes enforce their own auth**: start handlers with `if (!req.user) return res.status(401)...` (or `tier !== 'admin'` → 403 for backoffice features), and owner/admin checks explicitly (see `files.js`). The only tokenless endpoints are `/login`, `/register`, and the two file-download streams (`<img>` tags cannot carry the auth header) — never add another. `/login` is rate-limited (`express-rate-limit`, failed attempts per IP; keyed on `req.ip` via `trust proxy` in `backend.js`) — keep the limiter attached when editing auth routes.
- **GraphQL enforcement** happens in `schema/index.js` using the `permissions.js` lists, by operation *name*, and is **identical for queries and mutations**. The `public` list is the single anonymous escape hatch and is **frozen**: `componentByName` only, forever (it exists so seeded Landing/CMS content renders anonymously; some forks remove even that). Every other operation requires a valid JWT, then `registered` list → any tier; `user` list → tier user/admin; everything else → admin only. An operation left out of both lists is admin-only by default — including queries. The gate must enforce **every top-level selection** of the operation actually executed (resolved with `getOperationAST`, fragment spreads expanded, fail closed on anything unresolvable) — never only the first selection of the first definition, or a privileged field batched behind an allowed one (or hidden behind a leading fragment definition) executes unchecked. Never simplify it back to a single-name check.
- Because admin is the default, adding an operation is not done until its name is placed in the right `permissions.js` tier with a `// [DOMAIN]` comment. Anything you put in the `registered`/`user` tiers must still owner-scope inside the resolver (admin-tier default protects against cross-role access, not cross-user access).

## The owner-scoping invariant (non-negotiable)

Every operation in the `user` tier must scope rows by owner inside the resolver: non-admin gets `WHERE user_id = ctx.user.id` (or `owner_id`); admin sees all. Reads scope the SELECT or check the fetched row; writes append the scope to the UPDATE/DELETE `WHERE` and error with "not found or not authorised" when zero rows match. Reference implementation: manuHunter's `schema/resolvers/jobs/applications.js`.

## Resolver/route style

- Parameterised `pool.query` only, with explicit casts (`$1::uuid`, `$n::date`). Never interpolate values into SQL.
- Dates/timestamps formatted in SQL with `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` so the frontend gets strings directly (`APP_COLS` pattern).
- Dynamic create/update built from a `WRITABLE` column whitelist — never spread client args into columns.
- One `console.log('-> <Action>', ...)` line at the top of each resolver/handler.
- Errors: resolvers `throw new Error(...)`; REST handlers `res.status(4xx|500).json({ error })` and `console.error` the cause.

## Frontend access

All calls go through `pwa/src/services/Api.ts` — the `gql` helper for GraphQL, the shared `http` axios instance for REST (auth header injected automatically). Export named functions in the domain's section; pages never use raw `fetch`/`axios`.
