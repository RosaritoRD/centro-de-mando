-- Acme — APM
-- Migration 002: Agent SDK transcripts in Postgres (SessionStore).
--
-- Apply with:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/002_session_store.sql
--
-- WHY THIS TABLE EXISTS
-- The SDK stores each session's transcript in ~/.claude/projects/…, inside
-- the container. A `docker compose up -d --build` recreates the container and
-- wipes it out. Since a deferred approval is resumed BY session_id against
-- that transcript (SPIKE-01), without this table every pending approval
-- dies on the next deploy. The SDK still writes to disk (it must: the
-- mirror fires AFTER the local write); this
-- is the copy that survives.

-- ── Transcripts ────────────────────────────────────────────────────
-- One row per JSONL line. `entry` is opaque on purpose: the SDK documents
-- its shape as CLI-internal and asks you to treat it as a blob, only
-- guaranteeing the JSON.stringify/JSON.parse round-trip.
--
-- id BIGSERIAL, not UUID: here the order IS the data. `load()` must return
-- the entries in the same order they were appended, and a random UUID
-- doesn't sort. It never travels in a URL, so migration 001's
-- enumerability argument doesn't apply.
CREATE TABLE IF NOT EXISTS session_entry (
  id          BIGSERIAL PRIMARY KEY,
  project_key TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  -- '' = main transcript. The SDK uses `subpath: undefined` for the main one
  -- and forbids the empty string; it's normalized here so the unique key
  -- works (in SQL, NULL != NULL and dedup would never fire).
  subpath     TEXT NOT NULL DEFAULT '',
  entry_uuid  TEXT,
  entry       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency. The SDK retries `append()` 3 times and `importSessionToStore()`
-- replays entries already written: without this, a retry duplicates the transcript
-- and the resumed session sees the turn twice.
-- Partial because some entries have NO uuid (titles, tags, mode markers) and
-- the contract says to append them without dedup.
CREATE UNIQUE INDEX IF NOT EXISTS session_entry_uuid_idx
  ON session_entry (project_key, session_id, subpath, entry_uuid)
  WHERE entry_uuid IS NOT NULL;

-- The index serving load(): fetches a whole session in order.
CREATE INDEX IF NOT EXISTS session_entry_load_idx
  ON session_entry (project_key, session_id, subpath, id);

-- ── Permissions ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
-- DELETE is still not granted, and here it fits naturally: `SessionStore.delete()`
-- is optional in the SDK and its absence is a valid no-op for append-only
-- backends. The project's policy and the SDK's contract agree.
