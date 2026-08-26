---
paths:
  - "nodejs/**"
---

# Backend API conventions

How the Node backend is organised and secured. Applies to every edit under `nodejs/`, not just new endpoints (procedure for new ones: the `new-api` skill).

## Module layout

- **GraphQL resolvers** — `schema/resolvers/<domain>/<things>.js` exporting `{ queries, mutations }`. Merged into `schema/index.js`'s `Query`/`Mutation` field spreads under a `// [DOMAIN]` banner comment. GraphQL output types live in `schema/types.js`.
- **REST routes** — `routes/<domain>/<things>.js` exporting an express router, registered in `backend.js` with `server.use('/api', require('./routes/<domain>/<things>'))` under the same `// [DOMAIN]` banner.
- GraphQL for entity CRUD; REST only for what GraphQL handles badly: file upload/download, binary/PDF streaming, orchestration endpoints that call Python (`routes/framework/files.js`; fork example: manuHunter's `routes/cv/compile.js`).

## Auth model (how it actually works)

- A JWT middleware in `backend.js` attaches `req.user` (or `null`) to every request, guarantees `req.user.tier` (the roles-table tier resolved at login and carried in the JWT), and always continues; nothing is blocked at the middleware level.
- **All auth checks compare `req.user.tier` / `ctx.user.tier`** ('registered' < 'user' < 'admin'), never the role name — role names live in the `roles` table and alias onto a tier (backoffice Roles page; `new-role` skill). A new check written against `user.role === 'admin'` is a bug.
- **REST routes enforce their own auth**: start handlers with `if (!req.user) return res.status(401)...` (or `tier !== 'admin'` → 403 for backoffice features), and owner/admin checks explicitly (see `files.js`). On multipart routes the same guard must ALSO sit as middleware **before** multer in the route chain (`requireAuth`/`requireAdmin` in `files.js`/`content.js`) — otherwise multer buffers the full body into memory for unauthorised clients before the handler's check fires. Never remove that ordering. The only tokenless endpoints are `/login`, `/register`, and the two file-download streams (`<img>` tags cannot carry the auth header) — never add another. `/login` is rate-limited (`express-rate-limit`, failed attempts per IP; keyed on `req.ip` via `trust proxy` in `backend.js`) — keep the limiter attached when editing auth routes.
- **GraphQL enforcement** happens in `schema/index.js` using the `permissions.js` lists, by operation *name*, and is **identical for queries and mutations**. The `public` list is the single anonymous escape hatch and is **frozen**: `componentByName` only, forever (it exists so seeded Landing/CMS content renders anonymously; some forks remove even that). Every other operation requires a valid JWT, then `registered` list → any tier; `user` list → tier user/admin; everything else → admin only. An operation left out of both lists is admin-only by default — including queries. The gate must enforce **every top-level selection** of the operation actually executed (resolved with `getOperationAST`, fragment spreads expanded, fail closed on anything unresolvable) — never only the first selection of the first definition, or a privileged field batched behind an allowed one (or hidden behind a leading fragment definition) executes unchecked. Never simplify it back to a single-name check.
- Because admin is the default, adding an operation is not done until its name is placed in the right `permissions.js` tier with a `// [DOMAIN]` comment. Anything you put in the `registered`/`user` tiers must still owner-scope inside the resolver (admin-tier default protects against cross-role access, not cross-user access).

## The owner-scoping invariant (non-negotiable)

Every operation in the `user` tier must scope rows by owner inside the resolver: non-admin gets `WHERE user_id = ctx.user.id` (or `owner_id`); admin sees all. Reads scope the SELECT or check the fetched row; writes append the scope to the UPDATE/DELETE `WHERE` and error with "not found or not authorised" when zero rows match.

**Use the shared primitives — do not re-hand-roll them.** `schema/helpers/ownership.js` is the reference implementation: `userId(ctx)`, `isAdmin(ctx)`, `assertOwner(table, id, ctx)`, `assertReadable(table, id, ctx)`, `ownerScope(ctx, params, column)`. Table/column arguments are SQL identifiers and can never be parameterised, so callers pass string literals only — never a value that came from a GraphQL argument or request body.

Two failure modes the primitives exist to prevent:

- **No existence oracle.** Use ONE error message for "row does not exist" and "row belongs to someone else" (`assertOwner`'s `'<Thing> not found or not authorised'`). Splitting them into 404-vs-403 lets an attacker walk ids and learn which are real.
- **Link mutations must authorise BOTH ends.** Asserting write access on the parent is not enough: tree assembly walks `*_relationships` without an owner filter, so linking a child you cannot read exfiltrates its content through the parent. Pair `assertOwner(parent)` with `assertReadable(child)`. The same applies to any mutation that attaches an existing row (a file, an artifact) to something the caller owns — check the attached row's owner too.

## User secrets (keychain)

Per-user API keys live encrypted in `user_secrets` (design record: `.claude/memory/user-secrets-keychain.md`). Three invariants:

- **Write-only over the API.** No GraphQL/REST response ever contains a raw secret value — not to its owner, not to an admin. Responses carry metadata only (`name`, `label`, `isSet`, `last4`, `updated_at`). Never add a query/field that returns plaintext.
- **`lib/secrets.js` is the only code that decrypts.** A route or resolver needing a key calls `getUserSecret(req.user.id, name)`; nothing else touches `ciphertext` or the master key. Never inline crypto elsewhere, and never accept a client-supplied key as an alternative path.
- **Adding a key is one registry entry.** New secret = one `{name, label}` line in `secrets-registry.js` (with a `// [DOMAIN]` comment for app keys) — no migration, no new UI: the Integrations card renders from the `userSecrets` query. `setUserSecret` rejects unregistered names; keep it that way.

## Resolver/route style

- Parameterised `pool.query` only, with explicit casts (`$1::uuid`, `$n::date`). Never interpolate values into SQL.
- Dates/timestamps formatted in SQL with `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` so the frontend gets strings directly (`APP_COLS` pattern).
- Dynamic create/update built from a `WRITABLE` column whitelist — never spread client args into columns.
- One `console.log('-> <Action>', ...)` line at the top of each resolver/handler.
- Errors: resolvers `throw new Error(...)`; REST handlers `res.status(4xx|500).json({ error })` and `console.error` the cause.

## Frontend access

All calls go through `pwa/src/services/Api.ts` — the `gql` helper for GraphQL, the shared `http` axios instance for REST (auth header injected automatically). Export named functions in the domain's section; pages never use raw `fetch`/`axios`.
