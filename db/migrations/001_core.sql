-- Acme — APM
-- Migration 001: core of runs, approvals and cost.
--
-- Apply with:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/001_core.sql
--
-- Conventions: TEXT, TIMESTAMPTZ, soft delete, no FKs, GRANTs to apm_app.
-- Ids are UUIDs because they travel in URLs (/api/runs/:id), and with
-- sequential ids you could enumerate the history by counting up.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Runs ───────────────────────────────────────────────────────────
-- session_id is the Agent SDK's: without it nothing can resume (report A §5).
-- budget_usd and max_iterations are NOT decoration: they're the handbrake on the
-- 15x multi-agent multiplier. The code enforces them, not the prompt.
CREATE TABLE IF NOT EXISTS run (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area           TEXT NOT NULL DEFAULT 'general',   -- marketing|ventas|infra|finanzas|general (sales|infra|finance)
  title          TEXT,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','awaiting_approval',
                                   'done','failed','cancelled','interrupted')),
  session_id     TEXT,
  model          TEXT NOT NULL,
  budget_usd     NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  max_iterations INTEGER NOT NULL DEFAULT 40,
  deadline_at    TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: the hot query is "what's still alive?", never the whole history.
CREATE INDEX IF NOT EXISTS run_live_idx ON run (created_at DESC)
  WHERE status IN ('queued','running','awaiting_approval');

-- ── Event log — APPEND ONLY ────────────────────────────────────────
-- This table is the source of truth (factor 12). Never UPDATEd.
-- payload is JSONB because each event type's shape will change; a rigid
-- schema would force a migration every time the SDK adds a field.
CREATE TABLE IF NOT EXISTS run_event (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id     UUID NOT NULL,
  seq        INTEGER NOT NULL,
  kind       TEXT NOT NULL,   -- user|assistant|tool_use|tool_result|thinking|error|system
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS run_event_seq_idx ON run_event (run_id, seq);

-- ── Cost ───────────────────────────────────────────────────────────
-- Names aligned with the OpenTelemetry GenAI semconv: the day we want to
-- export to a collector it's a SELECT, not a migration.
-- ⚠️ cost_usd comes from the SDK's total_cost_usd, NEVER from usage: usage
-- EXCLUDES subagent tokens (correction to report A).
CREATE TABLE IF NOT EXISTS run_cost (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id                      UUID NOT NULL,
  model                       TEXT NOT NULL,
  operation_name              TEXT NOT NULL DEFAULT 'invoke_agent',
  input_tokens                BIGINT NOT NULL DEFAULT 0,
  output_tokens               BIGINT NOT NULL DEFAULT 0,
  cache_read_input_tokens     BIGINT NOT NULL DEFAULT 0,
  cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd                    NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_cost_day_idx ON run_cost (created_at DESC);

-- ── Prices ─────────────────────────────────────────────────────────
-- In a table and NOT in code: the Sonnet 5 promo ends on 31-Aug-2026, and
-- if the price is hard-coded, the dashboard starts lying that day, silently.
CREATE TABLE IF NOT EXISTS model_pricing (
  model            TEXT PRIMARY KEY,
  input_per_mtok   NUMERIC(10,4) NOT NULL,
  output_per_mtok  NUMERIC(10,4) NOT NULL,
  cache_read_mult  NUMERIC(6,4) NOT NULL DEFAULT 0.1,
  cache_write_mult NUMERIC(6,4) NOT NULL DEFAULT 1.25,
  note             TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO model_pricing (model, input_per_mtok, output_per_mtok, note) VALUES
  ('claude-opus-5',    5.00, 25.00, 'orchestrator'),
  ('claude-sonnet-5',  2.00, 10.00, 'PROMO until 2026-08-31; then 3.00/15.00'),
  ('claude-haiku-4-5', 1.00,  5.00, 'classification and triage')
ON CONFLICT (model) DO NOTHING;

-- ── Approvals ──────────────────────────────────────────────────────
-- request_id is the SDK's canUseTool/defer id: it's the key to resume.
-- No TTL in the DB on purpose: the SDK doesn't expire permission promises
-- (report A §13), so expiring here would leave the agent hanging. What we
-- do is CANCEL the run, not silently expire the approval.
CREATE TABLE IF NOT EXISTS approval (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id      UUID NOT NULL,
  request_id  TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  tool_input  JSONB NOT NULL,
  summary     TEXT,                       -- what's about to happen, in plain words, for the phone
  decision    TEXT CHECK (decision IN ('allow','deny')),
  deny_reason TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_pending_idx ON approval (created_at)
  WHERE decision IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approval_request_idx ON approval (run_id, request_id);

-- ── Daily budget ───────────────────────────────────────────────────
-- One row per day. When spent_usd >= limit_usd, the orchestrator refuses
-- to launch subagents. With the 15x multiplier this isn't a metric: it's
-- the handbrake.
CREATE TABLE IF NOT EXISTS budget_day (
  day        DATE PRIMARY KEY,
  limit_usd  NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  spent_usd  NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Permissions ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
-- ── Permissions ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
-- DELETE is deliberately NOT granted: in APM we archive, we don't delete.
