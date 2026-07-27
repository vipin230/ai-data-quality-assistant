# AI-Powered Data Quality Assistant

An MVP that lets non-technical users define and run data quality rules on
PostgreSQL tables using [Great Expectations](https://greatexpectations.io/),
without writing any GE code — rules are AI-suggested from schema/sample data
or written in plain English.

## Architecture

```
frontend/   Next.js (App Router, TS, Tailwind) — Table Explorer, Rule Management, Results Dashboard
backend/    FastAPI (Python 3.12)
  app/services/db.py        -> introspects the user's Postgres tables (read-only)
  app/services/ai_rules.py  -> LLM prompt engineering: schema/sample -> GE rules, NL -> GE rules
  app/services/ge_engine.py -> executes rules via Great Expectations (pandas execution engine)
  app/services/store.py     -> metadata tables (dq_assistant schema) for rules + run history
  app/routers/*              -> REST API
```

Metadata (generated rules, run history) is stored in a dedicated `dq_assistant`
Postgres schema in the *same* Supabase database, auto-created on startup —
kept separate from the user's own tables.

## Architecture

```
frontend/   Next.js (App Router, TS, Tailwind) — Table Explorer, Rule 
Management, Results Dashboard
backend/    FastAPI (Python 3.12)
  app/services/db.py        -> introspects the user's Postgres tables (read-only, pooled connections, 30s TTL table-list cache)
  app/services/ai_rules.py  -> LLM prompt engineering: schema/sample -> GE rules, NL -> GE rules
  app/services/ge_engine.py -> executes rules via Great Expectations (pandas execution engine)
  app/services/rules_store.py -> CRUD + dedupe for AI/user-generated rules
  app/services/results_store.py -> persists run history (dq_assistant schema)
  app/logging_config.py     -> structured stdlib logging (replaces print statements)
  app/routers/*              -> REST API, with DB/LLM errors wrapped into clean HTTP responses
```

Metadata (generated rules, run history) is stored in a dedicated `dq_assistant`
Postgres schema in the *same* Supabase database, auto-created on startup —
kept separate from the user's own tables.

### Scalability & reliability notes
- **Connection pooling**: `db.py` uses a bounded SQLAlchemy pool
  (`pool_size=5, max_overflow=5, pool_recycle=1800`) so the app can't exhaust
  Supabase's pooler connection limit under load.
- **Caching**: table list is cached for 30s; the latest run result per table
  is cached for 15s (invalidated immediately on a fresh run) so reopening the
  Results tab doesn't always hit Postgres.
- **Sampling transparency**: rule execution reads up to 5,000 rows per run for
  speed/memory reasons. The run summary reports `rows_evaluated` alongside the
  real `total_row_count` and a `sampled: true/false` flag, so results are never
  silently presented as "the whole table" when they aren't. The frontend
  surfaces this as a visible warning banner.
- **LLM resiliency**: the OpenAI client is configured with a timeout and
  automatic retries (`llm_timeout_seconds`, `llm_max_retries` in config) so a
  slow or flaky network doesn't hang a request indefinitely or fail on the
  first blip.
- **Configurable CORS**: allowed frontend origins are read from
  `FRONTEND_ORIGINS` (comma-separated) instead of being hardcoded, so the same
  backend can serve a deployed frontend without a code change.
- **Structured logging**: all services log through `app.logging_config`
  instead of `print()` — includes LLM call latency/token usage, dropped
  AI-suggested rules (with reason), and run summaries, useful for debugging
  prompt quality and performance over time.

## Why Python 3.12 for the backend
Great Expectations does not yet support Python 3.14. If your system default
is newer, install 3.12 (`brew install python@3.12`) and create the venv with
that interpreter (already done in this repo's `backend/venv`).

## Setup

> This repo does not commit the Python virtual environment or `node_modules` —
> follow the steps below on a fresh clone to set both up from scratch.

### Backend
```bash
cd backend
brew install python@3.12          # Great Expectations doesn't support 3.14 yet
python3.12 -m venv venv           # create the virtual environment (not committed)
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # fill in DATABASE_URL (Supabase) + OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```
Visit http://localhost:8000/docs for interactive API docs.

Notes:
- Use the **Session Pooler** connection string from Supabase (Project Settings →
  Database → Connection Pooling), not the direct connection string — the
  direct hostname is IPv6-only and fails to resolve on many networks.
- If you ever move/rename this project folder, delete and recreate `venv`
  (`rm -rf venv && python3.12 -m venv venv && pip install -r requirements.txt`) —
  the venv hardcodes an absolute path at creation time and breaks on rename.

### Frontend
```bash
cd frontend
npm install                        # installs node_modules (not committed)
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```
Visit http://localhost:3000.

## AI integration approach
- **Rule generation**: schema + up to 20 sample rows are sent to the LLM with
  a system prompt that whitelists 9 safe Great Expectations expectation types
  and forces strict JSON output (`response_format: json_object`).
- **Natural language rules**: user's plain-English sentence + table schema is
  sent with the same constrained prompt, returning one or more GE rules.
- **Safety layer**: every AI response is re-validated server-side
  (`_validate_rules` in `ai_rules.py`) against the whitelist and required
  shape before being stored or ever executed — the LLM's output is never
  trusted blindly.
- **Why constrained JSON instead of freeform code-gen**: generating raw GE
  Python/YAML from an LLM is riskier (arbitrary code execution surface) and
  harder to validate. A whitelist + strict kwargs schema keeps the AI
  "creative" about *which* checks make sense, while the execution surface
  stays small and auditable.

## AI coding tools used during development
This project was built end-to-end with GitHub Copilot CLI: scaffolding the
FastAPI app structure, SQLAlchemy models, the GE execution wrapper, prompt
design/iteration for `ai_rules.py`, and the full Next.js frontend (pages,
API client, components) were all generated and iterated on with Copilot in
an interactive terminal session, with manual verification (server boot,
route listing, import checks) after each major change.

## Future enhancements
- Real GE `ExpectationSuite`/Checkpoint persistence (currently ephemeral
  context) for portability outside this app.
- Streaming rule-generation progress + confidence scores per AI-suggested rule.
- LLM-generated plain-English failure explanations (currently rule-based
  one-line summaries per expectation type).
- Auto re-suggest rules when a table's schema changes (drift detection).
- Redis-backed caching + background job queue for large-table runs instead
  of a synchronous request, and push row-count-based checks down to SQL so
  full tables can be validated without a pandas sample.
- Auth / multi-user workspace support.
- Automated test suite (unit tests for `_validate_rules`/dedupe logic,
  integration tests for the run pipeline) — not included in this 3-day MVP.
