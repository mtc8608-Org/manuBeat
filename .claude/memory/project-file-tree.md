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
├── docker-compose.yml       # DEV: 5 services: pwa, nodejs, python, postgres, minio
├── docker-compose.prod.yml  # PROD: 4 services (no pwa), prebuilt :prod images, no ports,
│                            #   edge/internal/db networks, named volumes; shipped to
│                            #   /srv/apps/<app>/docker-compose.yml by ship-app.sh
├── .env / .env.example      # compose project name + secrets (template committed)
├── .env.prod.example        # prod env template; real file on-box only (chmod 600)
├── CLAUDE.md                # always-on rules + architecture
├── .claude/
│   ├── agents/              # convention-reviewer, exposure-auditor, pattern-scout, …
│   ├── memory/              # one fact per file, indexed by MEMORY.md
│   ├── rules/               # path-scoped conventions (backend-api, code-reuse, …)
│   └── skills/              # procedures: new-api, new-form, new-page, pull-upstream, …
├── deploy/                  # server provisioning + Caddy platform layer (templates only —
│   │                        #   real Caddyfile/hostname map + .env live on-box, never here)
│   ├── provision.sh         # stage 1, ON box: docker, log caps, sshd, upgrades, swap,
│   │                        #   edge network, /srv/caddy skeleton (idempotent)
│   ├── ship-caddy.sh        # stage 2, laptop: build xcaddy image → save|ssh load → up
│   ├── ship-app.sh          # stage 3, laptop: prod images + PWA build → skeleton in
│   │                        #   /srv/apps/<app> → save|ssh load → rsync www → up -d
│   └── caddy/               # Dockerfile (caddy-dns/hetzner), compose, Caddyfile.template,
│                            #   .env.example
├── init-scripts/            # DB schema+seeds, run alphabetically on fresh volume
│   ├── 01-init-db.sql       # framework schema + editor-form seeds + User Feedback survey
│   └── seed-landing.sql     # content tree: welcome, App Guide, Developer Guide
├── nodejs/                  # Express + GraphQL backend
│   ├── Dockerfile / Dockerfile.prod  # dev (deps at start, nodemon) / prod (slim, baked)
│   ├── backend.js           # entry: middleware, route registration, startup seeds
│   ├── db.js                # pg pool
│   ├── permissions.js       # GraphQL tier lists (public/registered/user; admin default)
│   ├── secrets-registry.js  # user-secrets keychain registry
│   ├── lib/secrets.js
│   ├── lib/filestream.js   # mayRead + streamFile: read auth and safe headers
│   │                       #   for any route streaming a files row (domain too)
│   ├── routes/framework/    # REST: auth, files, content
│   └── schema/              # index.js (gate+merge), types.js
│       ├── helpers/         # components.js, survey.js, ownership.js (owner-scoping
│       │                    #   primitives: userId/isAdmin/assertOwner/ownerScope)
│       └── resolvers/framework/  # components, roles, survey, users
├── pwa/                     # React + Ionic + Vite frontend
│   ├── public/              # static assets; PNGs auto-seeded to MinIO (screenshots/)
│   └── src/
│       ├── App.tsx          # route registration
│       ├── constants.ts     # FORM_ID/AREA_NAV/NAV_AREAS/PANEL_CONFIG/FORM_USAGE …
│       │                    #   NAV_AREAS = the single nav source (drawer, top bar, rail)
│       ├── components/
│       │   ├── shell/       # layout/structure: SplitPageLayout, SinglePanelLayout,
│       │   │                #   AreaShell, AppHeader, Menu, ResourcePanel, DataTable,
│       │   │                #   TabPanel, ModalShell, TreeEditor, EmptyState,
│       │   │                #   JsonViewer, PdfViewer · icons.ts (icon-name registry)
│       │   ├── charts/      # EChart (owned echarts glue)
│       │   ├── content/     # CMS cards: ContentRenderer, ContentNav, HtmlCard,
│       │   │                #   ImageCard, HtmlImageCard, LatexCard, CollapsibleCard
│       │   ├── forms/       # FormRenderer, ComponentForm, CodeEditor, ImagePicker,
│       │   │                #   ListModal, RichTextEditor
│       │   └── routing/     # PrivateRoute, TierRoute, AdminRoute
│       ├── contexts/        # AuthContext, ThemeContext
│       ├── interfaces/      # types.ts
│       ├── pages/           # public/ (Landing, SignIn) · backoffice/ (Configuration,
│       │                    #   Content, Files, Roles, Users) · surveys/ · user/
│       ├── services/Api.ts  # ALL API calls (gql helper + axios instance)
│       ├── utils/           # shared non-React helpers — download.ts (downloadBlob)
│       └── theme/
└── python/                  # FastAPI compute service (no DB/MinIO access)
    ├── Dockerfile / Dockerfile.prod  # dev (full base, hdf5-tools, --reload) / prod (slim)
    ├── requirements.txt     # intent (unpinned) · requirements.lock = enforced freeze
    └── api/
        ├── main.py          # app + router includes
        ├── domains/         # one dir per domain, <domain>/routes.py (framework ships none)
        └── public/          # static index served by FastAPI
```

Domain additions (in forks) mirror the framework layout: `init-scripts/02-init-<domain>.sql`,
`nodejs/routes/<domain>/`, `nodejs/schema/resolvers/<domain>/`,
`python/api/domains/<domain>/`, `pwa/src/pages/<domain>/`.

## manuBeat's own domains

The tree above is the framework surface, inherited verbatim from manuSpine. This
fork adds three domains on top of it (as of 2026-08-27):

```
init-scripts/
├── 02-init-medical.sql       # [MEDICAL] model_configs / model_runs / plot+proc configs
├── 03-init-bedside.sql       # [BEDSIDE] bedside_nodes, beds, bed_assignments, patients,
│                             #   patient_files, bedside_streams/segments/events, heartbeats
├── seed-physiology.sql       # [MEDICAL] baseline Hr-test circuit model into model_configs
└── seed-paper-egd.sql        # [MEDICAL] the EGD manuscript as CMS content cards
nodejs/
├── realtime.js               # [BEDSIDE] ws hub on /ws/bedside (attached in backend.js)
├── routes/
│   ├── bedside/              # ingest.js (device-token auth, 16 MB body cap),
│   │                         #   patients.js (patient row + HDF5 file mint)
│   ├── medical/models.js     # cardio run/status/result proxy to Python
│   └── surveys/stats.js      # CSV export (admin) — the framework's deleted compute.js
└── schema/resolvers/
    ├── bedside/patients.js   # roster, fleet, tokens, assignments, telemetry reads
    ├── medical/models.js     # model / plot / proc config CRUD
    └── surveys/stats.js      # surveyStats query — the framework's deleted stats layer
pwa/src/pages/
├── bedside/                  # Patients, Devices, Monitor (admin)
└── models/                   # Simulator, ModelSandbox, PlotSandbox,
                              #   ProcessingSandbox, HdfInspector
python/api/domains/
├── medical/                  # cardio_routes.py, hdf5_engine.py, cardio/ (JAX model)
└── surveys/routes.py         # pandas survey stats + CSV export
```

Two of these are **recreations of framework code manuSpine deleted** (the survey
stats layer, 2026-07-04). They live in a fork domain rather than in the framework
paths so no framework file carries a local patch — see CLAUDE.md
"Framework upstream" and [[framework-upstream-candidates]].
