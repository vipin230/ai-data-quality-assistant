from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import OperationalError, SQLAlchemyError
import time

from app.services import db

router = APIRouter(prefix="/api/tables", tags=["tables"])


def _validated_table(table_name: str) -> str:
    if table_name not in db.list_tables():
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")
    return table_name


def _wrap_db_errors(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except RuntimeError as exc:
        # DATABASE_URL not configured
        raise HTTPException(status_code=500, detail=str(exc))
    except OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Could not connect to the database: {exc.orig}")
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.get("", summary="List database tables")
def list_tables():
    """List all user tables in the connected database with row counts.

    Cached for 30s (`db._TABLES_CACHE_TTL_SECONDS`) to avoid re-scanning the
    database on every page load; response includes `cached: true/false`.
    """
    cached = db._tables_cache
    if cached["data"] is not None and cached["expires_at"] > time.time():
        return {"tables": cached["data"], "cached": True}

    tables = _wrap_db_errors(db.list_tables)
    result = []
    for t in tables:
        try:
            row_count = db.get_table_row_count(t)
        except Exception:
            row_count = None
        result.append({"name": t, "row_count": row_count})

    db._tables_cache["data"] = result
    db._tables_cache["expires_at"] = time.time() + db._TABLES_CACHE_TTL_SECONDS
    return {"tables": result, "cached": False}


@router.get("/{table_name}/schema", summary="Get column schema for a table")
def table_schema(table_name: str):
    """Return column name, data type, and nullability for the given table."""
    _validated_table(table_name)
    return {"table": table_name, "columns": _wrap_db_errors(db.get_table_schema, table_name)}


@router.get("/{table_name}/sample", summary="Get sample rows from a table")
def table_sample(table_name: str, limit: int = 20):
    """Return up to `limit` sample rows, used both for the UI preview and as
    context for AI rule generation."""
    _validated_table(table_name)
    return {"table": table_name, "rows": _wrap_db_errors(db.get_sample_rows, table_name, limit)}
