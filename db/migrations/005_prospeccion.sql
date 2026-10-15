-- tu empresa — APM
-- Migración 005: prospección por llamadas (Fase 3).
--
-- Se aplica con:
--   docker exec -i n8n_postgres psql -U n8n -d apm --single-transaction < db/migrations/005_prospeccion.sql
--
-- POR QUÉ
-- Desde el 17/09/2026 hay una fuente gratis y legal de 13.385 contratistas de NYC
-- con teléfono y se habían hecho 0 llamadas: no había dónde ver a quién llamar,
-- qué decir y qué pasó. Spec: .planning/specs/apm-prospeccion-llamadas.md
--
-- tenant_id NO es multi-tenant todavía: es el hueco para venderlo luego a clientes
-- sin migrar datos. Hoy todo es 'principal'.

-- ── Leads ──────────────────────────────────────────────────────────
-- Un negocio = un teléfono por tenant. Si llega de dos fuentes se une y se
-- guardan ambas en `sources`. internal_only marca lo que vino de un scraper: la
-- versión para clientes lo excluye por construcción, nunca por disciplina.
CREATE TABLE IF NOT EXISTS lead (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      TEXT NOT NULL DEFAULT 'principal',
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
  reserved_until TIMESTAMPTZ,              -- evita llamar dos veces desde dos pestañas
  timezone       TEXT NOT NULL DEFAULT 'America/New_York',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_phone_idx ON lead (tenant_id, phone_e164) WHERE deleted_at IS NULL;
-- La consulta caliente: "¿a quién llamo ahora en este nicho?"
CREATE INDEX IF NOT EXISTS lead_queue_idx ON lead (tenant_id, niche, next_call_at)
  WHERE deleted_at IS NULL AND status NOT IN ('cliente','descartado');

-- ── Llamadas — APPEND ONLY ─────────────────────────────────────────
-- Nunca UPDATE: un resultado marcado por error se corrige con otra fila que
-- apunta a la mala (corrects_id). El historial completo ES el dato.
CREATE TABLE IF NOT EXISTS call_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    TEXT NOT NULL DEFAULT 'principal',
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

-- ── Supresión ("no me llames más") ─────────────────────────────────
-- Por teléfono y no por lead: sobrevive a que el negocio se reimporte.
CREATE TABLE IF NOT EXISTS suppression (
  tenant_id  TEXT NOT NULL DEFAULT 'principal',
  phone_e164 TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('no_llamar','numero_malo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone_e164)
);

-- ── Ejecuciones de importación ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_source_run (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   TEXT NOT NULL DEFAULT 'principal',
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

-- ── Guiones por nicho ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_script (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  TEXT NOT NULL DEFAULT 'principal',
  niche      TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS call_script_niche_idx ON call_script (tenant_id, niche) WHERE deleted_at IS NULL;

-- ── Permisos ───────────────────────────────────────────────────────
-- Igual que el resto: sin DELETE. Se archiva o se corrige, no se borra.
GRANT SELECT, INSERT, UPDATE ON lead, suppression, lead_source_run, call_script TO apm_app;
-- call_log es append-only también a nivel de permisos: ni UPDATE.
GRANT SELECT, INSERT ON call_log TO apm_app;
-- Excepciones deliberadas a "id + timestamps + deleted_at en cada tabla":
-- call_log (append-only, se corrige con corrects_id) y suppression (permanente,
-- clave = teléfono). Ninguna se borra ni se archiva nunca.
