/* tu empresa — APM · proyectos y health checks (Fase 5).

   Comprueba que las URLs públicas de el dueño responden. NO sustituye al
   vigilante del host (memoria monitoreo), que mira contenedores por
   dentro: esto mira desde fuera, que es donde está el usuario. Un contenedor
   sano detrás de un proxy roto sigue siendo un sitio caído.

   Se sondea con HEAD y se cae a GET: algunos servidores contestan 405 a HEAD.
   Solo se mira que responda, nunca el contenido — comparar HTML daría falsos
   positivos en cuanto alguien cambie una palabra. */

import { Router } from 'express';
import { db } from './db.js';

const TIMEOUT_MS = 8_000;
/* Cada 10 minutos. No es un sistema de alertas: es para que el panel diga la
   verdad cuando se abre. Más frecuencia solo gastaría CPU en una VPS que ya
   toca swap. */
const CADA_MS = 10 * 60 * 1000;

async function sondear(url) {
  const t0 = Date.now();
  const corte = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: corte });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: 'GET', redirect: 'follow', signal: corte });
    }
    return { ok: r.status < 400, status: r.status, ms: Date.now() - t0, error: null };
  } catch (e) {
    /* Un timeout es indistinguible de "caído" para quien lo usa, así que se
       registra como fallo con el motivo, no se descarta. */
    return { ok: false, status: null, ms: Date.now() - t0, error: e.name === 'TimeoutError'
      ? `sin respuesta en ${TIMEOUT_MS / 1000}s` : e.message };
  }
}

export async function comprobarTodos() {
  const { rows } = await db.query(
    'SELECT id, url FROM project WHERE archived_at IS NULL');
  /* En paralelo: son cuatro URLs y secuencial multiplicaría el timeout por
     cuatro en el peor caso. */
  const res = await Promise.all(rows.map(async (p) => ({ p, r: await sondear(p.url) })));
  for (const { p, r } of res) {
    await db.query(
      'INSERT INTO project_check (project_id, ok, status, ms, error) VALUES ($1,$2,$3,$4,$5)',
      [p.id, r.ok, r.status, r.ms, r.error]).catch((e) => console.error('check:', e.message));
  }
  return res.length;
}

export function rutasProyectos(auth) {
  const r = Router();

  r.get('/api/projects', auth, async (_req, res) => {
    try {
      /* DISTINCT ON es la forma barata en Postgres de traer "la última fila de
         cada grupo" sin subconsulta por proyecto. */
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.url, p.kind, p.area, c.ok, c.status, c.ms, c.error, c.created_at
           FROM project p
           LEFT JOIN LATERAL (
             SELECT ok, status, ms, error, created_at FROM project_check
              WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1
           ) c ON true
          WHERE p.archived_at IS NULL
          ORDER BY p.area, p.name`);
      res.json(rows.map((x) => ({
        id: x.id, name: x.name, url: x.url, kind: x.kind, area: x.area,
        ultimo: x.created_at ? {
          ok: x.ok, status: x.status, ms: x.ms, error: x.error, at: x.created_at
        } : null
      })));
    } catch (e) {
      console.error('projects:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'no pude leer los proyectos' } });
    }
  });

  /* Comprobar ahora. Existe porque tras un despliegue nadie quiere esperar
     diez minutos para saber si lo rompió. */
  r.post('/api/projects/check', auth, async (_req, res) => {
    try {
      res.json({ ok: true, comprobados: await comprobarTodos() });
    } catch (e) {
      console.error('check now:', e.message);
      res.status(500).json({ error: { code: 'check_error', message: 'no pude comprobar' } });
    }
  });

  r.post('/api/projects', auth, async (req, res) => {
    const { name, url, kind, area } = req.body || {};
    if (!name || !url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: { code: 'bad_project', message: 'name y url http(s) obligatorios' } });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO project (name, url, kind, area) VALUES ($1,$2,$3,$4) RETURNING id`,
        [name, url, kind || 'web', area || 'infra']);
      res.status(201).json({ id: rows[0].id });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: { code: 'ya_existe', message: 'esa URL ya está registrada' } });
      }
      console.error('crear project:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'no pude guardarlo' } });
    }
  });

  return r;
}

/* El intervalo arranca con el servidor. `unref()` para que no impida que el
   proceso termine si alguien lo para: un temporizador no debe mantener vivo
   un contenedor que se está apagando. */
export function arrancarVigilancia() {
  setTimeout(() => comprobarTodos().catch(() => {}), 5_000).unref();
  setInterval(() => comprobarTodos().catch(() => {}), CADA_MS).unref();
}
