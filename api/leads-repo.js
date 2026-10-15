/* Prospección: todo el SQL en un sitio. Las reglas viven en lead-queue.js y
   call-window.js; aquí solo se lee y se escribe.

   Recibe el pool como dependencia (crearRepoLeads({ db })) para que las rutas
   se prueben con un repo falso y el SQL con un Postgres desechable. */

import { ordenCola } from './lead-queue.js';
import { dentroDeHorario, proximaApertura } from './call-window.js';

const RESERVA_MIN = 10;
const CANDIDATOS = 200;

export function crearRepoLeads({ db }) {
  async function enTransaccion(fn) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    // ── Importaciones ──────────────────────────────────────────
    async crearRun({ tenant, source, niche, params }) {
      const { rows } = await db.query(
        `INSERT INTO lead_source_run (tenant_id, source, niche, params) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant, source, niche, JSON.stringify(params || {})]);
      return rows[0].id;
    },

    async terminarRun(id, r) {
      await db.query(
        `UPDATE lead_source_run SET status = $2, found = $3, inserted = $4, merged = $5,
           suppressed = $6, invalid = $7, error = $8, ended_at = now() WHERE id = $1`,
        [id, r.status, r.found || 0, r.inserted || 0, r.merged || 0, r.suppressed || 0, r.invalid || 0, r.error || null]);
    },

    /**
     * Crea el run SOLO si los límites lo permiten, en una transacción con un
     * candado por (tenant, fuente): dos peticiones simultáneas no pueden leer
     * "0 corriendo" las dos y lanzar dos búsquedas a la vez.
     * `comprobar(conteo)` es comprobarLimites; devuelve { id } o { bloqueo }.
     */
    async crearRunConLimite({ tenant, source, niche, params, comprobar }) {
      return enTransaccion(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lead_source_run:${tenant}:${source}`]);
        const { rows } = await c.query(
          `SELECT count(*) FILTER (WHERE status = 'running' AND started_at > now() - interval '1 hour') AS corriendo,
                  count(*) FILTER (WHERE started_at > now() - interval '24 hours') AS hoy
             FROM lead_source_run WHERE tenant_id = $1 AND source = $2`, [tenant, source]);
        const lim = comprobar({ corriendo: Number(rows[0].corriendo), hoy: Number(rows[0].hoy) });
        if (!lim.ok) return { bloqueo: lim };
        const { rows: ins } = await c.query(
          `INSERT INTO lead_source_run (tenant_id, source, niche, params) VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenant, source, niche, JSON.stringify(params || {})]);
        return { id: ins[0].id };
      });
    },

    async obtenerRun(tenant, id) {
      const { rows } = await db.query('SELECT * FROM lead_source_run WHERE tenant_id = $1 AND id = $2', [tenant, id]);
      return rows[0] || null;
    },

    async ultimosRuns(tenant, limite = 10) {
      const { rows } = await db.query(
        'SELECT * FROM lead_source_run WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT $2', [tenant, limite]);
      return rows;
    },

    /** Para los límites del scraper: cuántos corren y cuántos se lanzaron en 24 h. */
    async contarRuns({ tenant, source }) {
      const { rows } = await db.query(
        `SELECT count(*) FILTER (WHERE status = 'running' AND started_at > now() - interval '1 hour') AS corriendo,
                count(*) FILTER (WHERE started_at > now() - interval '24 hours') AS hoy
           FROM lead_source_run WHERE tenant_id = $1 AND source = $2`, [tenant, source]);
      return { corriendo: Number(rows[0].corriendo), hoy: Number(rows[0].hoy) };
    },

    /**
     * Upsert por teléfono: un negocio que ya existe se UNE (fuentes, ids, web)
     * en vez de duplicarse. internal_only solo se queda en true si TODAS las
     * fuentes eran de scraper. Lo suprimido no entra.
     */
    async guardarLeads({ tenant, niche, source, leads }) {
      return enTransaccion(async (c) => {
        const { rows: sup } = await c.query(
          'SELECT phone_e164 FROM suppression WHERE tenant_id = $1 AND phone_e164 = ANY($2)',
          [tenant, leads.map((l) => l.phoneE164)]);
        const suprimidos = new Set(sup.map((s) => s.phone_e164));
        let inserted = 0;
        let merged = 0;
        for (const l of leads) {
          if (suprimidos.has(l.phoneE164)) continue;
          const { rows } = await c.query(
            `INSERT INTO lead (tenant_id, business_name, phone_e164, website, address, zip, borough_city, state,
                               niche, sources, source_ids, internal_only)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ARRAY[$10]::text[], $11, $12)
             ON CONFLICT (tenant_id, phone_e164) WHERE deleted_at IS NULL DO UPDATE SET
               sources       = ARRAY(SELECT DISTINCT unnest(lead.sources || EXCLUDED.sources)),
               source_ids    = lead.source_ids || EXCLUDED.source_ids,
               website       = COALESCE(lead.website, EXCLUDED.website),
               address       = COALESCE(lead.address, EXCLUDED.address),
               zip           = COALESCE(lead.zip, EXCLUDED.zip),
               internal_only = lead.internal_only AND EXCLUDED.internal_only,
               updated_at    = now()
             RETURNING (xmax = 0) AS nuevo`,
            [tenant, l.businessName, l.phoneE164, l.website, l.address, l.zip, l.boroughCity, l.state,
              niche, source, JSON.stringify(l.sourceIds || {}), l.internalOnly === true]);
          if (rows[0].nuevo) inserted++; else merged++;
        }
        return { inserted, merged, suppressed: leads.filter((l) => suprimidos.has(l.phoneE164)).length };
      });
    },

    // ── Cola de llamadas ───────────────────────────────────────
    /**
     * Siguiente lead a llamar. El orden lo decide ordenCola (probada); aquí se
     * filtra por la ventana horaria de CADA lead y se reserva 10 min con un
     * UPDATE condicional para que dos pestañas no den el mismo.
     */
    async siguienteLead({ tenant, niche, ahora = new Date() }) {
      const { rows } = await db.query(
        `SELECT l.* FROM lead l
          WHERE l.tenant_id = $1 AND l.niche = $2 AND l.deleted_at IS NULL
            AND l.status NOT IN ('cliente', 'descartado')
            AND ((l.next_call_at IS NOT NULL AND l.next_call_at <= $3) OR (l.next_call_at IS NULL AND l.status = 'nuevo'))
            AND (l.reserved_until IS NULL OR l.reserved_until <= $3)
            AND NOT EXISTS (SELECT 1 FROM suppression s WHERE s.tenant_id = l.tenant_id AND s.phone_e164 = l.phone_e164)
          ORDER BY l.next_call_at ASC NULLS LAST, l.created_at DESC
          LIMIT ${CANDIDATOS}`, [tenant, niche, ahora]);
      const ordenados = ordenCola(rows, ahora);
      const enHorario = ordenados.filter((l) => dentroDeHorario(ahora, l.timezone));
      if (ordenados.length && !enHorario.length) {
        return { lead: null, reason: 'outside_hours', opensAt: proximaApertura(ahora, ordenados[0].timezone) };
      }
      for (const cand of enHorario) {
        const { rows: res } = await db.query(
          `UPDATE lead SET reserved_until = $3::timestamptz + interval '${RESERVA_MIN} minutes'
            WHERE tenant_id = $1 AND id = $2 AND (reserved_until IS NULL OR reserved_until <= $3)
            RETURNING *`, [tenant, cand.id, ahora]);
        if (res[0]) return { lead: res[0], reason: null };
      }
      return { lead: null, reason: 'empty' };
    },

    async resumenCola({ tenant, niche, ahora = new Date() }) {
      const { rows } = await db.query(
        `SELECT count(*) FILTER (WHERE next_call_at IS NOT NULL AND next_call_at <= $3) AS due,
                count(*) FILTER (WHERE next_call_at IS NULL AND status = 'nuevo') AS nuevos,
                count(*) FILTER (WHERE next_call_at > $3) AS programados
           FROM lead WHERE tenant_id = $1 AND niche = $2 AND deleted_at IS NULL
            AND status NOT IN ('cliente', 'descartado')`, [tenant, niche, ahora]);
      return { due: Number(rows[0].due), new: Number(rows[0].nuevos), scheduled: Number(rows[0].programados) };
    },

    async nichos(tenant) {
      const { rows } = await db.query(
        `SELECT niche, count(*)::int AS total FROM lead WHERE tenant_id = $1 AND deleted_at IS NULL
          GROUP BY niche ORDER BY total DESC`, [tenant]);
      return rows;
    },

    // ── Llamadas ───────────────────────────────────────────────
    /** Aplica un resultado YA validado por reglasDeResultado. */
    async registrarLlamada({ tenant, leadId, r, correctsId = null }) {
      return enTransaccion(async (c) => {
        const { rows: ls } = await c.query(
          'SELECT id, phone_e164 FROM lead WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE',
          [tenant, leadId]);
        if (!ls[0]) return null;
        if (correctsId) {
          const { rows: prev } = await c.query(
            'SELECT 1 FROM call_log WHERE tenant_id = $1 AND id = $2 AND lead_id = $3', [tenant, correctsId, leadId]);
          if (!prev[0]) return { error: 'bad_correction' };
        }
        const { rows } = await c.query(
          `INSERT INTO call_log (tenant_id, lead_id, outcome, notes, call_again, next_call_at, corrects_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
          [tenant, leadId, r.outcome, r.notes, r.callAgain, r.nextCallAt, correctsId]);
        await c.query(
          `UPDATE lead SET status = $3, next_call_at = $4, reserved_until = NULL, updated_at = now()
            WHERE tenant_id = $1 AND id = $2`, [tenant, leadId, r.leadStatus, r.nextCallAt]);
        if (r.suppress) {
          await c.query(
            `INSERT INTO suppression (tenant_id, phone_e164, reason) VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, phone_e164) DO NOTHING`, [tenant, ls[0].phone_e164, r.suppress]);
        }
        return { callId: rows[0].id, createdAt: rows[0].created_at, leadStatus: r.leadStatus };
      });
    },

    async obtenerLead(tenant, id) {
      const { rows } = await db.query('SELECT * FROM lead WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL', [tenant, id]);
      if (!rows[0]) return null;
      const { rows: historial } = await db.query(
        `SELECT id, outcome, notes, call_again, next_call_at, corrects_id, created_at
           FROM call_log WHERE tenant_id = $1 AND lead_id = $2 ORDER BY created_at DESC LIMIT 100`, [tenant, id]);
      return { ...rows[0], history: historial };
    },

    async listarLeads({ tenant, niche, status, source, q, limit = 50, offset = 0 }) {
      const where = ['tenant_id = $1', 'deleted_at IS NULL'];
      const args = [tenant];
      const add = (sql, v) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
      if (niche) add('niche = ?', niche);
      if (status) add('status = ?', status);
      if (source) add('? = ANY(sources)', source);
      if (q) {
        // El mismo parámetro sirve para nombre y teléfono; los comodines del usuario se escapan.
        args.push(`%${String(q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        where.push(`(business_name ILIKE $${args.length} OR phone_e164 LIKE $${args.length})`);
      }
      args.push(limit, offset);
      const { rows } = await db.query(
        `SELECT *, count(*) OVER () AS total FROM lead WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
      return { total: Number(rows[0]?.total || 0), leads: rows.map(({ total, ...l }) => l) };
    },

    async llamadasEntre({ tenant, desde, hasta }) {
      const { rows } = await db.query(
        `SELECT id, outcome, corrects_id FROM call_log WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
        [tenant, desde, hasta]);
      return rows;
    },

    // ── Guiones ────────────────────────────────────────────────
    async guiones(tenant) {
      const { rows } = await db.query(
        'SELECT niche, title, body, updated_at FROM call_script WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY niche', [tenant]);
      return rows;
    },

    async guion(tenant, niche) {
      const { rows } = await db.query(
        'SELECT niche, title, body, updated_at FROM call_script WHERE tenant_id = $1 AND niche = $2 AND deleted_at IS NULL', [tenant, niche]);
      return rows[0] || null;
    },

    async guardarGuion({ tenant, niche, title, body }) {
      const { rows } = await db.query(
        `INSERT INTO call_script (tenant_id, niche, title, body) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, niche) WHERE deleted_at IS NULL
         DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, updated_at = now()
         RETURNING niche, title, body, updated_at`, [tenant, niche, title, body]);
      return rows[0];
    }
  };
}
