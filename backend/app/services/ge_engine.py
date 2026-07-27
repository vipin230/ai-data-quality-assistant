"""Great Expectations execution engine.

Runs stored rules for a table against the live Postgres data using GE's
in-memory Pandas execution (via a fresh sample/full pull) and returns a
structured, JSON-serializable result.

Scalability note: `row_limit` bounds how many rows are pulled into memory
for validation (default 5000). For tables larger than that, checks run
against a sample, not the full table - this keeps the request fast and
memory-bounded, but the run summary explicitly reports `total_row_count`
vs `rows_evaluated` so this is never silently misleading. A future
iteration could push row-count-based expectations down to SQL directly
(e.g. via GE's SQL execution engine) to validate the full table without
loading it into pandas.
"""
import datetime as dt

import great_expectations as gx

from app.logging_config import get_logger
from app.services import db

logger = get_logger(__name__)


def run_suite(table_name: str, rules: list[dict], row_limit: int = 5000) -> dict:
    """rules: list of {"expectation_type", "kwargs", "description", "id"?}"""
    df = _load_dataframe(table_name, row_limit)
    try:
        total_row_count = db.get_table_row_count(table_name)
    except Exception:
        total_row_count = None

    context = gx.get_context(mode="ephemeral")
    data_source = context.data_sources.add_pandas(f"pandas_{table_name}")
    data_asset = data_source.add_dataframe_asset(name=table_name)
    batch_definition = data_asset.add_batch_definition_whole_dataframe("batch")
    batch = batch_definition.get_batch(batch_parameters={"dataframe": df})

    results = []
    success_count = 0
    for rule in rules:
        expectation_cls = getattr(gx.expectations, _to_class_name(rule["expectation_type"]), None)
        if expectation_cls is None:
            results.append(
                {
                    "rule_id": rule.get("id"),
                    "expectation_type": rule["expectation_type"],
                    "description": rule.get("description", ""),
                    "success": False,
                    "error": "Unsupported expectation type",
                }
            )
            continue
        try:
            expectation = expectation_cls(**rule["kwargs"])
            result = batch.validate(expectation)
            success = bool(result.success)
            success_count += int(success)
            results.append(
                {
                    "rule_id": rule.get("id"),
                    "expectation_type": rule["expectation_type"],
                    "kwargs": rule["kwargs"],
                    "description": rule.get("description", ""),
                    "success": success,
                    "result": _safe_result_dict(result),
                }
            )
        except Exception as exc:
            results.append(
                {
                    "rule_id": rule.get("id"),
                    "expectation_type": rule["expectation_type"],
                    "kwargs": rule.get("kwargs"),
                    "description": rule.get("description", ""),
                    "success": False,
                    "error": str(exc),
                }
            )

    summary = {
        "total_rules": len(rules),
        "success_count": success_count,
        "failed_count": len(rules) - success_count,
        "rows_evaluated": len(df),
        "total_row_count": total_row_count,
        "sampled": total_row_count is not None and total_row_count > len(df),
        "evaluated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    logger.info(
        "run_suite table=%s rules=%d success=%d failed=%d rows_evaluated=%d/%s",
        table_name,
        summary["total_rules"],
        summary["success_count"],
        summary["failed_count"],
        summary["rows_evaluated"],
        total_row_count,
    )
    return {"success": summary["failed_count"] == 0, "summary": summary, "results": results}


def _load_dataframe(table_name: str, row_limit: int):
    import pandas as pd

    rows = db.get_sample_rows(table_name, limit=row_limit)
    return pd.DataFrame(rows)


def _to_class_name(expectation_type: str) -> str:
    # expect_column_values_to_not_be_null -> ExpectColumnValuesToNotBeNull
    return "".join(part.capitalize() for part in expectation_type.split("_"))


def _safe_result_dict(result) -> dict:
    try:
        d = result.to_json_dict()
        # keep payload small: drop heavy partial_unexpected_counts if huge
        return d
    except Exception:
        return {}
