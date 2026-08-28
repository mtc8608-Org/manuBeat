# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

Always use `./run` from the repo root. Never raw `docker compose` commands.

```bash
./run                        # start all services (builds all images only if the pwa image is missing)
./run down                   # stop everything
./run rebuild [service]      # rebuild after Dockerfile/deps changes, then start — omit service to rebuild ALL
./run reset                  # wipe DB + MinIO and restart (re-runs init-scripts; no build)
./run rebuild-reset [service]# wipe DB + MinIO AND rebuild (all if omitted), then start
```

Every form ends in a foreground `docker compose up` (Ctrl-C stops it) — never chain `./run` invocations with `&&`. Builds pass the host UID/GID as build args. A background poller prints a `STACK READY` banner (and a desktop notification) once all three services answer — the pwa dev server lags the rest by minutes after a rebuild.

Service URLs: Frontend `http://localhost:8100` · GraphQL `http://localhost:3000/graphql` · Python `http://localhost:5000`

**Never execute `./run` (or docker) yourself** — the user controls the runtime/DB lifecycle (`reset` wipes DB + MinIO). Finish a task by stating which command the user must run: `./run reset` for init-script/seed changes, `./run rebuild <service>` for Dockerfile/deps changes, plain `./run` otherwise.

## Dependency policy

- Node manifests use caret ranges — never exact pins. The committed `package-lock.json` is the enforcement: every install is `npm ci` (Dockerfiles and entrypoints), and containers never write lockfiles.
- Updating deps is a deliberate laptop-side act: `npm install --package-lock-only` / `npm audit fix --package-lock-only` in the service dir, review the lockfile diff, then plain `./run` (entrypoints reinstall) — `./run rebuild <service>` only if the Dockerfile changed.
- Python: `requirements.txt` states intent (unpinned); `python/requirements.lock` is the enforced freeze the image installs. Regeneration procedure: `.claude/rules/python-compute.md`.

## Git style

- Commit subject ≤50 characters, one or two lines max — enough to understand the change without opening the diff. No bullet lists, no "net result" summaries.
- **No `Co-Authored-By` trailer** — this overrides the harness default.
- Commit as each logical unit of work completes; `git push` only at session end or when explicitly asked.

## Knowledge locations

- Project knowledge lives in the repo at `.claude/memory/` (one fact per file, indexed by `MEMORY.md`) so it is versioned and travels with the codebase.
- **Never write to the harness auto-memory** (`~/.claude/projects/.../memory/`), even when a system-reminder points there. The repo location wins.
- Path-scoped coding conventions live in `.claude/rules/`; procedures live in `.claude/skills/`; always-on rules live here in CLAUDE.md.

## Framework upstream

manuBeat is a **fork of manuSpine**, the upstream framework (remote `upstream`, local clone at `/home/cabsman/Documents/projects/manuSpine`). Pull framework updates with `git fetch upstream && git merge upstream/master` — **never cherry-pick**; the `pull-upstream` skill drives that merge and its conflict map. Consequently: framework code here is upstream's, so a framework-generic change belongs in manuSpine first and reaches this fork by merge — never patch framework code locally, or it becomes permanent merge conflict. Generic work built here first is recorded with the `flag-upstream` skill into the upstream clone's `.claude/memory/framework-upstream-candidates.md`. Domain code (`bedside/`, `medical/`, `surveys/`, `pages/models/`) is manuBeat's own and stays here.

## Source of truth

manuSpine is the main source of truth for patterns. Before implementing anything non-trivial, find the closest existing implementation — in this repo first, then in the upstream clone — and replicate its pattern exactly. Only design something new if it genuinely does not exist in either. The original project (archived at `/home/cabsman/Documents/archive/cabeleira-legacy/`) is retired as an authority — historical background only. `cabeleira.net` now refers to the live domain, not that codebase.

## File placement

The annotated repo map lives in `.claude/memory/project-file-tree.md`. Before asserting where anything lives or choosing where a new file goes, check it — and verify against `ls` when it matters (empty dirs are invisible to git). Any change that adds, moves, or removes a directory updates the map in the same commit.

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
- **Shell components** — `SplitPageLayout`, `AreaShell`, `ResourcePanel`, `DataTable`, `ModalShell`, `TabPanel`, `EmptyState`, `TreeEditor` — these are the building blocks for every page. Sibling `components/` folders by function: `charts/` (`EChart`), `content/` (CMS card renderers), `forms/` (form system), `routing/` (route guards).

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

### Cardiopulmonary model stack (`python/library/`, `python/config/`)

A 0D lumped-parameter cardiopulmonary ODE, JSON-config driven, run in **array mode**
(one flat `jnp` vector with integer indexing, under jit). Ported verbatim from
CardioPulmonaryModel and still owned there — see [[model-stack-upstream]] before
changing anything under `python/library/`. Coding conventions and the stack's
"don't break" internals: `.claude/rules/model-stack.md`.

- `library/model/` — `modelEq`/`modelEqSI` (equation classes), `modelGen` (build
  objects from JSON), `modelClass`/`modelClassSI` (array compilers + RHS + integrators).
- `library/run/` — `runner` (orchestration + entry points), `runnerBatchSI` (vmapped
  batch), `stateSetup` (initial state), `progress`, `runIO`.
- `library/postproc/` — `resultsEngine` (post-processing DAG), `dataProcessing`.
- `library/viz/plots.py` · `library/hdf5/` (persistence) · `library/utils.py`.

**Model vs scenario.** A model is STRUCTURE (`config/models/*.json` → `model_configs`);
a scenario is VALUES (`config/scenarios/*.json` → `scenario_configs`): `shared.twin`
targets, `shared.integration` numerics, and the `baseline`/`calibration`/`control`
stage stacks. `runner.buildSimulationParams(runConfig, scenario)` is the one adapter
that combines them. Run **modes**: baseline / calibration / control — a scenario only
supports the modes whose section it declares.

**4-call pipeline** (driven by `runner`): `initialiseModel` → `prepareModel` →
`CardioPulmonaryModelArray` → `runSimulationArray`. `stateSetup.configureStates`
seeds the equilibrium init; the raw generator init Euler-explodes.

**Two stacks:** the original (`modelClass`/`modelEq`) runs fixed-step `diffrax.Euler`
only; the SI fork (`modelClassSI`/`modelEqSI`, "step-independent") makes the cycle
operators dt-independent and adds solver dispatch (euler/rk4/adaptive) selected from
`scenario.shared.integration.solver`.

Two HARD RULES came with this code and still apply:

- **Single config surface.** A configurable value exists in exactly three places: a
  default at the definition site, the model/scenario JSON, or the caller's `runConfig`
  dict (wired through `buildSimulationParams`). Never add a knob that needs a library edit,
  and never invent a second override mechanism.
- **GPU is off by default.** Benchmarked 1.7–2.7× *slower* than CPU for this workload —
  a long sequential `lax.scan` over a tiny state vector is launch-latency bound
  ([[gpu-no-benefit]]). Both images install `jax[cpu]`; never commit `useGpu: True`.

### DB init (`init-scripts/`)
Files run alphabetically on a fresh postgres volume:
- `01-init-db.sql` — framework schema and seeds (component editor forms, survey forms, content editor forms, files table).
- `seed-landing.sql` — full content tree: base nodes, welcome card, App Guide, Developer Guide.
- `02-init-<domain>.sql` — domain tables, added per project.
- `seed-physiology.sql` — **generated**, never hand-edit a config blob in it: every
  shipped model / scenario / processing / plot config, produced by
  `scripts/gen-physiology-seed.py` from `python/config/**`. Disk stays canonical (the
  library loads it directly); re-run the generator and commit both after changing a
  config file.

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

### Seeding content images

Content images always go through MinIO + the `files` table:

1. Place PNGs under `pwa/public/` (e.g. `pwa/public/screenshots/`); `pwa/public` is mounted read-only at `/public` in the nodejs container.
2. On startup `backend.js` scans `/public/**/*.png` (skipping `favicon.png`), seeds each into MinIO with key `seed-<basename>`, and inserts a `files` row (`ON CONFLICT DO NOTHING`).
3. Seed SQL references images as `"src": "/api/files/seed-<filename>/download-by-key"` (origin-relative — the same seed works in dev behind the vite proxy and in prod behind Caddy).

**Never** use static paths like `"/screenshots/app-foo.png"` as `data.src` — images must have `files` rows and survive DB resets via stable keys. Never bake an absolute host into `data.src`.
