/* tu empresa — APM · acceso a Postgres.

   La BD `apm` vive en el contenedor n8n_postgres, el mismo que ya sirve a
   tu web y a n8n. No se levanta un Postgres nuevo a propósito: ahorra
   ~150-250 MB de RAM en una VPS que ya toca swap, y hereda los backups
   cifrados a R2 que ya están en cron y verificados.

   Las tablas las crea el rol dueño (n8n) y esta aplicación entra como
   apm_app, que tiene SELECT/INSERT/UPDATE y NO tiene DELETE ni puede hacer
   ALTER. Es deliberado: en APM se archiva, no se borra, y una migración no
   se aplica sin querer desde el código. */

import pg from 'pg';

const { Pool } = pg;

/* max 5 y no el 10 por defecto: dos ejecuciones concurrentes como mucho
   (MAX_CONCURRENT_RUNS) no necesitan más, y cada conexión ociosa es memoria
   en un Postgres que además sirve a tu web y a n8n. */
export const db = new Pool({
  connectionString: process.env.APM_DB_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

db.on('error', (e) => console.error('pg pool:', e.message));

/* Para /api/health. Devuelve el motivo del fallo en vez de lanzar: una BD
   caída tiene que salir en la respuesta de salud, no tumbar el proceso. */
export async function dbOk() {
  try {
    await db.query('SELECT 1');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
