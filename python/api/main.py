from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# [SURVEYS]
from api.domains.surveys.routes import router as surveys_router
# [MEDICAL]
from api.domains.medical.cardio_routes import router as cardio_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Domain routers are included here — one per python/api/domains/<domain>/routes.py
# (see .claude/rules/python-compute.md): app.include_router(<domain>_router)
app.include_router(surveys_router)
app.include_router(cardio_router)


@app.get("/health")
def health():
    return {"status": "ok"}
