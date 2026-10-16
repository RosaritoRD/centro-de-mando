/* Acme — APM · Postgres access.

   The `apm` DB lives in the n8n_postgres container, the same one that already
   serves your website and n8n. No new Postgres is started on purpose: it saves
   ~150-250 MB of RAM on a VPS that already touches swap, and it inherits the
   encrypted R2 backups that are already in cron and verified.

   The tables are created by the owner role (n8n) and this app connects as
   apm_app, which has SELECT/INSERT/UPDATE and NO DELETE, and can't ALTER.
   That's deliberate: in APM we archive, we don't delete, and a migration can't
   be applied by accident from the code. */

import pg from 'pg';

const { Pool } = pg;

/* max 5, not the default 10: at most two concurrent runs
   (MAX_CONCURRENT_RUNS) don't need more, and every idle connection is memory
   in a Postgres that also serves your website and n8n. */
export const db = new Pool({
  connectionString: process.env.APM_DB_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

db.on('error', (e) => console.error('pg pool:', e.message));

/* For /api/health. Returns the failure reason instead of throwing: a DB that's
   down has to show up in the health response, not take down the process. */
export async function dbOk() {
  try {
    await db.query('SELECT 1');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
