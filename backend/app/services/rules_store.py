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

    Skips any rule that's an exact duplicate (same expectation_type + kwargs)
    of an already-stored rule for this table, so re-clicking "Suggest rules
    with AI" or re-submitting the same NL text doesn't pile up duplicates.
    """
    suite = get_or_create_suite(table_name)
    with get_session() as session:
        existing = session.query(Rule).filter_by(suite_id=suite.id).all()
        existing_keys = {(e.expectation_type, _kwargs_key(e.kwargs)) for e in existing}

        created = []
        for r in rules:
            key = (r["expectation_type"], _kwargs_key(r.get("kwargs", {})))
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


def _kwargs_key(kwargs: dict) -> str:
    import json

    return json.dumps(kwargs, sort_keys=True, default=str)


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
