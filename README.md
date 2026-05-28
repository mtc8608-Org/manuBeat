# ManuSpine

A full-stack SaaS framework for building data-driven web apps. Provides auth, a component-tree CMS, surveys, file storage, and a Python computation layer — all in one Docker stack.

Use it as a **GitHub Template** to bootstrap new apps.

---

## What's included

| Layer | Tech | Purpose |
|-------|------|---------|
| Frontend | React + Ionic + Vite | SPA with shell components, routing, auth |
| Backend | Node.js + Express + GraphQL | API, auth, business logic |
| DB | PostgreSQL 16 | Relational store; JSONB for flexible component data |
| Storage | MinIO | Object storage for files / images |
| Computation | Python + FastAPI | Domain-specific compute; Node.js proxies here |

### Framework features

- **Component tree system** — UI structure (forms, inputs, charts) stored as JSONB nodes. Rendered dynamically by `FormRenderer` / `TreeEditor`.
- **Survey system** — parallel component tree for building and running surveys with answer storage.
- **Content / CMS** — hierarchical content pages with HTML, Image, HTML+Image, and LaTeX card types. Editable from the Backoffice.
- **Files** — MinIO-backed file upload, listing, and description management.
- **Auth** — JWT-based login, roles (`admin` / `user`), change-password.
- **Shell components** — `SplitPageLayout`, `TabPanel`, `ResourcePanel`, `DataTable`, `ModalShell`, `EmptyState`, `TreeEditor`.

---

## Running

```bash
cp .env.example .env          # edit credentials
./run                         # start all services
./run reset                   # wipe DB + MinIO and restart
./run rebuild <service>       # rebuild after Dockerfile changes
./run down                    # stop everything
```

Service URLs:
- Frontend: http://localhost:8100
- GraphQL: http://localhost:3000/graphql
- Python: http://localhost:5000

---

## Adding a domain

A domain is a vertical slice of functionality (e.g. finance, medical, e-commerce). Each domain adds:

### 1. DB tables — `init-scripts/02-init-<domain>.sql`

```sql
CREATE TABLE my_things (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

File is picked up alphabetically by postgres on first start. Run `./run reset` to apply.

### 2. Node.js routes — `nodejs/routes/<domain>/things.js`

```js
const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
// ... REST endpoints
module.exports = router;
```

Register in `nodejs/backend.js`:
```js
// [MY DOMAIN]
server.use('/api', require('./routes/<domain>/things'));
```

### 3. GraphQL resolvers — `nodejs/schema/resolvers/<domain>/things.js`

```js
module.exports = {
  queries: { /* ... */ },
  mutations: { /* ... */ },
};
```

Register in `nodejs/schema/index.js`:
```js
const thingResolvers = require('./resolvers/<domain>/things');
// add to Query fields and Mutation fields
```

### 4. Python routes (optional) — `python/api/domains/<domain>/`

```python
from fastapi import APIRouter
router = APIRouter()

@router.get("/<domain>/health")
def domain_health():
    return {"ok": True}
```

Register in `python/api/main.py`:
```python
from .domains.<domain>.routes import router as domain_router
app.include_router(domain_router)
```

### 5. Frontend — `pwa/src/pages/<domain>/` and `pwa/src/domains/<domain>/constants.ts`

- Add page files following the `SplitPageLayout` pattern (see existing pages).
- Add constants to `pwa/src/constants.ts` marked `// [MY DOMAIN]`.
- Register routes in `pwa/src/App.tsx` and nav in `pwa/src/components/shell/Menu.tsx`.

---

## Template usage

1. Click **Use this template** on GitHub.
2. Clone your new repo.
3. Copy `.env.example` → `.env` and set your credentials.
4. `./run` to start.
5. Sign in at http://localhost:8100 with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
6. Add your domain following the steps above.
