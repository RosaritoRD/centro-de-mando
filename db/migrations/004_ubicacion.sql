-- Acme — APM
-- Migration 004: where queries come from and where leads are searched.
--
-- Apply with:
--   docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/004_ubicacion.sql
--
-- WHY
-- Until now the orchestrator didn't know where the owner is or where it should
-- search. A "find me DSPs" without a location returns whatever the model assumes,
-- which is almost always California or London. And they're TWO different places,
-- not one: you ask from one place (time zone, market, applicable laws)
-- and look for clients in another. A single field would force you to
-- choose which one to lose.
--
-- It's stored on the run and NOT only in a global setting: a month from now you
-- must be able to open an old chat and know which location it ran with. A
-- global setting gets overwritten and silently rewrites the past.

ALTER TABLE run ADD COLUMN IF NOT EXISTS base_city      TEXT;
ALTER TABLE run ADD COLUMN IF NOT EXISTS base_country   TEXT;  -- ISO 3166-1 alpha-2
ALTER TABLE run ADD COLUMN IF NOT EXISTS target_city    TEXT;
ALTER TABLE run ADD COLUMN IF NOT EXISTS target_country TEXT;

-- Suggestions of already-used cities for the picker. Partial index: old rows
-- without a location are the majority and add nothing to that list.
CREATE INDEX IF NOT EXISTS run_ubicacion_idx ON run (created_at DESC)
  WHERE base_city IS NOT NULL OR target_city IS NOT NULL;

-- ── Settings ───────────────────────────────────────────────────────
-- Key/value, not columns: APM belongs to one person, and the settings to come
-- (location today, language or signature tomorrow) don't deserve a migration
-- each. JSONB so each one's shape doesn't have to be decided today.
--
-- No DELETE on purpose, like everything else: a setting gets overwritten.
CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The location is NOT seeded with the real address: it's filled in from the
-- dashboard. Seeding it here would put personal data into a GitHub repo.

-- ── Permissions ────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO apm_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO apm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apm_app;
