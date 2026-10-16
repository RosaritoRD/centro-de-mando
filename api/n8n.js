/* Acme — APM · n8n bridge (Phase 6).

   n8n keeps running its own things; APM watches. This does NOT reimplement
   n8n or move its workflows: it gives a "what's running and what broke" view
   inside the command center, so you don't have to open another dashboard.

   ⚠️ The n8n REST API **has no endpoint to run a workflow** (report F,
   verified). Triggering is done by webhook; this is the monitoring half of the
   bridge, the half that adds value without risk.

   It talks over the internal network (`http://n8n:5678`), not the public
   domain: it never goes out to the internet or through the proxy. */

import { Router } from 'express';

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const TIMEOUT_MS = 10_000;

async function n8n(ruta) {
  if (!BASE || !KEY) {
    const e = new Error('n8n is not configured (N8N_BASE_URL or N8N_API_KEY missing)');
    e.code = 'sin_config';
    throw e;
  }
  const r = await fetch(`${BASE}/api/v1${ruta}`, {
    headers: { 'X-N8N-API-KEY': KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) {
    const e = new Error(`n8n answered ${r.status}`);
    e.code = r.status === 401 ? 'clave_invalida' : 'n8n_error';
    throw e;
  }
  return r.json();
}

/* n8n's errors aren't APM's errors: if n8n is down, this tab says so and the
   rest of the dashboard keeps working. Hence 502, not 500. */
function fallo(res, e, msg) {
  const code = e.code || 'n8n_error';
  const status = code === 'sin_config' ? 501 : code === 'clave_invalida' ? 502 : 502;
  console.error('n8n:', e.message);
  res.status(status).json({ error: { code, message: msg } });
}

/* ── Silent workflows ────────────────────────────────────────────
   The executions list isn't enough to know whether things are fine, and this
   is the part that was hard to discover: when the TRIGGER is what fails, n8n
   creates no execution at all. No red row, no `status: 'error'`, nothing to
   count. The workflow simply stops showing up, and a "latest executions" list
   full of green reads as health.

   It happened on 23/08/2026: the Gmail credential was revoked and the
   `Correo nuevo` trigger failed almost 6,000 times in four days — all in the
   container log, none in the database. The dashboard kept showing
   `13 of 13 workflows active` and a strip of green executions.

   The signal that does exist is silence: a workflow that used to run every X
   and has gone much longer than X without running. It's compared against its
   OWN cadence, not a fixed threshold, because a 15-minute cron and a weekly
   report live side by side here, and any single number would lie about one
   of them.

   What we do NOT do: invent a verdict when there's no data. An active workflow
   with fewer than two executions may be a webhook nobody has called yet, and
   calling it "broken" would teach you to ignore the warning. */

/* Below this nothing is flagged even if the cadence is seconds: a one-minute
   cron that skips two runs during a load spike isn't broken. */
const MARGEN_MINIMO_MS = 60 * 60 * 1000;
/* Three cadences of silence. Two gave false positives with crons that depend
   on there being something to process (the leads one doesn't run if there
   are no new leads). */
const CADENCIAS_DE_GRACIA = 3;

export function mediana(nums) {
  if (nums.length === 0) return null;
  const orden = [...nums].sort((a, b) => a - b);
  const m = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[m] : (orden[m - 1] + orden[m]) / 2;
}

/* Pure: a workflow and ITS executions go in, a verdict comes out. No network,
   no clock of its own — `ahora` is injected — so it can be fully tested. */
export function diagnosticar(workflow, ejecuciones, ahora = Date.now()) {
  const base = { id: workflow.id, name: workflow.name };

  const marcas = (ejecuciones || [])
    .map((e) => Date.parse(e.startedAt))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);

  if (marcas.length < 2) {
    return { ...base, estado: 'sin_datos', ultima: marcas[0] ? new Date(marcas[0]).toISOString() : null,
      cadenciaMs: null, silencioMs: marcas[0] ? ahora - marcas[0] : null };
  }

  const huecos = [];
  for (let i = 0; i < marcas.length - 1; i++) huecos.push(marcas[i] - marcas[i + 1]);
  const cadenciaMs = mediana(huecos);
  const silencioMs = ahora - marcas[0];

  /* A zero cadence (two executions in the same millisecond) would make any
     silence exceed the threshold. It falls back to the minimum margin. */
  const umbral = Math.max(cadenciaMs * CADENCIAS_DE_GRACIA, MARGEN_MINIMO_MS);

  return {
    ...base,
    estado: silencioMs > umbral ? 'mudo' : 'ok',
    ultima: new Date(marcas[0]).toISOString(),
    cadenciaMs,
    silencioMs
  };
}

export function rutasN8n(auth) {
  const r = Router();

  r.get('/api/n8n/workflows', auth, async (_req, res) => {
    try {
      const d = await n8n('/workflows?limit=100');
      /* Only what gets rendered. A workflow carries all its nodes, hundreds of
         KB per response the browser doesn't need. */
      res.json((d.data || [])
        .filter((w) => !w.isArchived)
        .map((w) => ({ id: w.id, name: w.name, active: !!w.active, updatedAt: w.updatedAt }))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)));
    } catch (e) { fallo(res, e, 'could not read the n8n workflows'); }
  });

  r.get('/api/n8n/executions', auth, async (req, res) => {
    const limite = Math.min(Number(req.query.limit) || 20, 100);
    try {
      const d = await n8n(`/executions?limit=${limite}&includeData=false`);
      res.json((d.data || []).map((x) => ({
        id: x.id,
        workflowId: x.workflowId,
        /* `status` can be success|error|running|waiting. Passed through as-is:
           translating it here would invent a vocabulary n8n already has. */
        status: x.status,
        startedAt: x.startedAt,
        stoppedAt: x.stoppedAt
      })));
    } catch (e) { fallo(res, e, 'could not read the n8n executions'); }
  });


  /* One diagnosis per active workflow. Each one's executions are fetched
     separately instead of a global list: with a 15-minute cron around, any
     global page fills up with that one and buries the rest. */
  r.get('/api/n8n/salud', auth, async (_req, res) => {
    try {
      const d = await n8n('/workflows?limit=100&active=true');
      const activos = (d.data || []).filter((w) => !w.isArchived);

      const ahora = Date.now();
      const partes = await Promise.all(activos.map(async (w) => {
        try {
          const e = await n8n(`/executions?workflowId=${encodeURIComponent(w.id)}&limit=10&includeData=false`);
          return diagnosticar(w, e.data || [], ahora);
        } catch {
          /* Failing to read ONE workflow can't take down the whole report: it's
             marked as no-data and the rest is delivered. */
          return { id: w.id, name: w.name, estado: 'sin_datos', ultima: null, cadenciaMs: null, silencioMs: null };
        }
      }));

      const orden = { mudo: 0, sin_datos: 1, ok: 2 };
      partes.sort((a, b) => orden[a.estado] - orden[b.estado] || a.name.localeCompare(b.name));
      res.json({ leidoA: new Date(ahora).toISOString(), mudos: partes.filter((p) => p.estado === 'mudo').length, workflows: partes });
    } catch (e) { fallo(res, e, 'could not diagnose the n8n workflows'); }
  });

  return r;
}
