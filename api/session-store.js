/* Acme — APM · Agent SDK SessionStore on Postgres.

   WHY IT EXISTS
   The SDK stores each session's transcript in ~/.claude/projects/…, inside the
   container, and a `docker compose up -d --build` wipes it. Since a deferred
   approval is resumed BY session_id against that transcript, without this copy
   every pending approval would die on the next deploy. Measured in
   docs/SPIKE-02-container.md: with this, it survives.

   The SDK still writes to disk (the mirror fires AFTER the local write, and
   `sessionStore` is incompatible with `persistSession: false`). Postgres is
   the copy that survives, not a replacement.

   ⚠️ The SDK derives `projectKey` from the sanitized `cwd` and exposes NO
   option to set it. That's why AGENT_CWD is a deployment constant: changing
   the container's WORKDIR invalidates every pending approval. It fails loudly
   ("No conversation found with session ID"), but it fails. */

import { db } from './db.js';

/* The main transcript arrives as `subpath: undefined`; the empty string is
   invalid in the contract. It's normalized to '' in the table because the
   unique key can't dedupe on NULL (in SQL, NULL != NULL). */
const MAIN = '';

export const sessionStore = {
  async append(key, entries) {
    if (!entries.length) return;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      /* UNNEST … WITH ORDINALITY: a single round-trip preserving the array
         order, which the contract requires within a process.
         ON CONFLICT DO NOTHING implements the `uuid` idempotency the SDK asks
         for: it retries `append()` 3 times and `importSessionToStore()`
         replays entries already written. Without this the transcript gets
         duplicated and the resumed session sees the turn twice. */
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
      /* Rethrown on purpose: the SDK retries and, if it keeps failing, emits a
         `mirror_error`. Swallowing it here would turn data loss into silence,
         which is exactly the failure this project can't afford. */
      throw err;
    } finally {
      client.release();
    }
  },

  async load(key) {
    const { rows } = await db.query(
      `SELECT entry FROM session_entry
        WHERE project_key = $1 AND session_id = $2 AND subpath = $3
        ORDER BY id`,
      [key.projectKey, key.sessionId, key.subpath ?? MAIN]
    );
    /* null = never written. Postgres returns JSONB already parsed and may
       reorder the object's keys; that's fine, the SDK never compares bytes
       (it only requires deep-equal). */
    return rows.length ? rows.map((r) => r.entry) : null;
  },

  /* Without this, resuming only materializes the main transcript and the
     subagents' transcripts are lost. Optional in the contract, mandatory for
     us as soon as there's an orchestrator. */
  async listSubkeys(key) {
    const { rows } = await db.query(
      `SELECT DISTINCT subpath FROM session_entry
        WHERE project_key = $1 AND session_id = $2 AND subpath <> ''`,
      [key.projectKey, key.sessionId]
    );
    return rows.map((r) => r.subpath);
  },

  async listSessions(projectKey) {
    const { rows } = await db.query(
      `SELECT session_id, max(created_at) AS mtime
         FROM session_entry
        WHERE project_key = $1 AND subpath = ''
        GROUP BY session_id`,
      [projectKey]
    );
    /* mtime in whole epoch milliseconds, as the contract requires. Order
       doesn't matter: the SDK sorts it. */
    return rows.map((r) => ({
      sessionId: r.session_id,
      mtime: Math.floor(new Date(r.mtime).getTime())
    }));
  }

  /* `delete()` is left out on purpose. It's optional and its absence is a
     valid no-op for append-only backends — which is exactly this project's
     policy: apm_app isn't granted DELETE; here we archive. */
};
