from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Domain routers are included here — one per python/api/domains/<domain>/routes.py
# (see .claude/rules/python-compute.md): app.include_router(<domain>_router)


@app.get("/health")
def health():
    return {"status": "ok"}
