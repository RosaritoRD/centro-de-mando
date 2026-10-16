/* Acme — APM · projects and health checks (Phase 5).

   Checks that the owner's public URLs respond. It does NOT replace the host
   watchdog, which looks at containers from the inside: this looks from the
   outside, where the user is. A healthy container behind a broken proxy is
   still a site that's down.

   Probes with HEAD and falls back to GET: some servers answer 405 to HEAD.
   It only checks that it responds, never the content — comparing HTML would
   give false positives as soon as someone changes a word. */

import { Router } from 'express';
import { db } from './db.js';

const TIMEOUT_MS = 8_000;
/* Every 10 minutes. It isn't an alerting system: it's so the dashboard tells
   the truth when you open it. More often would just burn CPU on a VPS that
   already touches swap. */
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
    /* A timeout is indistinguishable from "down" for whoever uses it, so it's
       recorded as a failure with the reason, not discarded. */
    return { ok: false, status: null, ms: Date.now() - t0, error: e.name === 'TimeoutError'
      ? `no response within ${TIMEOUT_MS / 1000}s` : e.message };
  }
}

export async function comprobarTodos() {
  const { rows } = await db.query(
    'SELECT id, url FROM project WHERE archived_at IS NULL');
  /* In parallel: there are four URLs, and doing them one by one would multiply
     the timeout by four in the worst case. */
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
      /* DISTINCT ON is Postgres's cheap way to get "the latest row of each
         group" without a subquery per project. */
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
      res.status(500).json({ error: { code: 'db_error', message: 'could not read the projects' } });
    }
  });

  /* Check now. It exists because after a deploy nobody wants to wait ten
     minutes to find out whether they broke it. */
  r.post('/api/projects/check', auth, async (_req, res) => {
    try {
      res.json({ ok: true, comprobados: await comprobarTodos() });
    } catch (e) {
      console.error('check now:', e.message);
      res.status(500).json({ error: { code: 'check_error', message: 'could not run the check' } });
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
        return res.status(409).json({ error: { code: 'ya_existe', message: 'that URL is already registered' } });
      }
      console.error('crear project:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'could not save it' } });
    }
  });

  return r;
}

/* The interval starts with the server. `unref()` so it doesn't stop the
   process from exiting if someone stops it: a timer must not keep a container
   alive while it's shutting down. */
export function arrancarVigilancia() {
  setTimeout(() => comprobarTodos().catch(() => {}), 5_000).unref();
  setInterval(() => comprobarTodos().catch(() => {}), CADA_MS).unref();
}
