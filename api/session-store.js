/* tu empresa — APM · SessionStore del Agent SDK sobre Postgres.

   POR QUÉ EXISTE
   El SDK guarda el transcript de cada sesión en ~/.claude/projects/…, dentro
   del contenedor, y un `docker compose up -d --build` se lo lleva. Como una
   aprobación diferida se reanuda POR session_id contra ese transcript, sin
   esta copia toda aprobación pendiente moriría en el siguiente despliegue.
   Medido en docs/SPIKE-02-container.md: con esto, sobrevive.

   El SDK sigue escribiendo en disco (el mirror se dispara DESPUÉS del write
   local, y `sessionStore` es incompatible con `persistSession: false`).
   Postgres es la copia que sobrevive, no un reemplazo.

   ⚠️ El `projectKey` lo deriva el SDK del `cwd` saneado y NO expone opción
   para fijarlo. Por eso AGENT_CWD es una constante del despliegue: cambiar el
   WORKDIR del contenedor invalida todas las aprobaciones pendientes. Falla
   ruidosamente ("No conversation found with session ID"), pero falla. */

import { db } from './db.js';

/* El transcript principal llega como `subpath: undefined`; la cadena vacía es
   inválida en el contrato. Se normaliza a '' en la tabla porque la clave
   única no puede deduplicar sobre NULL (en SQL, NULL != NULL). */
const MAIN = '';

export const sessionStore = {
  async append(key, entries) {
    if (!entries.length) return;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      /* UNNEST … WITH ORDINALITY: un solo round-trip preservando el orden del
         array, que el contrato exige mantener dentro de un proceso.
         ON CONFLICT DO NOTHING implementa la idempotencia por `uuid` que pide
         el SDK: reintenta `append()` 3 veces y `importSessionToStore()`
         reproduce entradas ya escritas. Sin esto el transcript se duplica y
         la sesión reanudada ve el turno dos veces. */
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
      /* Se relanza a propósito: el SDK reintenta y, si sigue fallando, emite
         un `mirror_error`. Tragárselo aquí convertiría una pérdida de datos
         en silencio, que es exactamente el fallo que este proyecto no se
         puede permitir. */
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
    /* null = nunca escrita. Postgres devuelve JSONB ya parseado y puede
       reordenar las claves del objeto; da igual, el SDK nunca compara bytes
       (solo exige deep-equal). */
    return rows.length ? rows.map((r) => r.entry) : null;
  },

  /* Sin esto, al reanudar solo se materializa el transcript principal y se
     pierden los de los subagentes. Opcional en el contrato, obligatorio para
     nosotros en cuanto haya orquestador. */
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
    /* mtime en milisegundos epoch enteros, como pide el contrato. El orden no
       importa: lo ordena el SDK. */
    return rows.map((r) => ({
      sessionId: r.session_id,
      mtime: Math.floor(new Date(r.mtime).getTime())
    }));
  }

  /* `delete()` se omite a propósito. Es opcional y su ausencia es un no-op
     válido para backends append-only — que es justo la política de este
     proyecto: a apm_app no se le concede DELETE, aquí se archiva. */
};
