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
    """rules: list of {"expectation_type": str, "kwargs": dict, "description": str}"""
    suite = get_or_create_suite(table_name)
    created = []
    with get_session() as session:
        for r in rules:
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
        session.commit()
        for r in created:
            session.refresh(r)
        return created


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
