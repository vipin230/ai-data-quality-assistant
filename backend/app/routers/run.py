from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import SQLAlchemyError
import time

from app.logging_config import get_logger
from app.services import db, ge_engine, results_store, rules_store

logger = get_logger(__name__)

router = APIRouter(prefix="/api/run", tags=["run"])

# Quick-view cache for the latest result per table: avoids a DB round-trip
# every time the Results tab is reopened. Invalidated immediately whenever
# a fresh run completes for that table, so it never shows stale data after
# a re-run - it only saves repeated reads of an unchanged result.
_latest_cache: dict[str, dict] = {}
_LATEST_TTL_SECONDS = 15


def _validated_table(table_name: str) -> str:
    if table_name not in db.list_tables():
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")
    return table_name


def _serialize_run(record) -> dict:
    return {
        "id": record.id,
        "table": record.table_name,
        "success": record.success,
        "summary": record.summary,
        "results": record.results,
        "run_at": record.run_at.isoformat() if record.run_at else None,
    }


@router.post("/{table_name}", summary="Run all enabled rules for a table")
def run_rules(table_name: str):
    """Execute all enabled rules for a table and cache the result.

    Loads up to 5,000 rows (see `ge_engine.run_suite`), runs each stored rule
    through Great Expectations, and persists the result to run history. The
    response's `summary.sampled` flag indicates whether the run covered the
    full table or only a sample.
    """
    _validated_table(table_name)
    rules = [r for r in rules_store.list_rules(table_name) if r.enabled]
    if not rules:
        raise HTTPException(status_code=400, detail="No enabled rules to run for this table")

    rule_dicts = [
        {"id": r.id, "expectation_type": r.expectation_type, "kwargs": r.kwargs, "description": r.description}
        for r in rules
    ]
    try:
        run = ge_engine.run_suite(table_name, rule_dicts)
    except SQLAlchemyError as exc:
        logger.warning("DB error while running rules for table=%s: %s", table_name, exc)
        raise HTTPException(status_code=503, detail="Could not read data from the database. Please try again.")
    except Exception as exc:
        logger.exception("Unexpected error running rules for table=%s", table_name)
        raise HTTPException(status_code=500, detail=f"Failed to execute rules: {exc}")
    record = results_store.save_run_result(table_name, run)
    serialized = _serialize_run(record)
    _latest_cache[table_name] = {"data": serialized, "expires_at": time.time() + _LATEST_TTL_SECONDS}
    return serialized


@router.get("/{table_name}/latest", summary="Get the latest run result for a table")
def latest_result(table_name: str):
    """Return the most recent run result (cached for 15s for quick viewing).
    Returns `{"result": null}` if the table has never been run."""
    _validated_table(table_name)
    cached = _latest_cache.get(table_name)
    if cached is not None and cached["expires_at"] > time.time():
        return {**cached["data"], "cached": True}

    record = results_store.get_latest_result(table_name)
    if record is None:
        return {"table": table_name, "result": None}
    serialized = _serialize_run(record)
    _latest_cache[table_name] = {"data": serialized, "expires_at": time.time() + _LATEST_TTL_SECONDS}
    return serialized


@router.get("/{table_name}/history", summary="Get past run results for a table")
def history(table_name: str, limit: int = 20):
    """Return the last `limit` run results for a table, most recent first."""
    _validated_table(table_name)
    records = results_store.get_history(table_name, limit)
    return {"table": table_name, "runs": [_serialize_run(r) for r in records]}
