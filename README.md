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

## Why Python 3.12 for the backend
Great Expectations does not yet support Python 3.14. If your system default
is newer, install 3.12 (`brew install python@3.12`) and create the venv with
that interpreter (already done in this repo's `backend/venv`).

## Setup

### Backend
```bash
cd backend
source venv/bin/activate        # venv already created with python3.12
cp .env.example .env            # fill in DATABASE_URL (Supabase) + OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```
Visit http://localhost:8000/docs for interactive API docs.

### Frontend
```bash
cd frontend
npm install
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
- Plain-English failure explanations (LLM turns a failed expectation's JSON
  into a one-line human explanation).
- Auto re-suggest rules when a table's schema changes (drift detection).
- Redis-backed caching + background job queue for large-table runs instead
  of a synchronous request.
- Auth / multi-user workspace support.
