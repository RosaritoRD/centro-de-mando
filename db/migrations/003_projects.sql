-- tu empresa — APM
-- Migración 003: registro de proyectos y health checks (Fase 5).
--
-- Se aplica con:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/003_projects.sql
--
-- POR QUÉ
-- el dueño opera varios sitios (tu-dominio.com, fleet, los subdominios de tenant) y
-- hoy se entera de que uno está caído porque lo abre. El vigilante del host
-- (memoria monitoreo) avisa por SMTP de contenedores, pero no de si una
-- URL pública responde. Esto es lo segundo.

-- ── Proyectos ──────────────────────────────────────────────────────
-- `url` es lo que se comprueba; `kind` solo agrupa en la UI.
-- Soft delete con archived_at: en APM se archiva, no se borra (y a apm_app no
-- se le concede DELETE de todas formas).
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

-- ── Resultado de cada comprobación — APPEND ONLY ───────────────────
-- Una fila por sondeo. No se actualiza la última: el historial ES el dato,
-- porque "lleva caído desde las 3" solo se puede contestar con historial.
-- ms es INTEGER: nadie necesita microsegundos para saber si un sitio va lento.
CREATE TABLE IF NOT EXISTS project_check (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id UUID NOT NULL,
  ok         BOOLEAN NOT NULL,
  status     INTEGER,
  ms         INTEGER,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Índice descendente: la consulta caliente es "el último de cada proyecto".
CREATE INDEX IF NOT EXISTS project_check_last_idx
  ON project_check (project_id, created_at DESC);

-- Siembra con lo que ya existe. ON CONFLICT DO NOTHING para que reaplicar la
-- migración no duplique ni pise cambios hechos desde el panel.
INSERT INTO project (name, url, kind, area) VALUES
  ('Web pública',   'https://tu-dominio.com/',            'web',   'marketing'),
  ('Panel tu empresa',  'https://app.tu-dominio.com/',        'panel', 'delivery'),
  ('APM',           'https://apm.tu-dominio.com/api/health','api', 'infra'),
  ('n8n',           'https://n8n.tu-dominio.com/',        'panel', 'infra')
ON CONFLICT DO NOTHING;

-- ── Permisos ───────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
