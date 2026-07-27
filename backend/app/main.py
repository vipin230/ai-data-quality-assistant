from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.logging_config import configure_logging, get_logger
from app.routers import rules, run, tables
from app.services.store import init_schema, reset_state

configure_logging()
logger = get_logger(__name__)

app = FastAPI(
    title="AI Data Quality Assistant",
    version="0.1.0",
    description=(
        "AI-powered data quality rules for PostgreSQL tables using Great "
        "Expectations. Browse tables, get AI-suggested rules (or describe "
        "one in plain English), run checks, and view results - all without "
        "writing GE code by hand."
    ),
)


@app.on_event("startup")
def on_startup():
    # Creates the dq_assistant schema/tables in the connected Postgres DB
    # if they don't exist yet. No-ops safely if already present.
    try:
        init_schema()
        reset_state()
        logger.info("dq_assistant schema initialized (clean slate)")
    except Exception as exc:  # pragma: no cover - surfaced via logs, app still boots
        logger.warning("Skipping schema init (DB not reachable yet): %s", exc)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().frontend_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tables.router)
app.include_router(rules.router)
app.include_router(run.router)


@app.get("/api/health", summary="Health check")
def health():
    """Simple liveness check - returns ok if the API process is running
    (does not verify database/LLM connectivity)."""
    return {"status": "ok"}
