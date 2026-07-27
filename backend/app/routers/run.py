from fastapi import APIRouter, HTTPException

from app.services import db, ge_engine, results_store, rules_store

router = APIRouter(prefix="/api/run", tags=["run"])


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


@router.post("/{table_name}")
def run_rules(table_name: str):
    """Execute all enabled rules for a table and cache the result."""
    _validated_table(table_name)
    rules = [r for r in rules_store.list_rules(table_name) if r.enabled]
    if not rules:
        raise HTTPException(status_code=400, detail="No enabled rules to run for this table")

    rule_dicts = [
        {"id": r.id, "expectation_type": r.expectation_type, "kwargs": r.kwargs, "description": r.description}
        for r in rules
    ]
    run = ge_engine.run_suite(table_name, rule_dicts)
    record = results_store.save_run_result(table_name, run)
    return _serialize_run(record)


@router.get("/{table_name}/latest")
def latest_result(table_name: str):
    _validated_table(table_name)
    record = results_store.get_latest_result(table_name)
    if record is None:
        return {"table": table_name, "result": None}
    return _serialize_run(record)


@router.get("/{table_name}/history")
def history(table_name: str, limit: int = 20):
    _validated_table(table_name)
    records = results_store.get_history(table_name, limit)
    return {"table": table_name, "runs": [_serialize_run(r) for r in records]}
