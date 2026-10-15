-- tu empresa — APM
-- Migración 002: transcripts del Agent SDK en Postgres (SessionStore).
--
-- Se aplica con:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/002_session_store.sql
--
-- POR QUÉ EXISTE ESTA TABLA
-- El SDK guarda el transcript de cada sesión en ~/.claude/projects/…, dentro
-- del contenedor. Un `docker compose up -d --build` recrea el contenedor y se
-- lo lleva por delante. Como una aprobación diferida se reanuda POR
-- session_id contra ese transcript (SPIKE-01), sin esta tabla toda aprobación
-- pendiente muere en el siguiente despliegue. El SDK sigue escribiendo en
-- disco (es obligatorio: el mirror se dispara DESPUÉS del write local); esto
-- es la copia que sobrevive.

-- ── Transcripts ────────────────────────────────────────────────────
-- Una fila por línea del JSONL. `entry` es opaco a propósito: el SDK
-- documenta su forma como interna de la CLI y pide tratarla como blob,
-- garantizando solo el round-trip JSON.stringify/JSON.parse.
--
-- id BIGSERIAL y no UUID: aquí el orden ES el dato. `load()` tiene que
-- devolver las entradas en el mismo orden en que se añadieron, y un UUID
-- aleatorio no ordena. No viaja en ninguna URL, así que el argumento de
-- enumerabilidad de la migración 001 no aplica.
CREATE TABLE IF NOT EXISTS session_entry (
  id          BIGSERIAL PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  -- '' = transcript principal. El SDK usa `subpath: undefined` para el
  -- principal y prohíbe la cadena vacía; se normaliza aquí para que la clave
  -- única funcione (en SQL, NULL != NULL y la deduplicación no dispararía).
  subpath     TEXT NOT NULL DEFAULT '',
  entry_uuid  TEXT,
  entry       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotencia. El SDK reintenta `append()` 3 veces y `importSessionToStore()`
-- reproduce entradas ya escritas: sin esto, un reintento duplica el transcript
-- y la sesión reanudada ve el turno dos veces.
-- Parcial porque hay entradas SIN uuid (títulos, tags, marcadores de modo) que
-- el contrato manda añadir sin deduplicar.
CREATE UNIQUE INDEX IF NOT EXISTS session_entry_uuid_idx
  ON session_entry (project_key, session_id, subpath, entry_uuid)
  WHERE entry_uuid IS NOT NULL;

-- El índice que sirve a load(): recupera una sesión entera en orden.
CREATE INDEX IF NOT EXISTS session_entry_load_idx
  ON session_entry (project_key, session_id, subpath, id);

-- ── Permisos ───────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
-- Sigue sin concederse DELETE, y aquí encaja solo: `SessionStore.delete()` es
-- opcional en el SDK y su ausencia es un no-op válido para backends
-- append-only. La política del proyecto y el contrato del SDK coinciden.
