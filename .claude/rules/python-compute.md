---
paths:
  - "python/**"
---

# Python service conventions

## Division of labour (non-negotiable)

Python owns computation only — it **never touches Postgres or MinIO**, holds no credentials for them, and persists nothing. Node fetches inputs from the DB, POSTs them as JSON to Python, and persists/streams the result itself (fork example: manuHunter's `routes/cv/compile.js`). If a Python endpoint seems to need a DB read, the query belongs in the Node caller and its rows in the request body.

Python is also **unauthenticated** — it is only reachable inside the docker network, and all auth/owner-scoping happens in the Node route before the call. Never expose the Python port publicly or add endpoints that assume a user identity.

## Module layout

- One subdirectory per domain: `python/api/domains/<domain>/routes.py` with `router = APIRouter(prefix="/<domain>")`, included in `api/main.py` with `app.include_router(...)`.
- Request bodies are pydantic `BaseModel`s — never raw dicts.
- Each `routes.py` opens with a module docstring that states, numbered and explicitly, what the module computes and ends by restating the Node/Python split (fork example: manuHunter's `python/api/domains/latex/routes.py`).
- Binary/file responses use `StreamingResponse` with an explicit `media_type` and `Content-Disposition`.

## Shelling out (non-negotiable)

Python is unauthenticated and reachable by anything inside the docker network, so an endpoint that runs a subprocess is the softest target in the stack. Any endpoint invoking an external binary must, without exception:

- **Disable shell escape** in the tool itself where it exists (`-no-shell-escape` for TeX), and never build the command as a shell string — pass an argv list to `subprocess.run` so caller input can never become a shell token.
- **Work only inside a `tempfile.TemporaryDirectory()`**, never the repo or a shared path, so concurrent calls cannot see or clobber each other and nothing survives the request.
- **Pass a hard `timeout=` and handle `subprocess.TimeoutExpired`** — an unbounded compile is a CPU DoS reachable by any account that can hit the Node caller.

The Node caller owns auth, owner-scoping and rate limiting *before* the call; none of that protects the subprocess itself, which is why these three are Python-side requirements rather than advice. Worked example: manuHunter's `python/api/domains/latex/routes.py`.

## Node caller conventions

- URL built from env: `http://${process.env.PYTHON_HOST}:${process.env.PYTHON_PORT}/<domain>/<endpoint>`.
- `axios.post(url, payload, { responseType: 'arraybuffer' })` for binary results; translate Python error bodies into useful client errors (`compileErrorPayload` pattern in manuHunter's `routes/cv/compile.js`).

## Dependencies

`python/requirements.txt` is the intent file (top-level packages, unpinned); `python/requirements.lock` is the enforced `pip freeze` the image actually installs. New packages go in `requirements.txt`, then the lock is regenerated and the image rebuilt — both user-run (state them; never run them yourself):

```bash
docker compose run --rm --no-deps python sh -c 'pip install -q -r /src/requirements.txt >/dev/null && pip freeze' > python/requirements.lock
./run rebuild python
```

**This only works for additions.** The freeze runs inside the existing app image, where the old packages are already installed — `pip install` never uninstalls, so a package removed from `requirements.txt` silently stays pinned in the lock (learned 2026-07-04 removing pandas). Removing a package needs one of these instead (still user-run):

```bash
# clean-room regen in the BASE image (not the app image), then rebuild
docker run --rm -v "$PWD/python:/src" python:3.13 sh -c 'pip install -q -r /src/requirements.txt >/dev/null && pip freeze' > python/requirements.lock
./run rebuild python
```

or hand-delete the package's line (plus its now-orphaned transitive deps) from the lock — equally correct when the dependency tree is obvious. Stale extra pins are harmless bloat, not breakage, so a removal may also deliberately be left in place (pandas/numpy currently are).
