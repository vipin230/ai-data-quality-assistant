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


def get_session() -> Session:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _SessionLocal()
