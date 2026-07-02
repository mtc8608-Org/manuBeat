---
name: user-account-keychain-plan
description: Design of the framework-level user_profile + user_secrets keychain (encrypted, write-only API keys) and the Users backoffice page — shipped in manuHunter 2026-07-02, port spec for manuSpine
metadata:
  node_type: memory
  type: project
---

# User account: framework-level user_profile + user_secrets keychain

Designed and **implemented in manuHunter 2026-07-02** (all six steps; the deferred admin-keychain-status column remains deferred). This file is the design spec for porting it into manuSpine — it is on the port list ([[framework-upstream-candidates]]). Driven by [[served-multi-user-plan]]: no single-user shortcuts. manuHunter file references below (cv_profile, `03-init-cv.sql`, content.js AI import) describe where it was built; in manuSpine everything lands in framework files, and the profile *form shape* stays app-level.

## Design decisions (settled)

Three framework tables with three temperaments:

1. **`users`** — auth only (unchanged). Admin-managed, fixed columns; self-service writes never touch it.
2. **`user_profile`** — display data (`owner_id UUID UNIQUE NULL` FK cascade, `data JSONB`). JSONB because the shape is form-driven and mutates: the framework ships table + plumbing, each app defines the profile *shape* via its seeded FormRenderer form. Freely echoed to forms/prompts. NULL-owner seed row + startup admin re-stamp.
3. **`user_secrets`** — the keychain. One row per (user, secret); adding a future key is a registry entry, never a migration:

```sql
CREATE TABLE user_secrets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,          -- registry-validated, e.g. 'anthropic_api_key'
    ciphertext  BYTEA NOT NULL,         -- nonce ‖ auth tag ‖ AES-256-GCM ciphertext
    last4       TEXT,                   -- computed once at write time, for masked display
    key_version SMALLINT NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, name)
);
```

- `owner_id NOT NULL` (unlike `user_profile`): secrets are **never seeded**, so no NULL-claim row.
- **Write-only over the API**: queries return `{name, label, isSet, last4, updated_at}` only; the raw value never appears in any GraphQL/REST response, not even to its owner or an admin. Admin lifecycle = see set/unset, clear; never read.
- **Self-scoping via no-owner-argument resolvers**: operations take no owner id, resolve `userId(ctx)` from the JWT — ownership violation is unexpressible.
- **Encryption**: AES-256-GCM, per-row random 12-byte nonce, master key from `SECRETS_MASTER_KEY` env var (32 bytes, in `.env` — nodejs uses `env_file: .env`). `key_version` enables master-key rotation without all-or-nothing re-encryption. `last4` stored at write time so display never decrypts.
- **One decrypt choke point**: `nodejs/lib/secrets.js` — `setUserSecret(ownerId, name, value)`, `getUserSecret(ownerId, name)` (the ONLY code that decrypts), `clearUserSecret`, `listUserSecrets` (metadata only). Server routes needing a key call `getUserSecret(req.user.id, ...)`.
- **Registry**: `nodejs/secrets-registry.js`, sibling of `permissions.js` (same framework-config idiom, apps extend with `// [MY DOMAIN]` entries). Entries `{name, label}`; starts with `{name: 'anthropic_api_key', label: 'Anthropic API Key'}`. `setUserSecret` rejects unknown names. The frontend does NOT duplicate the registry — the `userSecrets` query returns registry ⋈ per-user status and the Account Integrations card renders from it.

## Users backoffice area (moved out of Account)

User management leaves `Account.tsx` and becomes an admin page `pwa/src/pages/backoffice/Users.tsx`, so Account is purely self-service (Profile, Integrations, Change Password). Standard template (`.claude/rules/` page-template + code-reuse):

- `ROUTE.USERS` behind `AdminRoute`; entry in `AREA_NAV.BACKOFFICE` (the single shared list, same order on every backoffice page) and in Menu's Backoffice section.
- **Left**: one-tab `leftTabs` with `ResourcePanel` — `fetcher: getUsers` + `refreshToken`, free-text filter on email + type filter on role, badges for status AND role (needs the `getBadge` `Badge | Badge[]` extension, also on the port list), `onAdd` for the create button.
- **Right**: one-tab `TabPanel` ("Detail") — editor for the selected user via FormRenderer on a seeded framework form `form_user_editor` (role select, is_active check; email read-only above it) saved with `patchUser`; `EmptyState` when unselected.
- **Create**: `onAdd` → `ModalShell` + FormRenderer on seeded `form_user_create` (email, password, role) → `createUser`.
- Both form trees seed in `01-init-db.sql` (`c51c1e5f` framework range, d000/d010). Backend needs little: `GET/POST/PATCH /users` already exist in `routes/framework/auth.js`.
- **Later** (explicitly deferred): the Detail column shows the selected user's keychain status (registry ⋈ set/unset, admin clear button, never read) — the admin half of the secret-lifecycle rule.

## Acceptance criteria (for the port)

- Fresh reset boots; admin claims the seed profile row in `user_profile`.
- Account page: Profile card edits via FormRenderer; Integrations card can set and clear the Anthropic key; after save, no network response ever contains the raw key (only `last4`).
- A DB dump exposes only ciphertext; `grep` confirms decryption happens solely in `lib/secrets.js`.
- Adding a hypothetical second key = one `secrets-registry.js` line + nothing else (no migration, no new UI code).
- Users backoffice page: list filters by email text and role, shows status + role badges, add button creates a user via modal, Detail edits role/active; Account no longer shows any admin card.
