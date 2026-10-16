-- Acme — APM
-- Migration 005: call prospecting (Phase 3).
--
-- Apply with:
--   docker exec -i n8n_postgres psql -U n8n -d apm --single-transaction < db/migrations/005_prospeccion.sql
--
-- WHY
-- Since 17/09/2026 there's a free, legal source of 13,385 NYC contractors
-- with phone numbers, and 0 calls had been made: there was nowhere to see who to call,
-- what to say and what happened. Spec: .planning/specs/apm-prospeccion-llamadas.md
--
-- tenant_id is NOT multi-tenant yet: it's the slot for selling it to customers later
-- without migrating data. Today everything is 'main'.

-- ── Leads ──────────────────────────────────────────────────────────
-- One business = one phone per tenant. If it arrives from two sources it's merged
-- and both are stored in `sources`. internal_only marks what came from a scraper: the
-- customer version excludes it by construction, never by discipline.
CREATE TABLE IF NOT EXISTS lead (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      TEXT NOT NULL DEFAULT 'main',
  business_name  TEXT NOT NULL,
  phone_e164     TEXT NOT NULL,
  website        TEXT,
  address        TEXT,
  zip            TEXT,
  borough_city   TEXT,
  state          TEXT,
  niche          TEXT NOT NULL,
  sources        TEXT[] NOT NULL DEFAULT '{}',
  source_ids     JSONB NOT NULL DEFAULT '{}',
  internal_only  BOOLEAN NOT NULL DEFAULT false,
  status         TEXT NOT NULL DEFAULT 'nuevo'
                 CHECK (status IN ('nuevo','llamado','interesado','demo','cliente','descartado')),
  next_call_at   TIMESTAMPTZ,
  reserved_until TIMESTAMPTZ,              -- avoids calling twice from two tabs
  timezone       TEXT NOT NULL DEFAULT 'America/New_York',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_phone_idx ON lead (tenant_id, phone_e164) WHERE deleted_at IS NULL;
-- The hot query: "who do I call now in this niche?"
CREATE INDEX IF NOT EXISTS lead_queue_idx ON lead (tenant_id, niche, next_call_at)
  WHERE deleted_at IS NULL AND status NOT IN ('cliente','descartado');

-- ── Calls — APPEND ONLY ────────────────────────────────────────────
-- Never UPDATE: an outcome marked by mistake is corrected with another row
-- pointing at the wrong one (corrects_id). The full history IS the data.
CREATE TABLE IF NOT EXISTS call_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    TEXT NOT NULL DEFAULT 'main',
  lead_id      UUID NOT NULL,
  outcome      TEXT NOT NULL
               CHECK (outcome IN ('no_contesto','buzon','no_interesa','interesado',
                                  'llamar_luego','no_llamar','numero_malo','demo')),
  notes        TEXT,
  call_again   BOOLEAN NOT NULL DEFAULT false,
  next_call_at TIMESTAMPTZ,
  corrects_id  UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_log_lead_idx ON call_log (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_log_week_idx ON call_log (tenant_id, created_at);

-- ── Suppression ("don't call me again") ────────────────────────────
-- By phone, not by lead: it survives the business being re-imported.
CREATE TABLE IF NOT EXISTS suppression (
  tenant_id  TEXT NOT NULL DEFAULT 'main',
  phone_e164 TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('no_llamar','numero_malo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone_e164)
);

-- ── Import runs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_source_run (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   TEXT NOT NULL DEFAULT 'main',
  source      TEXT NOT NULL,
  niche       TEXT NOT NULL,
  params      JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  found       INTEGER NOT NULL DEFAULT 0,
  inserted    INTEGER NOT NULL DEFAULT 0,
  merged      INTEGER NOT NULL DEFAULT 0,
  suppressed  INTEGER NOT NULL DEFAULT 0,
  invalid     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS lead_source_run_day_idx ON lead_source_run (tenant_id, source, started_at DESC);

-- ── Scripts per niche ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_script (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  TEXT NOT NULL DEFAULT 'main',
  niche      TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS call_script_niche_idx ON call_script (tenant_id, niche) WHERE deleted_at IS NULL;

-- ── Permissions ────────────────────────────────────────────────────
-- Same as the rest: no DELETE. Archive or correct, never delete.
GRANT SELECT, INSERT, UPDATE ON lead, suppression, lead_source_run, call_script TO apm_app;
-- call_log is append-only at the permission level too: not even UPDATE.
GRANT SELECT, INSERT ON call_log TO apm_app;
-- Deliberate exceptions to "id + timestamps + deleted_at on every table":
-- call_log (append-only, corrected via corrects_id) and suppression (permanent,
-- key = phone). Neither is ever deleted or archived.
