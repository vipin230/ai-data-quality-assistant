"""AI rule generator: schema+sample-data -> Great Expectations rules,
and natural-language description -> a single Great Expectations rule.

Design notes (documented for the case-study write-up):
- We constrain the LLM to ONLY choose from a whitelist of supported GE
  expectation types, and force strict JSON output, to avoid hallucinated /
  unsafe expectations reaching the execution engine.
- Every AI-generated rule is validated against `SUPPORTED_EXPECTATIONS`
  before being stored or executed.
"""
import json
import time

from openai import OpenAI

from app.config import get_settings
from app.logging_config import get_logger

logger = get_logger(__name__)

# Whitelist of GE expectation types we support end-to-end (kept small & safe on purpose)
SUPPORTED_EXPECTATIONS = {
    "expect_column_values_to_not_be_null",
    "expect_column_values_to_be_unique",
    "expect_column_values_to_be_between",
    "expect_column_values_to_match_regex",
    "expect_column_values_to_be_in_set",
    "expect_column_value_lengths_to_be_between",
    "expect_column_values_to_be_of_type",
    "expect_table_row_count_to_be_between",
    "expect_column_values_to_be_in_type_list",
}

_SYSTEM_PROMPT = f"""You are a data quality expert. You generate Great Expectations
expectations as strict JSON. You may ONLY use these expectation_type values:
{sorted(SUPPORTED_EXPECTATIONS)}

Always respond with a JSON object of the shape:
{{"rules": [{{"expectation_type": "...", "kwargs": {{...}}, "description": "plain english reason"}}]}}

Rules:
- "kwargs" must always include "column" (except for expect_table_row_count_to_be_between).
- Only suggest rules that are clearly justified by the column name, data type, or sample values shown.
- Do not invent columns that are not in the schema.
- Prefer a small number of high-confidence rules over many speculative ones,
  but this is about avoiding unrelated guesses, NOT about merging or dropping
  distinct conditions the user explicitly stated. If the user's text names
  multiple separate conditions (e.g. joined by "and", commas, or separate
  sentences, possibly on different columns), you MUST return one rule per
  stated condition, not just the one you find most confident.
- "email should not be empty" means the column must have a real value: use
  expect_column_value_lengths_to_be_between (min_value=1) or a regex rule,
  NOT expect_column_values_to_not_be_null (which only catches NULL, not "").
- Output ONLY the JSON object, no prose, no markdown fences.
"""


def _client() -> OpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set in .env")
    # timeout + max_retries are handled natively by the OpenAI SDK
    # (exponential backoff on transient 5xx/connection errors), so a slow
    # or flaky network doesn't leave a request hanging indefinitely or
    # fail on the first blip.
    return OpenAI(
        api_key=settings.openai_api_key,
        timeout=settings.llm_timeout_seconds,
        max_retries=settings.llm_max_retries,
    )


def _call_llm(user_prompt: str) -> dict:
    settings = get_settings()
    client = _client()
    started = time.monotonic()
    resp = client.chat.completions.create(
        model=settings.llm_model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    elapsed_ms = (time.monotonic() - started) * 1000
    content = resp.choices[0].message.content
    logger.info(
        "LLM call model=%s elapsed_ms=%.0f prompt_tokens=%s completion_tokens=%s",
        settings.llm_model,
        elapsed_ms,
        getattr(resp.usage, "prompt_tokens", None),
        getattr(resp.usage, "completion_tokens", None),
    )
    return json.loads(content)


def _validate_rules(raw_rules: list[dict]) -> list[dict]:
    """Drop/repair anything that doesn't match our safe whitelist + shape."""
    clean = []
    for r in raw_rules:
        etype = r.get("expectation_type")
        kwargs = r.get("kwargs", {})
        if etype not in SUPPORTED_EXPECTATIONS:
            logger.warning("Dropping AI-suggested rule with unsupported expectation_type=%r", etype)
            continue
        if not isinstance(kwargs, dict):
            logger.warning("Dropping AI-suggested rule with non-dict kwargs for %r", etype)
            continue
        if etype != "expect_table_row_count_to_be_between" and "column" not in kwargs:
            logger.warning("Dropping AI-suggested rule missing 'column' kwarg for %r", etype)
            continue
        clean.append(
            {
                "expectation_type": etype,
                "kwargs": kwargs,
                "description": r.get("description", ""),
            }
        )
    return clean


def validate_kwargs_for_table(expectation_type: str, kwargs: dict, columns: list[dict]) -> str | None:
    """Structural sanity check reused by manual-add and rule-edit endpoints
    (AI-generated rules already go through `_validate_rules`). Returns an
    error message, or None if the kwargs look sane for this table/column.

    ponytail: shape/column checks only, not full GE-schema validation -
    upgrade to GE's own expectation config validation if bad edits keep
    slipping past this.
    """
    if not isinstance(kwargs, dict):
        return "kwargs must be an object"
    column_names = {c["column_name"] for c in columns}
    if expectation_type != "expect_table_row_count_to_be_between":
        column = kwargs.get("column")
        if not column:
            return "kwargs.column is required"
        if column not in column_names:
            return f"Column {column!r} does not exist on this table"
    if "value_set" in kwargs and (not isinstance(kwargs["value_set"], list) or len(kwargs["value_set"]) == 0):
        return "value_set must be a non-empty list"
    for key in ("min_value", "max_value"):
        if key in kwargs and kwargs[key] is not None and not isinstance(kwargs[key], (int, float)):
            return f"{key} must be a number"
    if "regex" in kwargs and kwargs["regex"]:
        import re

        try:
            re.compile(kwargs["regex"])
        except re.error as exc:
            return f"Invalid regex: {exc}"
    return None


def generate_rules_from_schema(table_name: str, columns: list[dict], sample_rows: list[dict]) -> list[dict]:
    user_prompt = (
        f"Table name: {table_name}\n\n"
        f"Columns (name, data_type, is_nullable):\n{json.dumps(columns, default=str)}\n\n"
        f"Sample rows (up to 20):\n{json.dumps(sample_rows, default=str)[:6000]}\n\n"
        "Suggest data quality rules for this table."
    )
    result = _call_llm(user_prompt)
    return _validate_rules(result.get("rules", []))


def generate_rule_from_nl(table_name: str, columns: list[dict], nl_text: str) -> list[dict]:
    user_prompt = (
        f"Table name: {table_name}\n\n"
        f"Columns (name, data_type, is_nullable):\n{json.dumps(columns, default=str)}\n\n"
        f"The user wrote this rule in plain English:\n\"{nl_text}\"\n\n"
        "Convert it into one or more Great Expectations rules."
    )
    result = _call_llm(user_prompt)
    return _validate_rules(result.get("rules", []))
