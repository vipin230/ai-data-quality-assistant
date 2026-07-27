"""Database connectivity + schema/sample-data introspection for the target Postgres DB."""
import time

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.config import get_settings

_engine: Engine | None = None

# Simple TTL cache for the table list + row counts: this is the one query
# that runs on every Table Explorer page load, and row counts (COUNT(*)) can
# be expensive on large tables, so we avoid recomputing them on every hit.
_TABLES_CACHE_TTL_SECONDS = 30
_tables_cache: dict = {"data": None, "expires_at": 0.0}


def invalidate_tables_cache() -> None:
    _tables_cache["data"] = None
    _tables_cache["expires_at"] = 0.0


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
        _engine = create_engine(settings.database_url, pool_pre_ping=True)
    return _engine


def list_tables() -> list[str]:
    query = text(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """
    )
    with get_engine().connect() as conn:
        return [row[0] for row in conn.execute(query)]


def get_table_schema(table_name: str) -> list[dict]:
    query = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = :table_name
        ORDER BY ordinal_position
        """
    )
    with get_engine().connect() as conn:
        rows = conn.execute(query, {"table_name": table_name}).mappings().all()
        return [dict(row) for row in rows]


def get_table_row_count(table_name: str) -> int:
    # table_name is validated against information_schema before use in routers
    query = text(f'SELECT COUNT(*) FROM "{table_name}"')
    with get_engine().connect() as conn:
        return conn.execute(query).scalar_one()


def get_sample_rows(table_name: str, limit: int = 20) -> list[dict]:
    query = text(f'SELECT * FROM "{table_name}" LIMIT :limit')
    with get_engine().connect() as conn:
        rows = conn.execute(query, {"limit": limit}).mappings().all()
        return [dict(row) for row in rows]
