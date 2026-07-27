from app.models.rules import RunResult
from app.services.store import get_session


def save_run_result(table_name: str, run: dict) -> RunResult:
    with get_session() as session:
        record = RunResult(
            table_name=table_name,
            success=run["success"],
            summary=run["summary"],
            results=run["results"],
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def get_latest_result(table_name: str) -> RunResult | None:
    with get_session() as session:
        return (
            session.query(RunResult)
            .filter_by(table_name=table_name)
            .order_by(RunResult.run_at.desc())
            .first()
        )


def get_history(table_name: str, limit: int = 20) -> list[RunResult]:
    with get_session() as session:
        return (
            session.query(RunResult)
            .filter_by(table_name=table_name)
            .order_by(RunResult.run_at.desc())
            .limit(limit)
            .all()
        )
