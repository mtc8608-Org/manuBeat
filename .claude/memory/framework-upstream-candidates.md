---
name: framework-upstream-candidates
description: Framework sync ledger — generic changes flowing between manuSpine and its forks; the Landed section doubles as the fork-side merge map for pull-upstream
metadata:
  node_type: memory
  type: project
---

# Framework sync ledger (upstream candidates + fork merge map)

Framework-generic changes built in a fork are flagged under **Pending**, recreated
here in manuSpine (never cherry-picked), and moved to **Landed**. Forks then run
`git fetch upstream && git merge upstream/master`. Three skills drive the cycle:

- `flag-upstream` — in a fork, right after building something generic: adds a Pending entry.
- `port-upstream` — here in manuSpine: lands Pending items, moves them to Landed.
- `pull-upstream` — in a fork: merges upstream and uses **Landed** below as its
  conflict map. Keep the per-item deviations and merge notes accurate — they are
  read by the next fork session before it merges.

## Fork status (as of 2026-07-07)

- **manuHunter** (`master`) — **merged the full batch 2026-07-07** (merge commit
  `ccc9d8c`), including the 2026-07-02 port echo-back and the 2026-07-04
  hardening/survey-reframe items. Resolution followed the deviations below;
  fork-side outcomes worth knowing: no public tier kept (gate adapted — no
  `permissions.public` lookup in its `schema/index.js`); upstream's generic
  `form_user_profile` d050 seed block **deleted** from its `01-init-db.sql`
  (its richer same-name form in `03-init-cv.sql` wins — `components.name` is
  UNIQUE); CV template seeds set `options.language: "latex"` explicitly;
  Dockerfile keeps TeX Live but dropped `hdf5-tools` (only served the removed
  compute engine); surveys placed on `PrivateRoute`/registered tier; four
  role-inverting lines in shared rules/skills re-worded fork-side
  (backend-api public-tier paragraph, db-schema framework-repo line,
  new-api step 6, new-role ownership line).
- **manuBeat** (`master`) — has NOT merged; last merged upstream **pre-port**
  (at 67c3a10), so its next pull brings the entire batch at once — and the
  security-critical GraphQL gate fix: its `schema/index.js` carries the
  first-selection-only bypass until it merges. Heaviest follow-up is auth: the
  tier-based lockdown defaults every GraphQL op to admin-only and adds REST
  guards, so manuBeat's domain surface (bedside telemetry ingest, device-token
  routes, WebSocket monitor, medical content) must be explicitly placed in tiers
  during the merge or it breaks silently. Review device-token auth paths against
  the new REST guards; `SECRETS_MASTER_KEY` must be added to its env. The
  2026-07-04 survey reframe hits it hardest: its `bedside` domain models a
  patient as a survey answer on `f000` — see that item's merge note below. It
  additionally receives the whole 2026-08-26 security batch below, of which the
  **deactivation check** and **device-token routes** need real thought: the JWT
  middleware now requires a live `users.is_active` row, so any device or agent
  authenticating with something that is not a real user row will start getting
  `req.user = null`.

## Landed in manuSpine (all ported 2026-07-02) — merge notes per item

- ✅ **`.claude/` config layout (rules/, skills/, CLAUDE.md sections)**.
  On merge: take upstream for shared rules/skills; fork-specific rules and
  CLAUDE.md domain sections stay fork-side.
- ✅ **FormRenderer `lines` + `code` field types, CodeEditor** — **deviation**:
  upstream CodeEditor is generalised behind a `language` prop (tokenizer registry
  in `CodeEditor.tsx`; `latex` is the only built-in, unknown → plain text);
  FormRenderer passes `options.language`. manuHunter's copy is LaTeX-hardcoded.
  On merge: manuHunter takes upstream and sets `options.language: "latex"` at its
  CV-builder call sites/seeds; drop its hardcoded tokenizer.
- ✅ **PdfViewer shell component** — ported as-is; no conflict expected.
- ✅ **Small shell tweaks** — `TreeEditor` `rootEditable`, `ResourcePanel`
  sub-label skip + `getBadge: Badge | Badge[]` (stacked), AreaShell ICON_MAP
  additions (briefcase/download/people/key/person/settings). Take upstream.
- ✅ **DataTable column-aware filters (Tier 1)** — ported verbatim
  (`filterOptions`/`columnTypes` props, typed operators). Tier 2 (server-side
  structured filtering) remains a follow-up in **all** repos.
- ✅ **Collapsible layout columns (SplitPageLayout + AreaShell)** — as-is
  (rotated-title rail; icon-only rail variant still an open idea; mobile not
  addressed).
- ✅ **SinglePanelLayout + User area** — layout + `pages/user/` Profile / Account /
  Settings (dark-mode toggle lives in Settings now, not Menu/AppHeader),
  `AREA_NAV.USER`. **Deviation**: manuSpine seeds a minimal generic
  `form_user_profile` (name / contact email / website, d050–d053). On merge:
  forks keep the form **name** but may replace the fields (manuHunter already has
  a richer profile incl. picture — its seed fields win, form name stays).
- ✅ **User account: `user_profile` + `user_secrets` keychain + Users backoffice
  page** — DDL, d000/d010 seeds, `lib/secrets.js`, `secrets-registry.js`, users
  resolvers, `SECRETS_MASTER_KEY` env, Settings Integrations card,
  `backoffice/Users.tsx`. Content page's Anthropic key comes from the keychain
  (Content.tsx + `generateContent` signature). On merge: `secrets-registry.js` is
  app-tuned — fork keeps its own entries, takes upstream structure; every fork
  must have `SECRETS_MASTER_KEY` set in its env/compose.
- ✅ **`registered` role + self-registration** — `POST /api/register`,
  `AuthContext` `isUser`/`register`, `UserRoute`, SignIn register mode, role seeds.
- ✅ **Roles catalogue + tier-based enforcement + Roles backoffice page** — roles
  table d020–d022 + forms d030/d040, `roles.js` resolver, tier claim in JWT,
  legacy-token normalisation, `backoffice/Roles.tsx`, `ROLE_TIERS`.
- ✅ **Auth lockdown** — unified query/mutation rule, tier checks, REST guards in
  compute/content/files, owner-scoped files. **Deliberate deviation**: manuSpine
  keeps a minimal `public` permissions tier containing **only** `componentByName`
  (read-only) so seeded Landing/CMS content is visible anonymously; manuHunter
  removed the public tier entirely. Invariant upstream: never add another op to
  `public`. On merge: `permissions.js`/`schema/index.js` conflict is expected —
  both are app-tuned; the **fork's** public-tier stance wins (manuHunter keeps
  no-public), and each fork must place its domain ops into tiers explicitly
  (everything unlisted becomes admin-only).
- ✅ **BuildKit apt cache mount (python image)** — mechanism only (syntax line,
  cache mounts, docker-clean removal). Package list is app-tuned: manuSpine ships
  `hdf5-tools`; manuHunter keeps TeX Live. On merge: take upstream mechanism,
  keep the fork's package list.

## Landed post-port (upstream-native, same merge batch)

Not from manuHunter — added directly in manuSpine after the port; forks receive
these in the same `merge upstream/master`:

- ✅ **Surveys opened to the registered tier** (060bbfe) — `permissions.js`
  survey ops moved to the registered tier; survey routes behind `UserRoute` in
  `App.tsx`; `Menu.tsx`/`constants.ts` adjusted. All four files are app-tuned →
  conflicts likely; take upstream's tier placement for survey ops, keep fork
  domain entries.
- ✅ **Upstream sync skills + diff-classifier agent** (b90b80d) —
  `flag-upstream`/`port-upstream`/`pull-upstream` skills, `diff-classifier`
  agent, one `.gitignore` line. Take upstream.
- ✅ **Five development-loop agents** (d37a8b5) — pattern-scout,
  convention-reviewer, slice-mapper, seed-author, ui-composer under
  `.claude/agents/`. Take upstream.
- ✅ **GraphQL gate hardening** (475730f, 2026-07-04) — the permission gate now
  resolves the executed operation (`getOperationAST`) and enforces **every**
  top-level field (fragment spreads expanded, fail closed); previously only
  `definitions[0].selections[0]` was checked, so batching a privileged field
  behind an allowed one — or leading with a fragment definition — bypassed
  enforcement entirely (resolvers never check auth themselves). Rule line added
  to `backend-api.md`. On merge: `schema/index.js` conflict is expected
  (app-tuned) — the fork **must take upstream's gate mechanism**
  (`topLevelFieldNames` + the per-field loop) and keep only its own tier-list
  stance (e.g. manuHunter's no-public tier). Do not keep the fork's old
  single-name gate.
- ✅ **Seeded dev-guide auth docs updated to tier model** (8fccead, 2026-07-04) —
  `seed-landing.sql`: permissions card rewritten (tier lists + every-top-level-
  field gate), role→tier checks fixed in the JWT-middleware, writing-routes,
  file-upload, pages-routing, and auth-architecture cards. On merge: take
  upstream where the fork kept the framework dev-guide seeds; applies only
  after `./run reset`.
- ✅ **Login rate limiting** (2de9b96, 2026-07-04) — `express-rate-limit` on
  `POST /login` (10 failed attempts per IP per 15 min; successful logins don't
  count) in `routes/framework/auth.js`, plus `trust proxy: 1` in `backend.js`
  for the single Caddy hop. On merge: take upstream (`auth.js`, `backend.js`,
  `package.json`/lockfile); rebuild the node image for the new dependency.
- ✅ **Survey reframe: owner-scoped answers + User Feedback demo + stats/compute
  removal** (c0c68f0 / 1af9aaf / 9a4bfc3 / aae96c5 / 2ee6d3b, 2026-07-04) —
  fixes the two owner-scoping majors from the exposure audit. Four parts:
  (1) `survey_answers.owner_id UUID NOT NULL REFERENCES users(id)` + owner-scoped
  resolvers (`surveyAnswers`/`updateAnswer` filter non-admins; `submitAnswer`
  stamps `ctx.user.id`; `deleteAnswer` admin-only; `SurveyAnswerType` gains
  `owner_id`/`owner_email`; Answers tab: admin-only By column + Delete). The
  Survey System region moved **after** Users & Auth in `01-init-db.sql` (the FK
  needs `users`). (2) Seeded `f000` survey reframed Patient Registration → User
  Feedback (`surv_fb_*`, e000–e00d); `seed-sample-surveys.sql` deleted.
  (3) Stats layer removed: `surveyStats` resolver, `routes/framework/compute.js`,
  the Stats tab, `getSurveyStats`, `ENDPOINT.SURVEY_EXPORT`,
  `python/api/domains/compute/` + pandas — the Python service is an empty
  `/health` scaffold (framework ships no domains). (4) Survey/stats screenshots
  deleted; App Guide survey cards + Dev Guide rewritten; docs/rules/skills point
  at manuHunter's `cv/compile.js` + `latex/routes.py` as the compute exemplars.
  On merge: **schema is reset-only, so `owner_id NOT NULL` lands via
  `./run reset`** — any fork with domain code writing/reading `survey_answers`
  must adapt to the owner column and scoped resolvers. **manuBeat's `bedside`
  domain is a head-on collision** (a patient IS a survey answer on `f000`):
  keep its own Patient Registration seed content if it wants it (app-tuned
  seed wins), but it must take upstream's `survey_answers` DDL + resolver
  scoping and decide who owns bedside-created answers. Forks keep their own
  `python/api/domains/<domain>/` and Node compute callers (only the framework
  `compute` domain and its `compute.js` route were deleted); regenerate
  `requirements.lock` if the fork inherits the pandas removal.

## Landed 2026-08-26 — the manuHunter audit batch (upstream-native)

Not ported from a fork: manuHunter's pre-deployment audit swept **shared
framework code**, so its findings were manuSpine bugs. Fixed here; both forks
receive them on their next `merge upstream/master`. Details and open follow-ups:
[[pre-deployment-todo]].

- ✅ **Owner-scoping primitives** (`schema/helpers/ownership.js`) — `userId`,
  `isAdmin`, `assertOwner`, `assertReadable`, `ownerScope`, extracted from
  manuHunter's `resolvers/cv/documents.js`. `users.js` and `survey.js`
  refactored onto them. On merge: **take upstream and delete the fork's local
  copies** — manuHunter's `assertWritable`/`assertReadable`/`readScope` in
  `cv/documents.js` and `assertApplicationOwner` in `jobs/applications.js` are
  the same functions; keep its `applications` table's `user_id` column name by
  passing `{ column: 'user_id' }`. **manuBeat: `survey.js` changed** — its
  `bedside` domain leans on survey answers, so re-check its resolvers.
- ✅ **`downloadBlob`** (`pwa/src/utils/download.ts`, new dir) — fixes a leaked
  object URL in `DataTable`'s CSV export. On merge: manuHunter should collapse
  its three hand-rolled copies (GeneratedCvs, Applications, Artifacts) onto it.
- ✅ **Navigation single-sourced** — `NAV_AREAS` (constants.ts) now drives the
  drawer, the top-bar sections (`NAV_SECTIONS`, derived) and the in-page rail;
  `ICON_MAP` lifted to `components/shell/icons.ts`; `Menu.tsx` no longer
  hardcodes areas. **`AREA_NAV`'s shape is unchanged**, so pages keep working.
  On merge: conflict in `constants.ts` and `Menu.tsx` is expected — take
  upstream's mechanism, then re-add fork areas as `NAV_AREAS` entries
  (manuHunter: APPLICATIONS and CV_BUILDER) instead of Menu JSX blocks.
- ✅ **`UserRoute` / `isUser` / `userOnly` deleted** — dead in all three repos.
  On merge: drop any remaining import.
- ✅ **File download lockdown** — `files.is_public` + owner-or-admin on both
  routes, `download-by-key` resolved through the `files` table, inline mime
  allowlist, `nosniff`, single not-found-or-not-authorised error.
  **Reset-only**: a fork picks the column up on its own `./run reset`, and until
  then its content images 403. **manuHunter especially**: its generated CV PDFs
  and application artifacts are served through these routes — they are private
  uploads and stay private, which is the intended fix for its own
  download-scoping blocker, but re-check every `data.src` it seeds.
- ✅ **`/register` throttled + password floor** — separate `registerLimiter`;
  `MIN_PASSWORD_LENGTH` on register, change-password and admin user create.
- ✅ **Deactivation revokes** — JWT middleware re-checks `users.is_active`,
  fails closed. See the manuBeat device-token warning in Fork status above.
- ✅ **CORS removed, body cap set** (`express.json({ limit: '2mb' })`), `cors`
  dependency dropped. On merge: a fork serving its frontend from a different
  host must re-add CORS scoped to an explicit origin list — never bare `cors()`.
- ✅ **Deploy hardening** — Caddy `header` block (HSTS/nosniff/frame-ancestors),
  dev compose ports on `127.0.0.1`, `ship-app.sh` secret-length preflight,
  `provision.sh` ufw default-deny. The Caddy block does **not** reach an
  already-provisioned box; hand-copy it.
- ✅ **Rules updated** — `backend-api.md` (ownership primitives, no existence
  oracle, both-ends link auth, deactivation), `db-schema.md` (shared NULL-owned
  rows), `files-storage.md` (`is_public`), `python-compute.md` (subprocess
  sandboxing), `code-reuse.md` (adding an area). Take upstream.
- ⚠️ **Lockfile not regenerated** — `nodejs/package.json` moved to
  `multer ^2.0.2` and dropped `cors`, but `package-lock.json` is untouched.
  Run `npm install --package-lock-only` in `nodejs/` before this is real.

## Pending

- **Regenerate `python/requirements.lock` after pandas removal (2026-07-07)** —
  Where: `python/requirements.lock` (byte-identical in manuSpine and manuHunter).
  What: the survey-reframe batch removed the `compute` domain and dropped pandas from `requirements.txt`, but the lock still pins `pandas==3.0.3`, `numpy==2.5.0` and their transitives `python-dateutil`, `six` — orphaned installs in every image build. Regenerate the lock in manuSpine per `.claude/rules/python-compute.md` (never hand-edit, never regenerate in a fork); forks inherit via merge.
  Strip: none.
  Decisions: none — mechanical regeneration.
  Depends: none.

- **Retire `ComponentForm.tsx` and `ListModal.tsx` (2026-07-07)** —
  Where: `pwa/src/components/forms/ComponentForm.tsx` (+ its `ShowComponentModal` export and the `ComponentModal` interface in `pwa/src/interfaces/types.ts`), `pwa/src/components/forms/ListModal.tsx`.
  What: unimported in manuSpine, manuHunter, and manuBeat (only comment references). Configuration.tsx carries its own live copy of the editor-ID map ComponentForm duplicated. Delete both files and the orphaned interface.
  Strip: none.
  Decisions: none.
  Depends: none.

- **(Maybe) LaTeX compile service** — the `python/api/domains/latex/` compile
  endpoint (pdflatex, shell-escape disabled, temp dir, timeout) + the Node bridge
  pattern is largely generic ("compile a .tex string to PDF"). Borderline: it
  exists to serve the CV builder, but the compile primitive could live in
  manuSpine if another app needs LaTeX→PDF. Stays in manuHunter; revisit if a
  second consumer appears.

**Why:** manuSpine is the shared framework; generic improvements made in a derived
app must flow back so every app benefits and forks don't drift — and forks need an
accurate map of what a merge will bring and where it will conflict.

**How to apply:** in manuSpine, run `port-upstream` on Pending items (recreate from
the fork source, commit, move to Landed with deviations recorded). In a fork, run
`pull-upstream`: read the Landed merge notes above first, then
`git fetch upstream && git merge upstream/master` — never cherry-pick. On conflict,
fork keeps app-tuned content (permission tiers, seeds, package lists, registry
entries), takes upstream mechanism/framework files. Update the **Fork status**
section here (in manuSpine) once a fork has merged.
