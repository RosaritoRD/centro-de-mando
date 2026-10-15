-- tu empresa — APM
-- Migración 004: desde dónde se consulta y dónde se buscan los leads.
--
-- Se aplica con:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/004_ubicacion.sql
--
-- POR QUÉ
-- Hasta ahora el orquestador no sabía dónde está el dueño ni dónde tiene que
-- buscar. Un "búscame DSPs" sin ubicación devuelve lo que el modelo suponga,
-- que casi siempre es California o Londres. Y son DOS sitios distintos, no
-- uno: se consulta desde un lado (huso horario, mercado, leyes que aplican)
-- y se buscan clientes en otro. Meterlos en un solo campo obligaría a
-- elegir cuál se pierde.
--
-- Va en la ejecución y NO solo en un ajuste global: dentro de un mes hay que
-- poder abrir un chat viejo y saber con qué ubicación se lanzó. Un ajuste
-- global se sobreescribe y reescribe el pasado en silencio.

ALTER TABLE run ADD COLUMN IF NOT EXISTS base_city      TEXT;
ALTER TABLE run ADD COLUMN IF NOT EXISTS base_country   TEXT;  -- ISO 3166-1 alfa-2
ALTER TABLE run ADD COLUMN IF NOT EXISTS target_city    TEXT;
ALTER TABLE run ADD COLUMN IF NOT EXISTS target_country TEXT;

-- Sugerencias de ciudades ya usadas en el selector. Índice parcial: las filas
-- viejas sin ubicación son la mayoría y no aportan nada a esa lista.
CREATE INDEX IF NOT EXISTS run_ubicacion_idx ON run (created_at DESC)
  WHERE base_city IS NOT NULL OR target_city IS NOT NULL;

-- ── Ajustes ────────────────────────────────────────────────────────
-- Clave/valor y no columnas: APM es de una persona y los ajustes que van a
-- salir (ubicación hoy, idioma o firma mañana) no merecen una migración cada
-- uno. JSONB para no tener que decidir hoy la forma de cada uno.
--
-- Sin DELETE a propósito, igual que el resto: un ajuste se sobreescribe.
CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La ubicación NO se siembra con la dirección real: se rellena desde el
-- panel. Sembrarla aquí metería un dato personal en un repo de GitHub.

-- ── Permisos ───────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
