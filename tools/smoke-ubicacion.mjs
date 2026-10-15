/* Prueba de humo de la ubicación y de continuar un chat, DENTRO de apm-api.

   No pasa por HTTP: las rutas exigen cookie de Firebase y lo que hay que
   verificar aquí es el runtime.

   El veredicto NO es "la columna se guardó" —eso lo garantiza el INSERT— sino
   lo único que importa: que el agente SEPA dónde tiene que buscar. Por eso se
   le pregunta a él y se mira su respuesta. Y luego se le manda un segundo
   mensaje a la misma conversación para comprobar que la reanuda con contexto
   en vez de empezar otra a escondidas.

   Cuesta ~$0.03 con haiku.

   Correr:  docker cp tools/smoke-ubicacion.mjs apm-api:/tmp/ &&
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

console.log('1. Ejecución nueva con ubicación de destino (Newark, US)');
const run = await crearRun({
  prompt: '¿En qué ciudad tengo que buscar clientes potenciales? Responde solo el nombre.',
  location: { target: { city: 'Newark', country: 'US' } },
  title: 'smoke ubicación'
});

const { rows: cols } = await db.query(
  'SELECT base_city, base_country, target_city, target_country FROM run WHERE id = $1', [run.id]);
comprobar(cols[0].target_city === 'Newark' && cols[0].target_country === 'US',
  `la ubicación queda en la fila: ${JSON.stringify(cols[0])}`);

const fin1 = await esperarFin(run.id);
comprobar(fin1.status === 'done', `termina bien (${fin1.status}${fin1.error ? ': ' + fin1.error : ''})`);
const r1 = await ultimaRespuesta(run.id);
console.log(`     respuesta: ${r1.slice(0, 120).replace(/\n/g, ' ')}`);
comprobar(/newark/i.test(r1), 'el agente sabe que tiene que buscar en Newark');

console.log('2. Segundo mensaje en la MISMA conversación');
const seguido = await continuarRun(run.id, '¿Y en qué país está esa ciudad? Responde solo el país.');
comprobar(Boolean(seguido) && seguido.id === run.id, 'sigue en la misma ejecución, no crea otra');

const fin2 = await esperarFin(run.id);
comprobar(fin2.status === 'done', `la reanudación termina bien (${fin2.status})`);
const r2 = await ultimaRespuesta(run.id);
console.log(`     respuesta: ${r2.slice(0, 120).replace(/\n/g, ' ')}`);
/* La prueba de que reanudó CON contexto: nadie le ha dicho "esa ciudad" en
   este segundo mensaje. Si hubiera empezado de cero, no sabría cuál es. */
comprobar(/estados unidos|ee\.? ?uu|\bUSA\b|\bUS\b/i.test(r2), 'conserva el contexto del primer mensaje');

const { rows: ev } = await db.query(
  "SELECT count(*) FROM run_event WHERE run_id = $1 AND kind = 'user'", [run.id]);
comprobar(Number(ev[0].count) === 2, `los dos mensajes están en el hilo (${ev[0].count})`);

const { rows: fila } = await db.query('SELECT status, ended_at FROM run WHERE id = $1', [run.id]);
comprobar(Boolean(fila[0].ended_at), 'ended_at vuelve a estar puesto tras la segunda vuelta');

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`);
await db.end();
process.exit(fallos === 0 ? 0 : 1);
