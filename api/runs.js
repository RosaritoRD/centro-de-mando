/* Acme — APM · run and approval routes (Phase 2).

   The chat contract: a run is created with POST /api/runs and followed with
   GET /api/runs/:id/stream. The stream is NOT the state — it's a nudge to
   avoid polling. The state is `run_event`, which is why the stream starts by
   REPLAYING what already happened before emitting live: a browser that
   connects late, or reconnects after a drop, sees the whole conversation and
   not only what happens from now on. */

import { Router } from 'express';
import { db } from './db.js';
import { bus, continuarRun, crearRun, decidir, ejecucionesVivas } from './agent.js';
import { desdeFilaRun, comoTexto } from './location.js';

export function rutasRuns(auth) {
  const r = Router();

  /* ── Create a run ──────────────────────────────────────────────── */
  r.post('/api/runs', auth, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: { code: 'bad_prompt', message: 'a prompt is required' } });
    }
    if (prompt.length > 20000) {
      return res.status(400).json({ error: { code: 'prompt_too_long', message: '20,000 characters max' } });
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
      /* 429, not 500: it isn't a failure, it's the handbrake working. The
         front end tells them apart to show a notice instead of a red error. */
      if (e.code === 'budget_exhausted' || e.code === 'too_many_runs') {
        return res.status(429).json({ error: { code: e.code, message: e.message } });
      }
      console.error('crear run:', e.message);
      res.status(500).json({ error: { code: 'run_error', message: 'could not start the run' } });
    }
  });

  /* ── List ──────────────────────────────────────────────────────── */
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
          /* `continuable` is decided by the server, not the browser: the server
             knows that without a session_id there's nothing to resume, so the
             reply box never appears only to vanish when you press it. */
          continuable: Boolean(x.session_id) && !['running', 'queued', 'awaiting_approval'].includes(x.status),
          ubicacion: desdeFilaRun(x),
          buscaEn: comoTexto(desdeFilaRun(x).target)
        }))
      });
    } catch (e) {
      console.error('listar runs:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'could not read the runs' } });
    }
  });

  /* ── Detail ────────────────────────────────────────────────────── */
  r.get('/api/runs/:id', auth, async (req, res) => {
    try {
      const { rows } = await db.query('SELECT * FROM run WHERE id = $1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: { code: 'not_found', message: 'not found' } });
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
      res.status(500).json({ error: { code: 'db_error', message: 'could not read the run' } });
    }
  });

  /* ── Another message in an open chat ───────────────────────────
     A separate route rather than POST /api/runs with an id: creating and
     continuing fail in different ways (409 if it's still working, 409 if
     there's no session to resume) and mixing them would hide exactly those
     two cases. */
  r.post('/api/runs/:id/messages', auth, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: { code: 'bad_prompt', message: 'a prompt is required' } });
    }
    if (prompt.length > 20000) {
      return res.status(400).json({ error: { code: 'prompt_too_long', message: '20,000 characters max' } });
    }
    try {
      const out = await continuarRun(req.params.id, prompt);
      if (!out) return res.status(404).json({ error: { code: 'not_found', message: 'not found' } });
      res.status(201).json(out);
    } catch (e) {
      if (e.code === 'budget_exhausted' || e.code === 'too_many_runs') {
        return res.status(429).json({ error: { code: e.code, message: e.message } });
      }
      if (e.code === 'run_busy' || e.code === 'no_session') {
        return res.status(409).json({ error: { code: e.code, message: e.message } });
      }
      console.error('continuar run:', e.message);
      res.status(500).json({ error: { code: 'run_error', message: 'could not continue the conversation' } });
    }
  });

  /* ── Stream (SSE) ──────────────────────────────────────────────── */
  r.get('/api/runs/:id/stream', auth, async (req, res) => {
    const runId = req.params.id;

    /* These four headers are what keep the chat from looking frozen.
       `X-Accel-Buffering: no` is the one that turns off nginx buffering — it's
       needed HERE and also in the NPM Proxy Host (report F §6): with only one
       of the two, the response arrives all at once at the end. */
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

    /* Replay before going live. The browser only sends `Last-Event-ID` when
       reconnecting, so a network drop neither duplicates nor loses anything:
       it resumes exactly where it left off. */
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

    /* Heartbeat every 25 s. Without it, a proxy with a 60 s timeout cuts off a
       long run that's thinking, and the browser thinks it died. */
    const latido = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(latido);
      bus.off(runId, onEvento);
    });
  });

  /* ── Approvals ─────────────────────────────────────────────────── */
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
      console.error('approvals:', e.message);
      res.status(500).json({ error: { code: 'db_error', message: 'could not read the approvals' } });
    }
  });

  r.post('/api/approvals/:id', auth, async (req, res) => {
    const decision = req.body?.decision;
    if (decision !== 'allow' && decision !== 'deny') {
      return res.status(400).json({ error: { code: 'bad_decision', message: "decision: 'allow' or 'deny'" } });
    }
    try {
      const out = await decidir(req.params.id, decision, req.body?.reason);
      /* 409, not 404: the row exists; what's gone is the chance to decide.
         Happens when you tap twice on your phone. */
      if (!out) {
        return res.status(409).json({ error: { code: 'already_decided', message: 'already decided or does not exist' } });
      }
      res.json({ ok: true, runId: out.runId, resumed: out.resumed });
    } catch (e) {
      console.error('decidir:', e.message);
      res.status(500).json({ error: { code: 'approval_error', message: 'could not apply the decision' } });
    }
  });

  return r;
}
