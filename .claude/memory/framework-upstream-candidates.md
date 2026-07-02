---
name: framework-upstream-candidates
description: Port list — framework-generic changes built in manuHunter that must land here in manuSpine; tick items off as they are ported
metadata:
  node_type: memory
  type: project
---

# Framework upstream candidates (port list from manuHunter)

Changes built in **manuHunter** (`/home/cabsman/Documents/projects/manuHunter`) during
its CV-builder work that are framework-generic and belong here in manuSpine so all
derived apps get them. Domain code (the CV builder, jobs) stays in manuHunter — only
the reusable primitives below come up. File paths below refer to the manuHunter repo,
where the flagged code lives; recreate each change here (don't cherry-pick — see
CLAUDE.md "Framework downstream"), then manuHunter merges `upstream/master`.
Tick items off as they land.

## Landed in manuSpine

- ✅ **`.claude/` config layout (rules/, skills/, CLAUDE.md sections)** — ported 2026-07-02:
  path-gated conventions in `.claude/rules/` (`backend-api`, `code-reuse`, `db-schema`,
  `files-storage`, `forms-ui`, `page-structure`, `page-template`, `python-compute`),
  skills in `.claude/skills/` (`new-api`, `new-compute`, `new-form`, `new-page`,
  `new-role`, `seed-content`, `which-component`), and always-on rules (never-run,
  git style, knowledge locations, downstream workflow, reference project) as CLAUDE.md
  sections. Note: the rules/skills describe the **post-port target state** (tiers,
  roles, SinglePanelLayout, PdfViewer, …) — until the items below land, some referenced
  files don't exist here yet.

## Pending (from manuHunter CV builder work, 2026-07)

- **FormRenderer `lines` field type** — added a `lines` case to the shared
  `pwa/src/components/forms/FormRenderer.tsx` (switch at ~L90, `renderLines` at ~L216):
  edits a `string[]` as a multi-line textarea (join on `\n` for display, split on
  `\n` for value). Purely additive, no risk to existing types. Generic form-library
  capability — clear upstream. Was needed for CV entry bullets.

- **PdfViewer shell component** — `pwa/src/components/shell/PdfViewer.tsx`: renders a PDF
  from a `Blob` (owns the object-URL lifecycle) or a `src` URL, falls back to `EmptyState`.
  A proper shell component, listed in `.claude/rules/code-reuse.md`. Lift into manuSpine's
  shell library as-is — no CV/domain coupling.

- **FormRenderer `code` field type + CodeEditor** — `pwa/src/components/forms/CodeEditor.tsx`
  is a dependency-free, collapsible, syntax-highlighted code editor (transparent textarea over
  a highlighted `<pre>`, scroll-synced; LaTeX token colouring). FormRenderer gained a `code`
  case (`renderCode`) that renders it, same pattern as the `lines`/`richtext` types. Highlighting
  is LaTeX-only today; generalise the tokenizer per a `language` prop before porting. Purely additive.

- **Small shell tweaks (bundle with the above)** — `TreeEditor` `rootEditable` prop (Edit button
  on the root header → `openEdit(root)`); `ResourcePanel` skips the sub-label line when
  `getSubLabel` returns empty; `AreaShell` ICON_MAP gained `download`. All generic and low-risk.

- **DataTable column-aware filters (Tier 1)** — `pwa/src/components/shell/DataTable.tsx` filters
  went from free-text "field key + value (contains)" to a **column dropdown** + per-type **operator**
  (text: contains/=, enum: =, number/date: =/≥/≤) + a value control that switches to a dropdown
  (`filterOptions`), date, or number input by column. Two new optional props — `filterOptions?:
  Record<col,string[]>` and `columnTypes?: Record<col,'text'|'enum'|'number'|'date'>` — fully
  backward-compatible (no props → text/contains, the old behaviour; verified Surveys still compiles).
  ≥/≤ are refined client-side; contains/= still go to the fetcher for server-side use. Benefits every
  DataTable. Tier 2 (server-side structured filtering in the resolver) is the follow-up, not done.

- **Collapsible layout columns (SplitPageLayout + AreaShell)** — both columns collapse to a
  thin 44px rail (rotated title via `writing-mode: vertical-rl`, chevron restore button; whole
  rail clickable). `SplitPageLayout` gained a `collapsibleLeft` prop (default on) that collapses
  the left/list column and widens the detail pane; `AreaShell` collapses the section nav sidebar.
  Collapsed state is persisted per-page/section in `localStorage` (`splitLeftCollapsed:<pathname>`,
  `areaSidebarCollapsed:<title>`), starts expanded. The two collapse buttons are aligned to a shared
  16px top offset (`AreaShell` sidebar `padding-top: 16px`; `SplitPageLayout` zeroes the Ionic
  grid/left-col top padding). Pure shell-library UX, zero domain coupling. Note: when the
  `AreaShell` sidebar is collapsed the nav links are hidden (restore to navigate); consider
  an icon-only rail variant before/at port time. Mobile not addressed (see the layout's `@media` +
  the responsive `sizeXs`/`IonSplitPane`/auto-collapse ideas from that discussion).

- **BuildKit apt cache mount** — `python/Dockerfile` now uses
  `RUN --mount=type=cache,target=/var/cache/apt … --mount=…/var/lib/apt/lists …` plus
  `rm -f /etc/apt/apt.conf.d/docker-clean` and `# syntax=docker/dockerfile:1`, so apt
  `.deb` downloads persist across builds (host-global BuildKit cache, shared by mount
  target across projects). Generic build-infra win — belongs in manuSpine's python image.
  Reuse in other projects by copying the same mount lines (Option A; use `id=apt` to
  make cross-project sharing explicit).

- **User account: `user_profile` + `user_secrets` keychain + Users backoffice page (2026-07-02)** —
  the whole [[user-account-keychain-plan]] design is framework-generic: `user_profile` /
  `user_secrets` DDL in `01-init-db.sql` (+ `form_user_editor`/`form_user_create` seeds, d000/d010),
  `nodejs/lib/secrets.js` (AES-256-GCM, sole decrypt point) + `nodejs/secrets-registry.js`,
  the `userProfile`/`upsertUserProfile`/`userSecrets`/`setUserSecret`/`clearUserSecret` resolvers
  in `resolvers/framework/users.js` (+ `UserProfileType`/`UserSecretType`, permissions entries,
  `SECRETS_MASTER_KEY` env), Account's Profile + Integrations cards, and `backoffice/Users.tsx`
  (+ route/nav/PANEL_CONFIG.USERS). Only the profile *form shape* (`form_user_profile`) is app-level.
  Port wholesale; each app seeds its own profile form.

- **`ResourcePanel.getBadge` accepts `Badge | Badge[]`** — `pwa/src/components/shell/ResourcePanel.tsx`
  exports `ResourceBadge`; an array renders as a vertical stack of smaller (10px) badges in one
  end slot (Users page shows status + role). Must stay stacked: two side-by-side end-slot badges
  starve `IonLabel` of width in the narrow left column (it collapses to 0 and the text wraps
  char-by-char, stretching the item). Single-badge behaviour unchanged; `AreaShell`/`Menu` also
  gained the `people` icon. Bundle with the shell tweaks above.

- **`registered` role + self-registration (2026-07-02)** — new any-JWT tier below `user`:
  `permissions.js` gained the `registered` tier (below `user` role user-or-admin, above the
  admin fallback) enforced in `schema/index.js`; survey reads/answers moved up to the `user`
  tier; all self-service + domain ops sit in `registered`. (The `public` tier that briefly
  sat below `registered` was later removed entirely — see the lockdown entry below.)
  Public `POST /api/register` in `routes/framework/auth.js`
  (role hardcoded `'registered'`, returns JWT). Frontend: `AuthContext` `isUser` flag +
  `register()`, new `components/routing/UserRoute.tsx`, Surveys route/menu gated by
  `isUser`, SignIn page sign-in/register mode toggle (+ confirm-password field),
  `registered` option in the d001/d013 role dropdown seeds and `PANEL_CONFIG.USERS`
  filter. All framework-generic except which ops go in which tier (app decision) —
  port the mechanism wholesale.

- **Roles catalogue + tier-based enforcement + Roles backoffice page (2026-07-02)** —
  roles became data aliased onto the fixed three-tier ladder: `roles` table in
  `01-init-db.sql` (system rows d020–d022, `users.role` FK `ON UPDATE CASCADE`, Roles-page
  forms d030/d040), `resolvers/framework/roles.js` (`roleList`/`createRole`/`updateRole`/
  `deleteRole`, system-role + in-use guards) + `RoleType`. Enforcement everywhere compares
  the JWT's `tier` claim (resolved at login via JOIN, normalised for legacy tokens in
  `backend.js`) instead of role-name literals — `schema/index.js`, REST admin checks,
  domain resolvers, `AuthContext` `isAdmin`/`isUser`. Frontend: `backoffice/Roles.tsx`
  (+ route/nav/`PANEL_CONFIG.ROLES`/`ROLE_FORM`/`ROLE_TIERS`, `key` icon in AreaShell),
  Users page role selects fed from `roleList` via `injectedOptions`. Fully framework-generic
  — port wholesale together with the `.claude/skills/new-role` skill (already imported here).

- **No public GraphQL tier — full auth lockdown (2026-07-02)** — the `public`
  `permissions.js` tier was **removed**: every GraphQL operation now requires a valid JWT
  (three tiers only — `registered` / `user` / admin fallback), so anonymous requests always
  fail. `componentByName` moved from `public` into `registered` (FormRenderer + Landing
  content now need a token). Anonymous visitors get **only** the REST `/login`, `/register`,
  and the two tokenless file-download streams (`<img>` can't carry the header) — the invariant
  is "never add another tokenless endpoint". Backoffice REST endpoints hardened to
  `tier !== 'admin'` → 403 (survey stats export in `routes/framework/compute.js`,
  `/generate-content` in `content.js`); `files.js` edit endpoint is owner-or-admin. Frontend
  `Menu.tsx`/`AppHeader.tsx`/`constants.ts` adjusted so no nav/route assumes anonymous access.
  Framework-generic — port with the role/tier mechanism above (the imported
  `backend-api.md` rule + `new-api` skill already describe this target state).

- **`SinglePanelLayout` + User area (2026-07-02)** — `pwa/src/components/shell/SinglePanelLayout.tsx`,
  the single-column sibling of `SplitPageLayout` (same shell: AppHeader + AreaShell + `hidden` +
  `children`; one centered `TabPanel` column via `tabs`, `header` strip, `contentSize` width;
  imports the now-exported `RIGHT_HEADER_STYLE`). Layout rule (already in `code-reuse.md`/
  `page-template.md` here): list needed → `SplitPageLayout`, no list → `SinglePanelLayout`.
  Used by the User area (`pages/user/` Profile / Account / Settings, `AREA_NAV.USER`, dark-mode
  toggle moved from AppHeader/Menu to Settings; `person`/`settings` icons in AreaShell ICON_MAP).
  The layout, rule text, and the Account/Settings pages are framework-generic — port together;
  the Profile page's form shape stays app-level.

- **(Maybe) LaTeX compile service** — the `python/api/domains/latex/` compile endpoint
  (pdflatex, shell-escape disabled, temp dir, timeout) + the Node bridge pattern is
  largely generic ("compile a .tex string to PDF"). Borderline: it exists to serve the
  CV builder, but the compile primitive itself could live in manuSpine if another app
  needs LaTeX→PDF. Leave in manuHunter for now; revisit if a second consumer appears.

**Why:** manuSpine is the shared framework; generic improvements made in a derived app
must flow back so every app benefits and the fork doesn't drift.

**How to apply:** recreate each change here in manuSpine (reading the manuHunter source
as the reference), commit, then manuHunter runs `git fetch upstream && git merge
upstream/master` — never cherry-pick. Move items to "Landed" as they arrive.
