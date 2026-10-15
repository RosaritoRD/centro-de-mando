-- tu empresa — APM
-- Migración 001: núcleo de ejecuciones, aprobaciones y coste.
--
-- Se aplica con:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/001_core.sql
--
-- Convenciones: TEXT, TIMESTAMPTZ, soft delete, sin FK, GRANTs a apm_app.
-- Los ids son UUID porque viajan en URLs (/api/runs/:id) y con ids
-- secuenciales se enumera el historial contando hacia arriba.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Ejecuciones ────────────────────────────────────────────────────
-- session_id es el del Agent SDK: sin él no se puede reanudar (informe A §5).
-- budget_usd y max_iterations NO son adorno: son el freno de mano del
-- multiplicador 15x del multi-agente. Los aplica el código, no el prompt.
CREATE TABLE IF NOT EXISTS run (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area           TEXT NOT NULL DEFAULT 'general',   -- marketing|ventas|infra|finanzas|general
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

-- Índice parcial: la consulta caliente es "¿qué sigue vivo?", nunca el historial entero.
CREATE INDEX IF NOT EXISTS run_live_idx ON run (created_at DESC)
  WHERE status IN ('queued','running','awaiting_approval');

-- ── Log de eventos — APPEND ONLY ───────────────────────────────────
-- Esta tabla es el estado de verdad (factor 12). Nunca se hace UPDATE.
-- payload es JSONB porque la forma de cada tipo de evento cambiará; el
-- esquema rígido nos obligaría a migrar cada vez que el SDK añada un campo.
CREATE TABLE IF NOT EXISTS run_event (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id     UUID NOT NULL,
  seq        INTEGER NOT NULL,
  kind       TEXT NOT NULL,   -- user|assistant|tool_use|tool_result|thinking|error|system
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS run_event_seq_idx ON run_event (run_id, seq);

-- ── Coste ──────────────────────────────────────────────────────────
-- Nombres alineados con la semconv GenAI de OpenTelemetry: el día que
-- queramos exportar a un colector es un SELECT, no una migración.
-- ⚠️ cost_usd viene de total_cost_usd del SDK, NUNCA de usage: usage
-- EXCLUYE los tokens de los subagentes (corrección del informe A).
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

-- ── Precios ────────────────────────────────────────────────────────
-- En tabla y NO en el código: la promo de Sonnet 5 vence el 31-ago-2026 y
-- si el precio está hardcodeado, el panel empieza a mentir ese día en silencio.
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
  ('claude-opus-5',    5.00, 25.00, 'orquestador'),
  ('claude-sonnet-5',  2.00, 10.00, 'PROMO hasta 2026-08-31; luego 3.00/15.00'),
  ('claude-haiku-4-5', 1.00,  5.00, 'clasificacion y triaje')
ON CONFLICT (model) DO NOTHING;

-- ── Aprobaciones ───────────────────────────────────────────────────
-- request_id es el del canUseTool/defer del SDK: es la llave para reanudar.
-- Sin TTL en la BD a propósito: el SDK no expira las promesas de permiso
-- (informe A §13), así que expirar aquí dejaría al agente colgado. Lo que
-- se hace es CANCELAR la ejecución, no caducar la aprobación en silencio.
CREATE TABLE IF NOT EXISTS approval (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id      UUID NOT NULL,
  request_id  TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  tool_input  JSONB NOT NULL,
  summary     TEXT,                       -- qué va a pasar, en cristiano, para el móvil
  decision    TEXT CHECK (decision IN ('allow','deny')),
  deny_reason TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_pending_idx ON approval (created_at)
  WHERE decision IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approval_request_idx ON approval (run_id, request_id);

-- ── Presupuesto diario ─────────────────────────────────────────────
-- Una fila por día. Cuando spent_usd >= limit_usd, el orquestador se niega
-- a lanzar subagentes. Con el multiplicador 15x esto no es una metrica: es
-- el freno de mano.
CREATE TABLE IF NOT EXISTS budget_day (
  day        DATE PRIMARY KEY,
  limit_usd  NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  spent_usd  NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Permisos ───────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
-- ── Permisos ───────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
-- DELETE deliberadamente NO se concede: en APM se archiva, no se borra.
