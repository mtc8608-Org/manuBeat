---
name: new-compute
description: Add a Python computation endpoint and its Node caller route. Use when a feature needs numeric analysis, pandas, LaTeX compilation, or other computation that belongs in the Python service.
---

# New compute endpoint

Add a computation to the Python service plus the Node route that feeds and persists it. Conventions in `.claude/rules/python-compute.md` — read it first. The split is absolute: Python computes, Node owns all DB/MinIO access and auth.

## Procedure

1. **Python endpoint** — `python/api/domains/<domain>/routes.py` (fork example: manuHunter's `python/api/domains/latex/routes.py`): `router = APIRouter(prefix="/<domain>")`, pydantic request models, numbered module docstring stating what it computes and that Node persists. New domain → `app.include_router(...)` in `api/main.py`.
2. **Node caller** — a REST route (framework: `nodejs/routes/framework/`; forks: `nodejs/routes/<domain>/`), registered in `backend.js` (see the `new-api` skill for route conventions), that:
   - checks `req.user` and owner-scopes the entity being computed on,
   - gathers inputs from Postgres and POSTs them as JSON to `http://${process.env.PYTHON_HOST}:${process.env.PYTHON_PORT}/<domain>/<endpoint>` (`responseType: 'arraybuffer'` for binary),
   - persists or streams the result itself, translating Python error bodies into useful client errors (`compileErrorPayload` pattern in manuHunter's `routes/cv/compile.js`).
3. **Frontend** — wrapper in `pwa/src/services/Api.ts` calling the Node route (never Python directly — the Python port is internal).
4. **Do not run the app.** Finish by stating the command: `./run rebuild python` if `requirements.txt` changed, otherwise plain `./run`.
