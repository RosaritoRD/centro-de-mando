/* Phase 2 smoke test, INSIDE the apm-api container.

   It skips HTTP on purpose: the routes require a Firebase cookie, and what
   must be verified here is the runtime, not the guard. It walks the whole cycle:

     create run → the agent asks to write → it's DEFERRED
     → the pending approval shows up → it's approved
     → it resumes → the file really exists

   The verdict is the FILE on disk, never the `terminal_reason` or what the
   model says (lesson from SPIKE-01: a turn can end `completed`, with no error,
   the agent apologizing, having done nothing).

   Copy it into the container and run it. Costs ~$0.05 with haiku. */

import fs from 'node:fs';
import { db } from '/app/db.js';
import { crearRun, decidir, AGENT_CWD } from '/app/agent.js';

const DESTINO = `${AGENT_CWD}/smoke.txt`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function estadoDe(id) {
  const { rows } = await db.query('SELECT status, error FROM run WHERE id = $1', [id]);
  return rows[0];
}

/* Polls until the run reaches one of the expected states. The agent loop is
   asynchronous: without this the test would read the initial state and give a
   false negative. */
async function esperarEstado(id, estados, segundos = 120) {
  for (let i = 0; i < segundos * 2; i++) {
    const s = await estadoDe(id);
    if (estados.includes(s.status)) return s;
    await espera(500);
  }
  throw new Error(`run ${id} did not reach ${estados.join('|')} within ${segundos}s`);
}

let fallos = 0;
const check = (ok, etiqueta, detalle = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

try {
  fs.rmSync(DESTINO, { force: true });
  console.log('── 1. Create a run that needs permission ──');

  const run = await crearRun({
    prompt: `Write the text "apm phase 2 ok" to the file ${DESTINO}. Use the Write tool.`,
    model: 'claude-haiku-4-5',
    budgetUsd: 0.5,
    title: 'smoke phase 2'
  });
  console.log('  run:', run.id);

  const s1 = await esperarEstado(run.id, ['awaiting_approval', 'failed', 'done']);
  check(s1.status === 'awaiting_approval', 'the run STOPS to ask for permission', s1.status);
  check(!fs.existsSync(DESTINO), 'the file does NOT exist before approving');

  console.log('── 2. The pending approval ──');
  const { rows: aps } = await db.query(
    'SELECT id, tool_name, summary FROM approval WHERE run_id = $1 AND decision IS NULL', [run.id]);
  check(aps.length === 1, 'there is exactly 1 pending approval', String(aps.length));
  if (aps[0]) {
    check(aps[0].tool_name === 'Write', 'the tool is the right one', aps[0].tool_name);
    check(Boolean(aps[0].summary), 'it has a readable summary', aps[0].summary || '(empty)');
  }

  console.log('── 3. Approve and resume ──');
  const out = await decidir(aps[0].id, 'allow');
  check(out?.resumed === true, 'the decision resumes the run');

  const s2 = await esperarEstado(run.id, ['done', 'failed']);
  check(s2.status === 'done', 'the run finishes fine', s2.error || s2.status);

  const existe = fs.existsSync(DESTINO);
  check(existe, 'THE EFFECT HAPPENED: the file exists',
    existe ? JSON.stringify(fs.readFileSync(DESTINO, 'utf8').trim()) : 'missing');

  console.log('── 4. Cost and transcript ──');
  const { rows: [c] } = await db.query(
    'SELECT coalesce(sum(cost_usd),0) AS t FROM run_cost WHERE run_id = $1', [run.id]);
  check(Number(c.t) > 0, 'the cost was recorded', `$${Number(c.t).toFixed(6)}`);

  const { rows: [e] } = await db.query(
    'SELECT count(*)::int AS n FROM session_entry WHERE session_id = $1', [run.session_id || '']);
  const { rows: [r2] } = await db.query('SELECT session_id FROM run WHERE id = $1', [run.id]);
  const { rows: [e2] } = await db.query(
    'SELECT count(*)::int AS n FROM session_entry WHERE session_id = $1', [r2.session_id]);
  check(e2.n > 0, 'the transcript was mirrored to Postgres', `${e2.n} entries`);

  const { rows: [ev] } = await db.query(
    'SELECT count(*)::int AS n FROM run_event WHERE run_id = $1', [run.id]);
  check(ev.n > 0, 'there is an append-only event log', `${ev.n} events`);

  console.log(fallos === 0
    ? '\n>>> PHASE 2 OK: the approval cycle works end to end'
    : `\n>>> ${fallos} CHECKS FAILED`);
} catch (err) {
  console.error('\n>>> ERROR:', err.message);
  fallos++;
} finally {
  await db.end();
  process.exit(fallos === 0 ? 0 : 1);
}
