"""SQLAlchemy models for storing generated rules and run results.

These tables live in the SAME Supabase Postgres database as the user's data
tables, under a dedicated schema (`dq_assistant`) so they never collide with
the user's own tables.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RuleSuite(Base):
    """One suite per table (mirrors a Great Expectations ExpectationSuite)."""

    __tablename__ = "rule_suites"
    __table_args__ = {"schema": "dq_assistant"}

    id = Column(Integer, primary_key=True)
    table_name = Column(String, nullable=False, index=True, unique=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    rules = relationship("Rule", back_populates="suite", cascade="all, delete-orphan")


class Rule(Base):
    """A single Great Expectations expectation, possibly AI-generated."""

    __tablename__ = "rules"
    __table_args__ = {"schema": "dq_assistant"}

    id = Column(Integer, primary_key=True)
    suite_id = Column(Integer, ForeignKey("dq_assistant.rule_suites.id"), nullable=False)
    expectation_type = Column(String, nullable=False)
    kwargs = Column(JSON, nullable=False, default=dict)
    description = Column(Text, nullable=True)
    source = Column(String, nullable=False, default="ai_auto")  # ai_auto | ai_nl | manual
    nl_prompt = Column(Text, nullable=True)  # original natural-language text, if any
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    suite = relationship("RuleSuite", back_populates="rules")


class RunResult(Base):
    """Cached result of executing a suite against a table."""

    __tablename__ = "run_results"
    __table_args__ = {"schema": "dq_assistant"}

    id = Column(Integer, primary_key=True)
    table_name = Column(String, nullable=False, index=True)
    success = Column(Boolean, nullable=False)
    summary = Column(JSON, nullable=False)  # {"success_count":.., "failed_count":.., ...}
    results = Column(JSON, nullable=False)  # full per-expectation result list
    run_at = Column(DateTime(timezone=True), default=utcnow, index=True)
