/* Lo que este archivo protege no es la aritmética de la mediana: es la
   diferencia entre un panel que vigila y uno que tranquiliza.

   El fallo que motiva estas pruebas no dejó ni una fila roja en la base de
   datos. La credencial de Gmail se revocó el 23/08/2026 y el trigger falló
   ~5.900 veces en cuatro días, todas contra el log del contenedor. La tabla
   de ejecuciones siguió con 100% de `success` porque las ejecuciones que
   fallaron nunca llegaron a existir. Cualquier vigilancia que cuente errores
   es ciega a eso; hay que contar SILENCIOS.

   Los dos modos de fallar mal, y por qué cada uno tiene su prueba:

   1. Callarse un mudo. Si el umbral se fija en un número absoluto en vez de
      en la cadencia del propio workflow, el informe semanal sale "mudo" cada
      martes y el cron de 15 minutos puede estar cuatro horas parado sin que
      nadie se entere. Un umbral único miente sobre uno de los dos.

   2. Gritar sin motivo. Un workflow activo que nunca se ha ejecutado no está
      roto: puede ser un webhook que nadie ha llamado. Si eso sale en rojo, el
      aviso se vuelve ruido y a la tercera semana ya nadie lo mira — que es
      exactamente cómo se pierde el aviso que sí importaba.

   Correr:  node --test n8n.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticar, mediana } from './n8n.js';

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const AHORA = Date.parse('2026-08-27T18:00:00Z');

/* Genera ejecuciones hacia atrás desde `desde`, una cada `cada` ms. */
function cada(n, ms, desde = AHORA) {
  return Array.from({ length: n }, (_, i) => ({ startedAt: new Date(desde - i * ms).toISOString() }));
}

const wf = { id: 'W1', name: 'Un workflow' };

test('la mediana de un número par de huecos es el promedio de los dos centrales', () => {
  assert.equal(mediana([10, 20, 30, 40]), 25);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([]), null);
});

test('un cron que acaba de ejecutarse está ok', () => {
  const d = diagnosticar(wf, cada(10, 15 * MIN), AHORA);
  assert.equal(d.estado, 'ok');
  assert.equal(d.cadenciaMs, 15 * MIN);
});

test('el caso Gmail: activo, con historial, y cuatro días en silencio', () => {
  /* Ejecutaba cada par de horas hasta que la credencial se revocó. */
  const d = diagnosticar(wf, cada(10, 2 * HORA, AHORA - 4 * DIA), AHORA);
  assert.equal(d.estado, 'mudo', 'cuatro días sin ejecutar un cron de dos horas es la señal, y es la única que hubo');
  assert.equal(d.silencioMs, 4 * DIA);
});

test('el informe semanal no es un mudo por llevar tres días parado', () => {
  /* Corre los lunes. Un jueves lleva tres días sin ejecutarse y está sano.
     Con un umbral fijo de 24h saldría rojo cada semana. */
  const d = diagnosticar(wf, cada(5, 7 * DIA, AHORA - 3 * DIA), AHORA);
  assert.equal(d.estado, 'ok');
});

test('un cron de un minuto no se marca por saltarse unos pocos', () => {
  /* 3 × 1 min serían 3 minutos: sin el margen mínimo, un pico de carga en la
     VPS —que ya toca swap— pintaría el panel de rojo cada dos por tres. */
  const d = diagnosticar(wf, cada(10, 1 * MIN, AHORA - 20 * MIN), AHORA);
  assert.equal(d.estado, 'ok');
});

test('ese mismo cron de un minuto SÍ se marca cuando lleva medio día parado', () => {
  const d = diagnosticar(wf, cada(10, 1 * MIN, AHORA - 12 * HORA), AHORA);
  assert.equal(d.estado, 'mudo');
});

test('un workflow activo sin ejecuciones queda sin datos, no en rojo', () => {
  const d = diagnosticar(wf, [], AHORA);
  assert.equal(d.estado, 'sin_datos', 'un webhook que nadie ha llamado no está roto');
  assert.equal(d.ultima, null);
});

test('con una sola ejecución tampoco hay cadencia que comparar', () => {
  const d = diagnosticar(wf, cada(1, 0, AHORA - 30 * DIA), AHORA);
  assert.equal(d.estado, 'sin_datos');
  assert.equal(d.cadenciaMs, null);
  assert.ok(d.silencioMs > 29 * DIA, 'el silencio se informa igual, para poder mirarlo a ojo');
});

test('dos ejecuciones en el mismo instante no convierten el margen en cero', () => {
  /* cadencia 0 × 3 = 0: sin el suelo, cualquier silencio sería "mudo". */
  const t = new Date(AHORA - 10 * MIN).toISOString();
  const d = diagnosticar(wf, [{ startedAt: t }, { startedAt: t }], AHORA);
  assert.equal(d.estado, 'ok');
});

test('las fechas ilegibles se descartan en vez de envenenar la cadencia', () => {
  const buenas = cada(4, 30 * MIN);
  const d = diagnosticar(wf, [{ startedAt: 'no-es-una-fecha' }, ...buenas, { startedAt: null }], AHORA);
  assert.equal(d.estado, 'ok');
  assert.equal(d.cadenciaMs, 30 * MIN);
});

test('el orden de llegada no importa: n8n no promete devolverlas ordenadas', () => {
  const revueltas = [...cada(6, 20 * MIN)].reverse();
  const d = diagnosticar(wf, revueltas, AHORA);
  assert.equal(d.cadenciaMs, 20 * MIN);
  assert.equal(d.estado, 'ok');
});

test('una ráfaga de pruebas y luego trece días de nada sí es un mudo', () => {
  /* El caso real de Recepcionista-Llamadas-Agenda: seis ejecuciones seguidas
     el día que se montó y ni una llamada desde entonces. Se podría argumentar
     que no está "roto" —nadie ha llamado— pero para un panel de una persona
     la respuesta útil es la misma: eso lleva trece días sin dar señales y hay
     que mirarlo. Callarlo sería tratar "nunca funcionó en real" como salud. */
  const t0 = AHORA - 13 * DIA;
  const rafaga = [0, 2, 5, 9, 14, 20].map((s) => ({ startedAt: new Date(t0 + s * 1000).toISOString() }));
  const d = diagnosticar(wf, rafaga, AHORA);
  assert.equal(d.estado, 'mudo');
});
