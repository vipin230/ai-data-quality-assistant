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

from openai import OpenAI

from app.config import get_settings

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
- Prefer a small number of high-confidence rules over many speculative ones.
- Output ONLY the JSON object, no prose, no markdown fences.
"""


def _client() -> OpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set in .env")
    return OpenAI(api_key=settings.openai_api_key)


def _call_llm(user_prompt: str) -> dict:
    settings = get_settings()
    client = _client()
    resp = client.chat.completions.create(
        model=settings.llm_model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    content = resp.choices[0].message.content
    return json.loads(content)


def _validate_rules(raw_rules: list[dict]) -> list[dict]:
    """Drop/repair anything that doesn't match our safe whitelist + shape."""
    clean = []
    for r in raw_rules:
        etype = r.get("expectation_type")
        kwargs = r.get("kwargs", {})
        if etype not in SUPPORTED_EXPECTATIONS:
            continue
        if not isinstance(kwargs, dict):
            continue
        if etype != "expect_table_row_count_to_be_between" and "column" not in kwargs:
            continue
        clean.append(
            {
                "expectation_type": etype,
                "kwargs": kwargs,
                "description": r.get("description", ""),
            }
        )
    return clean


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
