-- Acme — APM
-- Migration 003: project registry and health checks (Phase 5).
--
-- Apply with:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/003_projects.sql
--
-- WHY
-- the owner runs several sites (your-domain.com, fleet, the tenant subdomains) and
-- today finds out one is down by opening it. The host watchdog alerts
-- over SMTP about containers, but not about whether a public URL
-- responds. This is the latter.

-- ── Projects ───────────────────────────────────────────────────────
-- `url` is what gets checked; `kind` only groups in the UI.
-- Soft delete with archived_at: in APM we archive, we don't delete (and apm_app
-- isn't granted DELETE anyway).
CREATE TABLE IF NOT EXISTS project (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'web',   -- web|api|panel
  area        TEXT NOT NULL DEFAULT 'infra',
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_url_idx ON project (url) WHERE archived_at IS NULL;

-- ── Result of each check — APPEND ONLY ─────────────────────────────
-- One row per probe. The latest isn't updated: the history IS the data,
-- because "it's been down since 3" can only be answered with history.
-- ms is INTEGER: nobody needs microseconds to know a site is slow.
CREATE TABLE IF NOT EXISTS project_check (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id UUID NOT NULL,
  ok         BOOLEAN NOT NULL,
  status     INTEGER,
  ms         INTEGER,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Descending index: the hot query is "the latest one per project".
CREATE INDEX IF NOT EXISTS project_check_last_idx
  ON project_check (project_id, created_at DESC);

-- Seeded with what already exists. ON CONFLICT DO NOTHING so re-applying the
-- migration neither duplicates nor overwrites changes made from the dashboard.
INSERT INTO project (name, url, kind, area) VALUES
  ('Public website','https://your-domain.com/',            'web',   'marketing'),
  ('Panel Acme',  'https://app.your-domain.com/',        'panel', 'delivery'),
  ('APM',           'https://apm.your-domain.com/api/health','api', 'infra'),
  ('n8n',           'https://n8n.your-domain.com/',        'panel', 'infra')
ON CONFLICT DO NOTHING;

-- ── Permissions ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
