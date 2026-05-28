# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

Always use `./run` from the repo root. Never raw `docker compose` commands.

```bash
./run                        # start all services (builds pwa image if missing)
./run rebuild <service>      # rebuild after Dockerfile/requirements changes
./run reset                  # wipe DB + MinIO and restart (re-runs init-scripts)
./run rebuild-reset <service># rebuild image AND wipe DB
./run down                   # stop everything
```

Service URLs: Frontend `http://localhost:8100` · GraphQL `http://localhost:3000/graphql` · Python `http://localhost:5000`

## Architecture

### Five-service stack
```
pwa (React + Ionic + Vite)
  → nodejs (Express + GraphQL)
      → postgres (schema in init-scripts/)
      → minio (file storage)
  → python (FastAPI, computation only — no DB writes)
```

### Frontend (`pwa/src/`)
- **Routing** — React Router v5 via `IonReactRouter`. Public routes, `PrivateRoute` (requires JWT), `AdminRoute` (requires admin role). Registered in `App.tsx`. No catch-all redirect — unmatched paths render blank.
- **Auth** — `AuthContext` stores the JWT in `localStorage`, decodes the payload on load, and verifies against `/api/me` on startup. `useAuth()` exposes `token`, `user`, `isAdmin`, `login`, `logout`.
- **API** — all calls go through `services/Api.ts`. GraphQL via `graphql-http`, REST via `axios`. Auth header injected automatically.
- **Shell components** — `SplitPageLayout`, `AreaShell`, `ResourcePanel`, `DataTable`, `ModalShell`, `TabPanel`, `EmptyState`, `TreeEditor` — these are the building blocks for every page.

### Component tree system
UI structure (forms, inputs, selects, plots) is stored as nodes in the `components` table with JSONB `data` and `options`. Parent-child ordering uses `components_relationships.position`. `FormRenderer` turns a fetched tree into a live form. `TreeEditor` lets admins build/edit trees in the Configuration page. `ComponentForm` is the edit modal.

Component types: `form`, `input`, `check`, `select`, `option`, `color`, `plot`, `plotGrid`, `richtext`, `filepicker`.

### Survey system
Mirrors the component tree but is fully separate (`survey_components` / `survey_components_relationships` / `surveys` / `survey_answers`). Same JSONB shape and tree logic. Answers are keyed by `survey_component.id` (UUID), enabling cross-survey queries. Survey types add: `survey`, `text`, `number`, `date`, `textarea`, `scale`.

### Content / CMS system
Content pages are `contentPage` nodes in the shared `components` table. The root node `content_menu` holds child pages shown in `Landing.tsx`'s nav. Each page holds card leaves: `contentHtml`, `contentImage`, `contentHtmlImage`, `contentLatex`. Cards are rendered by `ContentRenderer`. The backoffice Content page manages this tree.

### Backend (`nodejs/`)
- `backend.js` — Express entry point; registers middleware, GraphQL at `/graphql`, REST routes under `/api`.
- `schema/index.js` — assembles the GraphQL schema from resolver modules. Each resolver file exports `{ queries, mutations }`.
- `permissions.js` — lists mutation names that are public or user-accessible; everything else defaults to admin-only.
- Routes and resolvers are organised under `routes/framework/` and `schema/resolvers/framework/`. Domain routes/resolvers go in parallel `routes/<domain>/` and `schema/resolvers/<domain>/` directories, registered with `// [MY DOMAIN]` comments.

### Python (`python/api/`)
- `main.py` — FastAPI app; include domain routers here.
- `domains/` — one subdirectory per domain with its own `routes.py`.
- Node.js calls Python via Axios and then persists results itself.

### DB init (`init-scripts/`)
Files run alphabetically on a fresh postgres volume:
- `01-init-db.sql` — framework schema and seeds (component editor forms, survey forms, content editor forms, files table).
- `seed-landing.sql` — full content tree: base nodes, welcome card, App Guide, Developer Guide.
- `seed-sample-surveys.sql` — sample Patient Registration answers for the Stats tab demo.
- `02-init-<domain>.sql` — domain tables, added per project.

**UUID convention**: framework seeds use the prefix `c51c1e5f-5cc1-4b77-8832-2d10cc97XXXX`. Content seeds use `00000000-0000-0000-0000-XXXXXXXXXXXX`. Always hardcode UUIDs for seeds referenced from code (e.g. `constants.ts` `FORM_ID`, `EDITOR_ID`, `CONTENT_EDITOR_ID`).

## Adding a domain

1. **DB** — `init-scripts/02-init-<domain>.sql` (postgres picks it up alphabetically).
2. **Node routes** — `nodejs/routes/<domain>/things.js`, registered in `backend.js` with `server.use('/api', require('./routes/<domain>/things'))`.
3. **GraphQL** — `nodejs/schema/resolvers/<domain>/things.js` exporting `{ queries, mutations }`, merged into `schema/index.js`.
4. **Python** (optional) — `python/api/domains/<domain>/routes.py`, router included in `main.py`.
5. **Frontend** — pages in `pwa/src/pages/<domain>/`, constants in `pwa/src/constants.ts` marked `// [MY DOMAIN]`, routes in `App.tsx`, nav in `Menu.tsx`.

## Content seed format

Cards store their content in `data` JSONB:
- `contentHtml` → `data.html` (HTML string)
- `contentImage` → `data.src` (MinIO URL or path), `data.alt`
- `contentHtmlImage` → `data.html` + `data.src`
- `contentLatex` → `data.html` (HTML with KaTeX math)

Parent-child links use `components_relationships(parent_id, child_id, position)`. Position controls display order within a page.
