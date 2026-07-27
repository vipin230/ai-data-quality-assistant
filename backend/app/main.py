from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import rules, run, tables
from app.services.store import init_schema

app = FastAPI(title="AI Data Quality Assistant", version="0.1.0")


@app.on_event("startup")
def on_startup():
    # Creates the dq_assistant schema/tables in the connected Postgres DB
    # if they don't exist yet. No-ops safely if already present.
    try:
        init_schema()
    except Exception as exc:  # pragma: no cover - surfaced via logs, app still boots
        print(f"[startup] Skipping schema init (DB not reachable yet): {exc}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tables.router)
app.include_router(rules.router)
app.include_router(run.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
