---
paths:
  - "python/**"
---

# Python service conventions

## Division of labour (non-negotiable)

Python owns computation only — it **never touches Postgres or MinIO**, holds no credentials for them, and persists nothing. Node fetches inputs from the DB, POSTs them as JSON to Python, and persists/streams the result itself (`routes/framework/compute.js`; fork example: manuHunter's `routes/cv/compile.js`). If a Python endpoint seems to need a DB read, the query belongs in the Node caller and its rows in the request body.

Python is also **unauthenticated** — it is only reachable inside the docker network, and all auth/owner-scoping happens in the Node route before the call. Never expose the Python port publicly or add endpoints that assume a user identity.

## Module layout

- One subdirectory per domain: `python/api/domains/<domain>/routes.py` with `router = APIRouter(prefix="/<domain>")`, included in `api/main.py` with `app.include_router(...)`.
- Request bodies are pydantic `BaseModel`s — never raw dicts.
- Each `routes.py` opens with a module docstring that states, numbered and explicitly, what the module computes and ends by restating the Node/Python split (see `domains/compute/routes.py`).
- Binary/file responses use `StreamingResponse` with an explicit `media_type` and `Content-Disposition`.

## Node caller conventions

- URL built from env: `http://${process.env.PYTHON_HOST}:${process.env.PYTHON_PORT}/<domain>/<endpoint>`.
- `axios.post(url, payload, { responseType: 'arraybuffer' })` for binary results; translate Python error bodies into useful client errors (`compileErrorPayload` pattern in manuHunter's `routes/cv/compile.js`).

## Dependencies

New Python packages go in `python/requirements.txt` and require `./run rebuild python` (state it; never run it yourself).
