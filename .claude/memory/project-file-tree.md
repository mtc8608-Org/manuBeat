---
name: project-file-tree
description: Annotated map of the full repo file tree — consult before asserting where anything lives or placing a new file; update whenever directories are added/moved/removed
metadata:
  node_type: memory
  type: project
---

# Project file tree (verified 2026-07-04)

Working map of the repo. **Verify against `ls` before asserting structure or
placing a file** — an empty directory (like `charts/` once was) is invisible
to git and easy to miss. **Update this file in the same commit as any change
that adds/moves/removes a directory.**

```
manuSpine/
├── run                      # ONLY entry point for the stack (see CLAUDE.md)
├── docker-compose.yml       # 5 services: pwa, nodejs, python, postgres, minio
├── .env / .env.example      # compose project name + secrets (template committed)
├── CLAUDE.md                # always-on rules + architecture
├── .claude/
│   ├── agents/              # convention-reviewer, exposure-auditor, pattern-scout, …
│   ├── memory/              # one fact per file, indexed by MEMORY.md
│   ├── rules/               # path-scoped conventions (backend-api, code-reuse, …)
│   └── skills/              # procedures: new-api, new-form, new-page, pull-upstream, …
├── init-scripts/            # DB schema+seeds, run alphabetically on fresh volume
│   ├── 01-init-db.sql       # framework schema + editor-form seeds
│   ├── seed-landing.sql     # content tree: welcome, App Guide, Developer Guide
│   └── seed-sample-surveys.sql
├── nodejs/                  # Express + GraphQL backend
│   ├── backend.js           # entry: middleware, route registration, startup seeds
│   ├── db.js                # pg pool
│   ├── permissions.js       # GraphQL tier lists (public/registered/user; admin default)
│   ├── secrets-registry.js  # user-secrets keychain registry
│   ├── lib/secrets.js
│   ├── routes/framework/    # REST: auth, files, compute, content
│   └── schema/              # index.js (gate+merge), types.js
│       ├── helpers/         # components.js, survey.js
│       └── resolvers/framework/  # components, roles, survey, users
├── pwa/                     # React + Ionic + Vite frontend
│   ├── public/              # static assets; PNGs auto-seeded to MinIO (screenshots/)
│   └── src/
│       ├── App.tsx          # route registration
│       ├── constants.ts     # FORM_ID/AREA_NAV/PANEL_CONFIG/FORM_USAGE …
│       ├── components/
│       │   ├── shell/       # layout/structure: SplitPageLayout, SinglePanelLayout,
│       │   │                #   AreaShell, AppHeader, Menu, ResourcePanel, DataTable,
│       │   │                #   TabPanel, ModalShell, TreeEditor, EmptyState,
│       │   │                #   JsonViewer, PdfViewer
│       │   ├── charts/      # EChart (owned echarts glue)
│       │   ├── content/     # CMS cards: ContentRenderer, ContentNav, HtmlCard,
│       │   │                #   ImageCard, HtmlImageCard, LatexCard, CollapsibleCard
│       │   ├── forms/       # FormRenderer, ComponentForm, CodeEditor, ImagePicker,
│       │   │                #   ListModal, RichTextEditor
│       │   └── routing/     # PrivateRoute, UserRoute, AdminRoute
│       ├── contexts/        # AuthContext, ThemeContext
│       ├── interfaces/      # types.ts
│       ├── pages/           # public/ (Landing, SignIn) · backoffice/ (Configuration,
│       │                    #   Content, Files, Roles, Users) · surveys/ · user/
│       ├── services/Api.ts  # ALL API calls (gql helper + axios instance)
│       └── theme/
└── python/                  # FastAPI compute service (no DB/MinIO access)
    ├── Dockerfile           # python:3.13, installs requirements.lock
    ├── requirements.txt     # intent (unpinned) · requirements.lock = enforced freeze
    └── api/
        ├── main.py          # app + router includes
        ├── domains/         # one dir per domain, <domain>/routes.py (framework ships none)
        └── public/          # static index served by FastAPI
```

Domain additions (in forks) mirror the framework layout: `init-scripts/02-init-<domain>.sql`,
`nodejs/routes/<domain>/`, `nodejs/schema/resolvers/<domain>/`,
`python/api/domains/<domain>/`, `pwa/src/pages/<domain>/`.
