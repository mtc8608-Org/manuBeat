---
name: new-role
description: Add a user role (runtime or seeded) and make it manageable in the backoffice. Use when asked to add a role, change what a role can access, or wire role-based gating into a feature.
---

# New Role

How the role system works and the procedure for adding roles. Read
`.claude/rules/backend-api.md` (auth model) first if touching enforcement.

## The model (do not redesign it)

- **Roles are rows, tiers are code.** The `roles` table (01-init-db.sql) maps a
  role *name* onto one of three fixed permission tiers: `registered` < `user` <
  `admin`. The tier ladder and the operation→tier lists live in
  `nodejs/permissions.js` + `schema/index.js` and are never edited at runtime.
  A role never grants finer-grained access than its tier.
- **Enforcement compares `tier`, never the role name.** The tier is resolved at
  login (`routes/framework/auth.js` JOINs `roles`) and embedded in the JWT;
  `backend.js` middleware guarantees `req.user.tier` on every request. All
  checks — GraphQL ladder in `schema/index.js`, REST `req.user?.tier !== 'admin'`,
  resolver `ctx?.user?.tier`, frontend `hasTier(min)`/`isAdmin` in `AuthContext` — use
  the tier. Never write a new check against `user.role`; role names are for
  app logic/labels only.
- **Three system roles** (`admin`, `user`, `registered`, `is_system = true`) are
  load-bearing: code references the names (register endpoint, seeds, defaults).
  Their name and tier are immutable and they cannot be deleted (enforced in
  `schema/resolvers/framework/roles.js`).
- **JWT staleness**: role/tier edits reach a user on their **next login**.

## Adding a role at runtime (no code)

The backoffice **Roles page** (`/folder/Roles`, admin-only) creates it: name +
tier + description. It is immediately assignable on the Users page (the role
selects fetch `roleList` and inject via `injectedOptions`). Nothing else needed.

## Adding a seeded role (survives `./run reset`, referenceable from code)

1. `init-scripts/01-init-db.sql`, roles INSERT block: add a row with a
   hardcoded framework-prefix UUID (`c51c1e5f-5cc1-4b77-8832-2d10cc97XXXX`,
   next free `d02X`), `is_system = false` unless code will depend on it.
2. Optionally add the name to `PANEL_CONFIG.USERS.filter.type.options` in
   `pwa/src/constants.ts` — that filter dropdown is static and does NOT pick up
   runtime roles.
3. Tell the user to `./run reset` (DB + MinIO wipe).

## Gating a feature on a role

- **Access control** → put the operation in the right `permissions.js` tier
  (see the `new-api` skill). If the existing tiers can't express it, that is an
  architecture conversation (per-operation grants were deliberately rejected),
  not a hack against role names.
- **App behaviour/UX** (e.g. a `reviewer` role sees a different default page)
  → branching on `user.role` is fine; it is not a security boundary. The
  `user`-tier owner-scoping invariant still applies regardless of role.

## Where everything lives

- Table + seeds + Roles/Users page forms: `init-scripts/01-init-db.sql`
  (`roles`, forms `d030`/`d040`; user forms `d000`/`d010`)
- Resolvers: `nodejs/schema/resolvers/framework/roles.js` (admin-only via
  permissions fallback); type in `schema/types.js` (`RoleType`)
- Login/tier resolution: `nodejs/routes/framework/auth.js`, `nodejs/backend.js`
- Frontend: `pwa/src/pages/backoffice/Roles.tsx`, wrappers in `services/Api.ts`
  (`getRoles`/`createRole`/`updateRole`/`deleteRole`), `ROLE_FORM`/`ROLE_TIERS`
  in `constants.ts`, tier gating in `contexts/AuthContext.tsx`
- The whole system is framework code owned by upstream manuSpine; this fork
  inherits it via merge and only adds app-level roles/gating.
