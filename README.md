# 🔍 AI-Powered Data Quality Assistant

> An MVP that lets non-technical users define and run data quality rules on PostgreSQL tables using AI — no coding required.

---

## 📋 Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [AI Integration](#ai-integration)
- [Setup Instructions](#setup-instructions)
- [How AI Tools Were Leveraged](#how-ai-tools-were-leveraged)
- [Future Enhancements](#future-enhancements)

---

## Overview

Commercial data teams spend hours manually writing data quality checks. This assistant eliminates that by:

- **Analyzing** your PostgreSQL table schema and sample data automatically
- **Suggesting** relevant data quality rules using AI
- **Accepting** plain English rules like *"email should never be empty"* and converting them to executable checks
- **Running** all rules and showing a clear pass/fail dashboard

Built with a Next.js frontend, FastAPI backend, and OpenAI for AI rule generation. Metadata is stored in a dedicated `dq_assistant` schema within the same Supabase database — completely separate from your own tables.

---

## How It Works

```
1. Open app → See all your database tables
         ↓
2. Click a table → View schema + AI-suggested rules
         ↓
3. Review rules → Delete unwanted, add custom rules in plain English
         ↓
4. Click "Save Rules" → Rules are persisted
         ↓
5. Click "Run Checks" → Rules execute against live data
         ↓
6. View Results Dashboard → See pass ✅ / fail ❌ per rule with details
```

For bulk onboarding of many tables at once, the table list also lets you
select multiple tables and hit "Run checks on selected" (or "Run checks on
everything"), instead of repeating steps 2-6 per table.

---

## Architecture

The system is split into a **Next.js frontend** and a **FastAPI backend**, with metadata stored in a dedicated `dq_assistant` schema within the same Supabase database (auto-created on startup).

```
frontend/         Next.js (App Router, TypeScript, Tailwind CSS)
                  └── Table Explorer, Rule Management, Results Dashboard

backend/          FastAPI (Python 3.12)
  app/
  ├── services/
  │   ├── db.py             → Introspects user's Postgres tables (read-only, pooled connections)
  │   ├── ai_rules.py       → LLM prompt engineering: schema/sample → GE rules, NL → GE rules
  │   ├── ge_engine.py      → Executes rules via Great Expectations (pandas execution engine)
  │   ├── rules_store.py    → CRUD + dedupe for AI/user-generated rules
  │   └── results_store.py  → Persists run history (dq_assistant schema)
  ├── routers/              → REST API endpoints, DB/LLM errors wrapped into clean HTTP responses
  ├── logging_config.py     → Structured stdlib logging
  └── main.py               → App entrypoint
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Connection pooling** | `db.py` uses a bounded SQLAlchemy pool (`pool_size=5, max_overflow=5, pool_recycle=1800`) to prevent exhausting Supabase's connection limit under load |
| **Caching** | Table list cached for 30s; latest run result cached for 15s (invalidated immediately on fresh run) — reopening Results tab doesn't always hit Postgres |
| **Sampling transparency** | Rule execution reads up to 5,000 rows for speed. Run summary reports `rows_evaluated`, `total_row_count`, and a `sampled: true/false` flag — results are never silently presented as "the whole table" |
| **LLM resiliency** | OpenAI client configured with timeouts and automatic retries (`llm_timeout_seconds`, `llm_max_retries`) preventing indefinite hangs |
| **Configurable CORS** | Allowed frontend origins read from `FRONTEND_ORIGINS` env var instead of hardcoded values |
| **Structured logging** | All services log through `app.logging_config` — includes LLM call latency, token usage, and dropped AI-suggested rules |
| **Python 3.12** | Great Expectations does not yet support Python 3.14. If your system default is newer, install 3.12 via `brew install python@3.12` |

---

## AI Integration

### Rule Generation — Schema → Rules

The table's schema and up to 20 sample rows are sent to the LLM with a system prompt that:
- Whitelists 9 safe Great Expectations expectation types
- Forces strict JSON output via `response_format: json_object`
- Asks the model to suggest rules based on actual data patterns

### Natural Language → Rule Config

The user's plain English sentence (e.g. *"phone number must be 10 digits"*) is combined with the table schema and sent through the same constrained prompt, returning one or more GE rule configurations.

### Safety Layer

Every AI response is re-validated server-side (`_validate_rules` in `ai_rules.py`) against the whitelist and required shape **before** being stored or executed. The LLM's output is never trusted blindly.

### Why Constrained JSON instead of Freeform Code Generation

Generating raw GE Python or YAML from an LLM introduces a risk of arbitrary code execution and is difficult to validate. A whitelist combined with a strict kwargs schema keeps the AI "creative" about *which* checks make sense, while the execution surface remains small and fully auditable.

### Supported Expectation Types

| Plain English | Expectation Type |
|---------------|-----------------|
| Column should not be empty | `expect_column_values_to_not_be_null` |
| Values should be unique | `expect_column_values_to_be_unique` |
| Value should be in a list | `expect_column_values_to_be_in_set` |
| Value should match a pattern | `expect_column_values_to_match_regex` |
| Value should be between X and Y | `expect_column_values_to_be_between` |
| Table should have rows | `expect_table_row_count_to_be_between` |
| Column should exist | `expect_column_to_exist` |

---

## Setup Instructions

### Prerequisites

- Python 3.12
- Node.js 18+
- Supabase account (free tier works)
- OpenAI API key

### Backend

```bash
cd backend
brew install python@3.12          # Skip if already on 3.12
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # Fill in DATABASE_URL + OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```

> **Note:** Use the **Session Pooler** connection string from Supabase, not the direct connection string.

Visit `http://localhost:8000/docs` for interactive API documentation.

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local  # Set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
npm run dev
```

Visit `http://localhost:3000`

### Environment Variables

**backend/.env**
```dotenv
# Supabase Postgres connection (Session Pooler or Direct connection string)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@[HOST]:5432/postgres

# LLM provider: "openai" or "anthropic"
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=gpt-5.4-mini

FRONTEND_ORIGINS=http://localhost:3000
```

**frontend/.env.local**
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

---

## How AI Tools Were Leveraged

This project was built end-to-end using **GitHub Copilot**:

- **Scaffolding** — FastAPI app structure, SQLAlchemy models, and the GE execution wrapper were generated with Copilot
- **Prompt Engineering** — Iterated on LLM prompts for `ai_rules.py` with Copilot suggestions, testing and refining until JSON output was reliable
- **Frontend** — Full Next.js pages, API client, and components were generated and iterated with Copilot
- **Debugging** — Used Copilot inline suggestions to fix errors and edge cases in real time
- **Verification** — Every major AI-generated change was manually verified (server boot, route listing, import checks) before moving on

Copilot handled boilerplate and scaffolding; engineering judgment was applied to architecture decisions, prompt design, safety validation, and UX flow.

---

## Future Enhancements

- **Real GE persistence** — Store `ExpectationSuite`/Checkpoint for portability outside this app (currently uses an ephemeral context)
- **Streaming progress** — Stream rule-generation progress with confidence scores per AI-suggested rule
- **LLM failure explanations** — Generate plain-English explanations for failures (currently rule-based summaries)
- **Schema drift detection** — Auto re-suggest rules when a table's schema changes
- **Redis caching + job queue** — Background job queue for large-table runs, Redis-backed caching
- **Authentication** — Multi-user workspace support with role-based access
- **Automated tests** — Unit tests for `_validate_rules` and dedupe logic
- **More databases** — MySQL, BigQuery, Snowflake support

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Backend | Python 3.12, FastAPI |
| Database | PostgreSQL via Supabase |
| AI | OpenAI GPT-5.4-mini |
| Data Quality | Great Expectations (pandas engine) |
| Dev Tools | GitHub Copilot |
