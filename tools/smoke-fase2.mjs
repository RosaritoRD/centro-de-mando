/* Prueba de humo de la Fase 2, DENTRO del contenedor apm-api.

   No pasa por HTTP a propósito: las rutas exigen cookie de Firebase y lo que
   hay que verificar aquí es el runtime, no el guard. Recorre el ciclo entero:

     crear ejecución → el agente pide escribir → se DIFIERE
     → aparece la aprobación pendiente → se aprueba
     → reanuda → el archivo existe de verdad

   El veredicto es el ARCHIVO en disco, nunca el `terminal_reason` ni lo que
   diga el modelo (lección de SPIKE-01: un turno puede terminar `completed`,
   sin error, con el agente disculpándose, sin haber hecho nada).

   Se copia y se corre con tools/smoke-fase2.sh. Cuesta ~$0.05 con haiku. */

import fs from 'node:fs';
import { db } from '/app/db.js';
import { crearRun, decidir, AGENT_CWD } from '/app/agent.js';

const DESTINO = `${AGENT_CWD}/smoke.txt`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function estadoDe(id) {
  const { rows } = await db.query('SELECT status, error FROM run WHERE id = $1', [id]);
  return rows[0];
}

/* Sondea hasta que la ejecución llegue a uno de los estados esperados. El
   bucle del agente es asíncrono: sin esto la prueba leería el estado inicial
   y daría un falso negativo. */
async function esperarEstado(id, estados, segundos = 120) {
  for (let i = 0; i < segundos * 2; i++) {
    const s = await estadoDe(id);
    if (estados.includes(s.status)) return s;
    await espera(500);
  }
  throw new Error(`la ejecución ${id} no llegó a ${estados.join('|')} en ${segundos}s`);
}

let fallos = 0;
const check = (ok, etiqueta, detalle = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};

try {
  fs.rmSync(DESTINO, { force: true });
  console.log('── 1. Crear ejecución que necesita permiso ──');

  const run = await crearRun({
    prompt: `Escribe el texto "apm fase 2 ok" en el archivo ${DESTINO}. Usa la herramienta Write.`,
    model: 'claude-haiku-4-5',
    budgetUsd: 0.5,
    title: 'smoke fase 2'
  });
  console.log('  run:', run.id);

  const s1 = await esperarEstado(run.id, ['awaiting_approval', 'failed', 'done']);
  check(s1.status === 'awaiting_approval', 'la ejecución se PARA a pedir permiso', s1.status);
  check(!fs.existsSync(DESTINO), 'el archivo NO existe antes de aprobar');

  console.log('── 2. La aprobación pendiente ──');
  const { rows: aps } = await db.query(
    'SELECT id, tool_name, summary FROM approval WHERE run_id = $1 AND decision IS NULL', [run.id]);
  check(aps.length === 1, 'hay exactamente 1 aprobación pendiente', String(aps.length));
  if (aps[0]) {
    check(aps[0].tool_name === 'Write', 'la herramienta es la correcta', aps[0].tool_name);
    check(Boolean(aps[0].summary), 'trae resumen legible', aps[0].summary || '(vacío)');
  }

  console.log('── 3. Aprobar y reanudar ──');
  const out = await decidir(aps[0].id, 'allow');
  check(out?.resumed === true, 'la decisión reanuda la ejecución');

  const s2 = await esperarEstado(run.id, ['done', 'failed']);
  check(s2.status === 'done', 'la ejecución termina bien', s2.error || s2.status);

  const existe = fs.existsSync(DESTINO);
  check(existe, 'EL EFECTO OCURRIÓ: el archivo existe',
    existe ? JSON.stringify(fs.readFileSync(DESTINO, 'utf8').trim()) : 'no está');

  console.log('── 4. Coste y transcript ──');
  const { rows: [c] } = await db.query(
    'SELECT coalesce(sum(cost_usd),0) AS t FROM run_cost WHERE run_id = $1', [run.id]);
  check(Number(c.t) > 0, 'se anotó el coste', `$${Number(c.t).toFixed(6)}`);

  const { rows: [e] } = await db.query(
    'SELECT count(*)::int AS n FROM session_entry WHERE session_id = $1', [run.session_id || '']);
  const { rows: [r2] } = await db.query('SELECT session_id FROM run WHERE id = $1', [run.id]);
  const { rows: [e2] } = await db.query(
    'SELECT count(*)::int AS n FROM session_entry WHERE session_id = $1', [r2.session_id]);
  check(e2.n > 0, 'el transcript se replicó en Postgres', `${e2.n} entradas`);

  const { rows: [ev] } = await db.query(
    'SELECT count(*)::int AS n FROM run_event WHERE run_id = $1', [run.id]);
  check(ev.n > 0, 'hay log de eventos append-only', `${ev.n} eventos`);

  console.log(fallos === 0
    ? '\n>>> FASE 2 OK: el ciclo de aprobación funciona de punta a punta'
    : `\n>>> ${fallos} COMPROBACIONES FALLIDAS`);
} catch (err) {
  console.error('\n>>> ERROR:', err.message);
  fallos++;
} finally {
  await db.end();
  process.exit(fallos === 0 ? 0 : 1);
}
