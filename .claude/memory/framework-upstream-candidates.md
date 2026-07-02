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
the reusable primitives come up. Recreate each change here (don't cherry-pick — see
CLAUDE.md "Framework downstream"), then manuHunter merges `upstream/master`.
Tick items off as they land.

## Landed in manuSpine

- ✅ **`.claude/` config layout (rules/, skills/, CLAUDE.md sections)** — ported 2026-07-02.
- ✅ **FormRenderer `lines` + `code` field types, CodeEditor** — ported 2026-07-02.
  Deviation: CodeEditor's tokenizer was generalised behind a `language` prop
  (registry in `CodeEditor.tsx`; `latex` is the only built-in, unknown → plain text);
  FormRenderer passes `options.language`. manuHunter's version is LaTeX-hardcoded.
- ✅ **PdfViewer shell component** — ported 2026-07-02 as-is.
- ✅ **Small shell tweaks** — ported 2026-07-02: `TreeEditor` `rootEditable`,
  `ResourcePanel` sub-label skip + `getBadge: Badge | Badge[]` (stacked), AreaShell
  ICON_MAP additions (briefcase/download/people/key/person/settings).
- ✅ **DataTable column-aware filters (Tier 1)** — ported 2026-07-02 verbatim
  (`filterOptions`/`columnTypes` props, typed operators). Tier 2 (server-side
  structured filtering) remains a follow-up in both repos.
- ✅ **Collapsible layout columns (SplitPageLayout + AreaShell)** — ported 2026-07-02
  as-is (rotated-title rail; icon-only rail variant still an open idea; mobile not
  addressed).
- ✅ **SinglePanelLayout + User area** — ported 2026-07-02: layout + `pages/user/`
  Profile / Account / Settings (dark-mode toggle moved from Menu/AppHeader to
  Settings), `AREA_NAV.USER`. manuSpine seeds a minimal generic `form_user_profile`
  (name / contact email / website, d050–d053) so Profile works out of the box —
  apps replace the fields but keep the form name.
- ✅ **User account: `user_profile` + `user_secrets` keychain + Users backoffice page**
  — ported 2026-07-02 wholesale (DDL, d000/d010 seeds, `lib/secrets.js`,
  `secrets-registry.js`, users resolvers, `SECRETS_MASTER_KEY` env, Settings
  Integrations card, `backoffice/Users.tsx`). Content page's Anthropic key now
  comes from the keychain (Content.tsx + `generateContent` signature ported too).
- ✅ **`registered` role + self-registration** — ported 2026-07-02 (`POST /api/register`,
  `AuthContext` `isUser`/`register`, `UserRoute`, SignIn register mode, role seeds).
- ✅ **Roles catalogue + tier-based enforcement + Roles backoffice page** — ported
  2026-07-02 wholesale (roles table d020–d022 + forms d030/d040, `roles.js` resolver,
  tier claim in JWT, legacy-token normalisation, `backoffice/Roles.tsx`, `ROLE_TIERS`).
- ✅ **Auth lockdown** — ported 2026-07-02 **with one deliberate deviation**:
  manuSpine keeps a minimal `public` permissions tier containing **only**
  `componentByName` (read-only) so the seeded Landing/CMS content stays visible to
  anonymous visitors; manuHunter removed the public tier entirely. Invariant here:
  never add another operation to `public`. Everything else matches manuHunter
  (unified query/mutation rule, tier checks, REST guards in compute/content/files,
  owner-scoped files). Expect a merge conflict in `permissions.js`/`schema/index.js`
  when manuHunter merges upstream — both are app-tuned files; manuHunter keeps its
  no-public state.
- ✅ **BuildKit apt cache mount** — ported 2026-07-02: mechanism only (syntax line,
  cache mounts, docker-clean removal); package list stays `hdf5-tools` (TeX Live is
  CV-domain and stays in manuHunter).

## Pending

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
