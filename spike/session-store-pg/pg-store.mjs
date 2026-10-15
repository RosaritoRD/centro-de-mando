/* Adaptador SessionStore sobre Postgres.

   El SDK define SessionStore como cuatro métodos, dos obligatorios
   (`append`/`load`) y el resto opcionales. Esto implementa los dos
   obligatorios más `listSubkeys` (sin él, al reanudar solo se materializa el
   transcript principal y se pierden los de los subagentes).

   `delete` se omite a propósito: es opcional, su ausencia es un no-op válido
   para backends append-only, y a apm_app no se le concede DELETE. */

import pg from 'pg';

/* El transcript principal llega como `subpath: undefined`; la cadena vacía es
   inválida según el contrato. En la tabla se normaliza a '' porque la clave
   única no puede deduplicar sobre NULL. */
const MAIN = '';

export function createPgSessionStore(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 4 });

  return {
    pool,

    async append(key, entries) {
      if (!entries.length) return;
      const client = await pool.connect();
      try {
        /* Una transacción por lote. El contrato exige preservar el orden de
           llamada dentro de un proceso; insertar en un solo statement con
           UNNEST mantiene el orden del array y da un único round-trip. */
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
        /* Se relanza a propósito. El SDK reintenta 3 veces y, si sigue
           fallando, emite un `mirror_error`. Tragarse el error aquí
           convertiría una pérdida de datos en silencio. */
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
      /* null = nunca escrita. El contrato permite no distinguirla de "vacía",
         y aquí no hace falta: una sesión sin filas es una sesión que no
         existe. Postgres devuelve JSONB ya parseado y puede reordenar las
         claves del objeto — el SDK no compara bytes, solo exige deep-equal. */
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
