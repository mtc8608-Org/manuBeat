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

## Fork status (as of 2026-07-02)

Neither fork has merged the 2026-07-02 framework batch yet:

- **manuHunter** (`cv-builder` branch) — the port source; its merge is mostly
  echo-back of its own work. The real conflicts are exactly the recorded
  deviations below: public permissions tier, CodeEditor `language` prop, generic
  `form_user_profile` seed, Dockerfile apt package list. It also receives the
  post-port items (surveys→registered tier, sync skills, dev-loop agents).
- **manuBeat** (`master`) — last merged upstream **pre-port** (at 67c3a10), so its
  next pull brings the entire batch at once. Heaviest follow-up is auth: the
  tier-based lockdown defaults every GraphQL op to admin-only and adds REST
  guards, so manuBeat's domain surface (bedside telemetry ingest, device-token
  routes, WebSocket monitor, medical content) must be explicitly placed in tiers
  during the merge or it breaks silently. Review device-token auth paths against
  the new REST guards; `SECRETS_MASTER_KEY` must be added to its env.

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

## Pending

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
