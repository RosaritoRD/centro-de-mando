/* Smoke test for the location and for continuing a chat, INSIDE apm-api.

   It skips HTTP: the routes require a Firebase cookie, and what must be
   verified here is the runtime.

   The verdict is NOT "the column was saved" — the INSERT guarantees that — but
   the only thing that matters: that the agent KNOWS where to search. So we ask
   it and look at its answer. Then a second message goes to the same
   conversation to check that it resumes with context instead of quietly
   starting another one.

   Costs ~$0.03 with haiku.

   Run:  docker cp tools/smoke-ubicacion.mjs apm-api:/tmp/ &&
            docker exec apm-api node /tmp/smoke-ubicacion.mjs  */

import { db } from '/app/db.js';
import { crearRun, continuarRun } from '/app/agent.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarFin(id, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    const { rows } = await db.query('SELECT status, error FROM run WHERE id = $1', [id]);
    if (['done', 'failed', 'cancelled'].includes(rows[0].status)) return rows[0];
    await espera(2000);
  }
  return { status: 'timeout' };
}

async function ultimaRespuesta(id) {
  const { rows } = await db.query(
    `SELECT payload FROM run_event WHERE run_id = $1 AND kind IN ('assistant','final')
      ORDER BY seq DESC LIMIT 1`, [id]);
  return rows[0]?.payload?.text || '';
}

let fallos = 0;
const comprobar = (ok, que) => {
  console.log(`${ok ? '  OK ' : '  NO '} ${que}`);
  if (!ok) fallos++;
};

console.log('1. New run with a target location (Newark, US)');
const run = await crearRun({
  prompt: 'Which city should I search for prospects in? Reply with the name only.',
  location: { target: { city: 'Newark', country: 'US' } },
  title: 'smoke location'
});

const { rows: cols } = await db.query(
  'SELECT base_city, base_country, target_city, target_country FROM run WHERE id = $1', [run.id]);
comprobar(cols[0].target_city === 'Newark' && cols[0].target_country === 'US',
  `the location is stored on the row: ${JSON.stringify(cols[0])}`);

const fin1 = await esperarFin(run.id);
comprobar(fin1.status === 'done', `finishes fine (${fin1.status}${fin1.error ? ': ' + fin1.error : ''})`);
const r1 = await ultimaRespuesta(run.id);
console.log(`     answer: ${r1.slice(0, 120).replace(/\n/g, ' ')}`);
comprobar(/newark/i.test(r1), 'the agent knows it has to search in Newark');

console.log('2. Second message in the SAME conversation');
const seguido = await continuarRun(run.id, 'And which country is that city in? Reply with the country only.');
comprobar(Boolean(seguido) && seguido.id === run.id, 'stays in the same run, does not create another');

const fin2 = await esperarFin(run.id);
comprobar(fin2.status === 'done', `the resume finishes fine (${fin2.status})`);
const r2 = await ultimaRespuesta(run.id);
console.log(`     answer: ${r2.slice(0, 120).replace(/\n/g, ' ')}`);
/* The proof it resumed WITH context: nobody named "that city" in this second
   message. Had it started from scratch, it wouldn't know which one. */
comprobar(/united states|estados unidos|\bUSA\b|\bUS\b/i.test(r2), 'keeps the context of the first message');

const { rows: ev } = await db.query(
  "SELECT count(*) FROM run_event WHERE run_id = $1 AND kind = 'user'", [run.id]);
comprobar(Number(ev[0].count) === 2, `both messages are in the thread (${ev[0].count})`);

const { rows: fila } = await db.query('SELECT status, ended_at FROM run WHERE id = $1', [run.id]);
comprobar(Boolean(fila[0].ended_at), 'ended_at is set again after the second turn');

console.log(fallos === 0 ? '\nALL GOOD' : `\n${fallos} FAILURES`);
await db.end();
process.exit(fallos === 0 ? 0 : 1);
