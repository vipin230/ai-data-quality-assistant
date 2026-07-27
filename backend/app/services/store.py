"""Session/engine helpers for the dq_assistant metadata tables, plus init-schema."""
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.models.rules import Base
from app.services.db import get_engine

_SessionLocal: sessionmaker | None = None


def init_schema() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS dq_assistant"))
    Base.metadata.create_all(engine)


def reset_state() -> None:
    """Wipe stored rules/run results so each backend start is a clean slate.

    ponytail: TRUNCATE, not a soft "demo mode" flag - swap for real per-user
    persistence if this ever needs to survive restarts for real users.
    """
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE TABLE dq_assistant.run_results, dq_assistant.rules, "
                "dq_assistant.rule_suites RESTART IDENTITY CASCADE"
            )
        )


def get_session() -> Session:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _SessionLocal()
