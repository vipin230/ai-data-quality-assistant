from app.models.rules import Rule, RuleSuite
from app.services.store import get_session


def get_or_create_suite(table_name: str) -> RuleSuite:
    with get_session() as session:
        suite = session.query(RuleSuite).filter_by(table_name=table_name).one_or_none()
        if suite is None:
            suite = RuleSuite(table_name=table_name)
            session.add(suite)
            session.commit()
            session.refresh(suite)
        return suite


def list_rules(table_name: str) -> list[Rule]:
    with get_session() as session:
        suite = session.query(RuleSuite).filter_by(table_name=table_name).one_or_none()
        if suite is None:
            return []
        return session.query(Rule).filter_by(suite_id=suite.id).order_by(Rule.id).all()


def add_rules(table_name: str, rules: list[dict], source: str, nl_prompt: str | None = None) -> list[Rule]:
    """rules: list of {"expectation_type": str, "kwargs": dict, "description": str}

    Skips any rule that duplicates the same check (expectation_type + column)
    already stored for this table, so re-clicking "Suggest rules with AI" or
    re-submitting NL text doesn't pile up near-duplicates that only differ in
    wording (e.g. two slightly different email regexes are still the same
    "email must match a pattern" check).
    """
    suite = get_or_create_suite(table_name)
    with get_session() as session:
        existing = session.query(Rule).filter_by(suite_id=suite.id).all()
        existing_keys = {(e.expectation_type, _dedupe_key(e.kwargs)) for e in existing}

        created = []
        for r in rules:
            key = (r["expectation_type"], _dedupe_key(r.get("kwargs", {})))
            if key in existing_keys:
                continue
            rule = Rule(
                suite_id=suite.id,
                expectation_type=r["expectation_type"],
                kwargs=r.get("kwargs", {}),
                description=r.get("description"),
                source=source,
                nl_prompt=nl_prompt,
            )
            session.add(rule)
            created.append(rule)
            existing_keys.add(key)
        session.commit()
        for r in created:
            session.refresh(r)
        return created


def dedupe_against_existing(table_name: str, rules: list[dict]) -> list[dict]:
    """Like `add_rules` but read-only: annotates each suggested rule with
    `already_exists` instead of inserting anything, so callers can preview
    AI suggestions before the user decides which ones to accept."""
    suite = get_or_create_suite(table_name)
    with get_session() as session:
        existing = session.query(Rule).filter_by(suite_id=suite.id).all()
        existing_keys = {(e.expectation_type, _dedupe_key(e.kwargs)) for e in existing}

    annotated = []
    for r in rules:
        key = (r["expectation_type"], _dedupe_key(r.get("kwargs", {})))
        annotated.append({**r, "already_exists": key in existing_keys})
    return annotated


def _dedupe_key(kwargs: dict) -> str:
    """Same expectation_type + same column = same check, regardless of minor
    kwargs differences (e.g. two regexes that both mean "looks like an
    email"). expect_table_row_count_to_be_between has no column, so fall
    back to the full kwargs for that one case."""
    column = kwargs.get("column")
    if column is not None:
        return str(column)
    return _kwargs_key(kwargs)


def _kwargs_key(kwargs: dict) -> str:
    import json

    return json.dumps(kwargs, sort_keys=True, default=str)


def get_rule_with_table(rule_id: int):
    """Fetch a rule plus its table name in one query (avoids a lazy-load on
    the closed session when the caller only needs table_name for validation)."""
    with get_session() as session:
        row = (
            session.query(Rule, RuleSuite.table_name)
            .join(RuleSuite, Rule.suite_id == RuleSuite.id)
            .filter(Rule.id == rule_id)
            .one_or_none()
        )
        return row


def update_rule(rule_id: int, **fields) -> Rule | None:
    with get_session() as session:
        rule = session.get(Rule, rule_id)
        if rule is None:
            return None
        for k, v in fields.items():
            if v is not None and hasattr(rule, k):
                setattr(rule, k, v)
        session.commit()
        session.refresh(rule)
        return rule


def delete_rule(rule_id: int) -> bool:
    with get_session() as session:
        rule = session.get(Rule, rule_id)
        if rule is None:
            return False
        session.delete(rule)
        session.commit()
        return True
