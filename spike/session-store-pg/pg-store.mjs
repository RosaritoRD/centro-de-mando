/* SessionStore adapter on Postgres.

   The SDK defines SessionStore as four methods, two required (`append`/`load`)
   and the rest optional. This implements the two required ones plus
   `listSubkeys` (without it, resuming only materializes the main transcript and
   the subagents' are lost).

   `delete` is left out on purpose: it's optional, its absence is a valid no-op
   for append-only backends, and apm_app isn't granted DELETE. */

import pg from 'pg';

/* The main transcript arrives as `subpath: undefined`; the empty string is
   invalid under the contract. In the table it's normalized to '' because the
   unique key can't dedupe on NULL. */
const MAIN = '';

export function createPgSessionStore(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 4 });

  return {
    pool,

    async append(key, entries) {
      if (!entries.length) return;
      const client = await pool.connect();
      try {
        /* One transaction per batch. The contract requires preserving call
           order within a process; inserting in a single UNNEST statement keeps
           the array order and makes it one round-trip. */
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO session_entry (project_key, session_id, subpath, entry_uuid, entry)
           SELECT $1, $2, $3, u.entry_uuid, u.entry
             FROM UNNEST($4::text[], $5::jsonb[]) WITH ORDINALITY
                  AS u(entry_uuid, entry, ord)
            ORDER BY u.ord
           ON CONFLICT DO NOTHING`,
          [
            key.projectKey,
            key.sessionId,
            key.subpath ?? MAIN,
            entries.map((e) => e.uuid ?? null),
            entries.map((e) => JSON.stringify(e))
          ]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        /* Rethrown on purpose. The SDK retries 3 times and, if it keeps
           failing, emits a `mirror_error`. Swallowing the error here would
           turn data loss into silence. */
        throw err;
      } finally {
        client.release();
      }
    },

    async load(key) {
      const { rows } = await pool.query(
        `SELECT entry FROM session_entry
          WHERE project_key = $1 AND session_id = $2 AND subpath = $3
          ORDER BY id`,
        [key.projectKey, key.sessionId, key.subpath ?? MAIN]
      );
      /* null = never written. The contract allows not distinguishing it from
         "empty", and here there's no need: a session with no rows is a session
         that doesn't exist. Postgres returns JSONB already parsed and may
         reorder the object's keys — the SDK doesn't compare bytes, it only
         requires deep-equal. */
      return rows.length ? rows.map((r) => r.entry) : null;
    },

    async listSubkeys(key) {
      const { rows } = await pool.query(
        `SELECT DISTINCT subpath FROM session_entry
          WHERE project_key = $1 AND session_id = $2 AND subpath <> ''`,
        [key.projectKey, key.sessionId]
      );
      return rows.map((r) => r.subpath);
    }
  };
}
