from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from app.services import ai_rules, db, rules_store

router = APIRouter(prefix="/api/rules", tags=["rules"])


class NLRuleRequest(BaseModel):
    text: str


class ManualRuleRequest(BaseModel):
    expectation_type: str
    kwargs: dict
    description: str | None = None


class RuleUpdateRequest(BaseModel):
    kwargs: dict | None = None
    description: str | None = None
    enabled: bool | None = None


def _serialize(rule) -> dict:
    return {
        "id": rule.id,
        "expectation_type": rule.expectation_type,
        "kwargs": rule.kwargs,
        "description": rule.description,
        "source": rule.source,
        "nl_prompt": rule.nl_prompt,
        "enabled": rule.enabled,
    }


def _validated_table(table_name: str) -> str:
    if table_name not in db.list_tables():
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")
    return table_name


@router.get("/{table_name}", summary="List stored rules for a table")
def get_rules(table_name: str):
    """Return all AI-generated, natural-language, and manually created rules
    currently stored for this table (enabled and disabled)."""
    _validated_table(table_name)
    rules = rules_store.list_rules(table_name)
    return {"table": table_name, "rules": [_serialize(r) for r in rules]}


@router.post("/{table_name}/generate", summary="AI: suggest rules from schema + sample data")
def generate_rules(table_name: str):
    """AI: auto-suggest rules from schema + sample data.

    Sends the table's column schema and up to 20 sample rows to the LLM,
    constrained to a whitelist of supported Great Expectations types.
    Duplicate suggestions (same expectation_type + kwargs as an existing
    rule) are silently skipped - response reports `added_count` and
    `duplicate_count` so the UI can show "N new rules added" instead of
    appearing to do nothing on repeat clicks.
    """
    _validated_table(table_name)
    columns = db.get_table_schema(table_name)
    sample_rows = db.get_sample_rows(table_name, limit=20)
    try:
        suggested = ai_rules.generate_rules_from_schema(table_name, columns, sample_rows)
    except RuntimeError as exc:
        # e.g. missing OPENAI_API_KEY
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        # LLM timeout / bad JSON / API error - never let this 500 silently
        raise HTTPException(status_code=502, detail=f"AI rule generation failed: {exc}")
    if not suggested:
        return {"table": table_name, "rules": [], "added_count": 0}
    created = rules_store.add_rules(table_name, suggested, source="ai_auto")
    return {
        "table": table_name,
        "rules": [_serialize(r) for r in created],
        "added_count": len(created),
        "duplicate_count": len(suggested) - len(created),
    }


@router.post("/{table_name}/nl", summary="AI: convert plain English into a rule")
def add_nl_rule(table_name: str, req: NLRuleRequest):
    """AI: convert a natural-language description into one or more rules.

    Example: `{"text": "email should be unique"}` ->
    `expect_column_values_to_be_unique` on the `email` column.
    """
    _validated_table(table_name)
    columns = db.get_table_schema(table_name)
    try:
        suggested = ai_rules.generate_rule_from_nl(table_name, columns, req.text)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI rule generation failed: {exc}")
    if not suggested:
        raise HTTPException(
            status_code=422,
            detail="Could not convert that description into a supported rule. Try rephrasing.",
        )
    created = rules_store.add_rules(table_name, suggested, source="ai_nl", nl_prompt=req.text)
    return {"table": table_name, "rules": [_serialize(r) for r in created]}


@router.post("/{table_name}/manual", summary="Add a rule manually (no AI)")
def add_manual_rule(table_name: str, req: ManualRuleRequest):
    """Add a hand-crafted rule directly, bypassing the AI layer entirely -
    still validated against the same expectation-type whitelist."""
    _validated_table(table_name)
    if req.expectation_type not in ai_rules.SUPPORTED_EXPECTATIONS:
        raise HTTPException(status_code=400, detail="Unsupported expectation_type")
    created = rules_store.add_rules(
        table_name,
        [{"expectation_type": req.expectation_type, "kwargs": req.kwargs, "description": req.description}],
        source="manual",
    )
    return {"table": table_name, "rules": [_serialize(r) for r in created]}


@router.patch("/rule/{rule_id}", summary="Edit an existing rule")
def update_rule(rule_id: int, req: RuleUpdateRequest):
    """Edit a rule's kwargs/description/enabled state (e.g. after
    AI-suggesting a rule, a user tweaks the threshold before running it)."""
    rule = rules_store.update_rule(rule_id, **req.model_dump(exclude_unset=True))
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return _serialize(rule)


@router.delete("/rule/{rule_id}", summary="Delete a rule")
def delete_rule(rule_id: int):
    """Permanently remove a rule so it's no longer run for its table."""
    ok = rules_store.delete_rule(rule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"deleted": True}
