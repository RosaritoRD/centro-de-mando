/* tu empresa — APM · rutas de ejecuciones y aprobaciones (Fase 2).

   El contrato del chat: se crea una ejecución con POST /api/runs y se sigue
   con GET /api/runs/:id/stream. El stream NO es el estado — es un empujón
   para no hacer polling. El estado es `run_event`, y por eso el stream
   empieza REPRODUCIENDO lo que ya pasó antes de emitir en vivo: un navegador
   que se conecta tarde, o que se reconecta tras un corte, ve la conversación
   entera y no solo lo que ocurra a partir de ahora. */

import { Router } from 'express';
import { db } from './db.js';
import { bus, continuarRun, crearRun, decidir, ejecucionesVivas } from './agent.js';
import { desdeFilaRun, comoTexto } from './location.js';

export function rutasRuns(auth) {
  const r = Router();

  /* ── Crear ejecución ───────────────────────────────────────────── */
  r.post('/api/runs', auth, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: { code: 'bad_prompt', message: 'hace falta un prompt' } });
    }
    if (prompt.length > 20000) {
      return res.status(400).json({ error: { code: 'prompt_too_long', message: 'máximo 20.000 caracteres' } });
    }
    try {
      const run = await crearRun({
        prompt,
        area: req.body?.area,
        model: req.body?.model,
        budgetUsd: req.body?.budgetUsd,
        title: req.body?.title,
        location: req.body?.location
      });
      res.status(201).json({ id: run.id, status: run.status, model: run.model });
    } catch (e) {
      /* 429 y no 500: no es un fallo, es el freno de mano funcionando. El
         front lo distingue para enseñar un aviso en vez de un error rojo. */
      if (e.code === 'budget_exhausted' || e.code === 'too_many_runs') {
        return res.status(429).json({ error: { code: e.code, message: e.message } });
      }
      console.error('crear run:', e.message);
      res.status(500).json({ error: { code: 'run_error', message: 'no pude arrancar la ejecución' } });
    }
  });

  /* ── Listado ───────────────────────────────────────────────────── */
  r.get('/api/runs', auth, async (req, res) => {
    const limite = Math.min(Number(req.query.limit) || 30, 100);
    try {
      const { rows } = await db.query(
        `SELECT r.id, r.area, r.title, r.status, r.model, r.created_at, r.ended_at,
                r.session_id, r.base_city, r.base_country, r.target_city, r.target_country,
                coalesce((SELECT sum(cost_usd) FROM run_cost c WHERE c.run_id = r.id), 0) AS cost_usd
           FROM run r ORDER BY r.created_at DESC LIMIT $1`, [limite]);
      res.json({
        vivas: ejecucionesVivas(),
        runs: rows.map((x) => ({
          id: x.id, area: x.area, title: x.title, status: x.status, model: x.model,
          createdAt: x.created_at, endedAt: x.ended_at, costUsd: Number(x.cost_usd),
          /* `continuable` lo decide el servidor y no el navegador: es el
             servidor quien sabe que sin session_id no hay nada que reanudar,
             y así el botón de escribir no aparece para desaparecer al pulsar. */
          continuable: Boolean(x.session_id) && !['running', 'queued', 'awaiting_approval'].includes(x.status),
          ubicacion: desdeFilaRun(x),
          buscaEn: comoTexto(desdeFilaRun(x).target)
        }))
      });
    } catch (e) {
      console.error('listar runs:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'no pude leer las ejecuciones' } });
    }
  });

  /* ── Detalle ───────────────────────────────────────────────────── */
  r.get('/api/runs/:id', auth, async (req, res) => {
    try {
      const { rows } = await db.query('SELECT * FROM run WHERE id = $1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: { code: 'not_found', message: 'no existe' } });
      const { rows: ev } = await db.query(
        'SELECT seq, kind, payload, created_at FROM run_event WHERE run_id = $1 ORDER BY seq', [req.params.id]);
      const { rows: ap } = await db.query(
        `SELECT id, request_id, tool_name, tool_input, summary, decision, created_at
           FROM approval WHERE run_id = $1 ORDER BY created_at`, [req.params.id]);
      const x = rows[0];
      res.json({
        id: x.id, area: x.area, title: x.title, status: x.status, model: x.model,
        sessionId: x.session_id, error: x.error, createdAt: x.created_at, endedAt: x.ended_at,
        continuable: Boolean(x.session_id) && !['running', 'queued', 'awaiting_approval'].includes(x.status),
        ubicacion: desdeFilaRun(x),
        events: ev.map((e) => ({ seq: e.seq, kind: e.kind, payload: e.payload, at: e.created_at })),
        approvals: ap.map((a) => ({
          id: a.id, requestId: a.request_id, tool: a.tool_name, input: a.tool_input,
          summary: a.summary, decision: a.decision, createdAt: a.created_at
        }))
      });
    } catch (e) {
      console.error('detalle run:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'no pude leer la ejecución' } });
    }
  });

  /* ── Otro mensaje en un chat ya abierto ────────────────────────
     Ruta aparte y no un POST /api/runs con un id: crear y continuar fallan
     de formas distintas (409 si sigue trabajando, 409 si no hay sesión que
     reanudar) y mezclarlas escondería justo esos dos casos. */
  r.post('/api/runs/:id/messages', auth, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: { code: 'bad_prompt', message: 'hace falta un prompt' } });
    }
    if (prompt.length > 20000) {
      return res.status(400).json({ error: { code: 'prompt_too_long', message: 'máximo 20.000 caracteres' } });
    }
    try {
      const out = await continuarRun(req.params.id, prompt);
      if (!out) return res.status(404).json({ error: { code: 'not_found', message: 'no existe' } });
      res.status(201).json(out);
    } catch (e) {
      if (e.code === 'budget_exhausted' || e.code === 'too_many_runs') {
        return res.status(429).json({ error: { code: e.code, message: e.message } });
      }
      if (e.code === 'run_busy' || e.code === 'no_session') {
        return res.status(409).json({ error: { code: e.code, message: e.message } });
      }
      console.error('continuar run:', e.message);
      res.status(500).json({ error: { code: 'run_error', message: 'no pude continuar la conversación' } });
    }
  });

  /* ── Stream (SSE) ──────────────────────────────────────────────── */
  r.get('/api/runs/:id/stream', auth, async (req, res) => {
    const runId = req.params.id;

    /* Estas cuatro cabeceras son las que hacen que el chat no parezca
       colgado. `X-Accel-Buffering: no` es la que desactiva el buffering de
       nginx — hace falta AQUÍ y además en el Proxy Host de NPM (informe F
       §6): con una sola de las dos, la respuesta llega de golpe al final. */
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    const enviar = (e) => {
      if (e.seq) res.write(`id: ${e.seq}\n`);
      res.write(`event: ${e.kind}\n`);
      res.write(`data: ${JSON.stringify(e.payload ?? {})}\n\n`);
    };

    /* Reproducción antes de emitir en vivo. `Last-Event-ID` lo manda el
       navegador solo al reconectar, así que un corte de red no duplica ni
       pierde: se reanuda justo donde se quedó. */
    const desde = Number(req.header('Last-Event-ID') || req.query.desde || 0);
    try {
      const { rows } = await db.query(
        'SELECT seq, kind, payload FROM run_event WHERE run_id = $1 AND seq > $2 ORDER BY seq',
        [runId, desde]);
      for (const e of rows) enviar({ seq: e.seq, kind: e.kind, payload: e.payload });
    } catch (e) {
      console.error('replay sse:', e.message);
    }

    const onEvento = (e) => enviar(e);
    bus.on(runId, onEvento);

    /* Latido cada 25 s. Sin esto, un proxy con timeout de 60 s corta una
       ejecución larga que esté pensando y el navegador cree que murió. */
    const latido = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(latido);
      bus.off(runId, onEvento);
    });
  });

  /* ── Aprobaciones ──────────────────────────────────────────────── */
  r.get('/api/approvals', auth, async (_req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT a.id, a.run_id, a.tool_name, a.tool_input, a.summary, a.created_at, r.title
           FROM approval a JOIN run r ON r.id = a.run_id
          WHERE a.decision IS NULL ORDER BY a.created_at`);
      res.json(rows.map((a) => ({
        id: a.id, runId: a.run_id, runTitle: a.title, tool: a.tool_name,
        input: a.tool_input, summary: a.summary, createdAt: a.created_at
      })));
    } catch (e) {
      console.error('aprobaciones:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'no pude leer las aprobaciones' } });
    }
  });

  r.post('/api/approvals/:id', auth, async (req, res) => {
    const decision = req.body?.decision;
    if (decision !== 'allow' && decision !== 'deny') {
      return res.status(400).json({ error: { code: 'bad_decision', message: "decision: 'allow' o 'deny'" } });
    }
    try {
      const out = await decidir(req.params.id, decision, req.body?.reason);
      /* 409 y no 404: la fila existe, lo que ya no está es la posibilidad de
         decidir. Pasa si se pulsa dos veces desde el móvil. */
      if (!out) {
        return res.status(409).json({ error: { code: 'already_decided', message: 'ya estaba decidida o no existe' } });
      }
      res.json({ ok: true, runId: out.runId, resumed: out.resumed });
    } catch (e) {
      console.error('decidir:', e.message);
      res.status(500).json({ error: { code: 'approval_error', message: 'no pude aplicar la decisión' } });
    }
  });

  return r;
}
