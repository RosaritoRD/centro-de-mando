/* Prospección por llamadas: la lógica que NO puede fallar en silencio.
   Un teléfono mal normalizado duplica leads (llamas dos veces al mismo), una
   ventana horaria mal calculada es una infracción TCPA, y un "no me llames"
   que no suprime es una denuncia. Todo con reloj inyectado.

   Correr:  node --test leads-logic.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefono, telefonoVisible } from './phone.js';
import { dentroDeHorario, proximaApertura } from './call-window.js';
import { reglasDeResultado, ordenCola, RESULTADOS } from './lead-queue.js';
import { semanaIso, rangoSemana, scoreboard } from './scoreboard.js';

// ── Teléfono ────────────────────────────────────────────────────
test('tres formatos del mismo número dan el mismo E.164', () => {
  for (const t of ['(347) 555-0174', '3475550174', '+1 347-555-0174', '1-347-555-0174', '347.555.0174']) {
    assert.equal(normalizarTelefono(t), '+13475550174', t);
  }
});

test('inválidos: corto, extensión, no US, vacío', () => {
  for (const t of ['407-5474', '(347) 555-0174 ext 12', '+44 20 7946 0958', '', null, '0475550174', '1234567890']) {
    assert.equal(normalizarTelefono(t), null, String(t));
  }
});

test('formato de pantalla', () => {
  assert.equal(telefonoVisible('+13475550174'), '(347) 555-0174');
});

// ── Ventana TCPA ────────────────────────────────────────────────
const NY = 'America/New_York';
test('8:00-21:00 hora local del lead, bordes incluidos/excluidos', () => {
  assert.equal(dentroDeHorario(new Date('2026-09-24T11:59:00Z'), NY), false); // 7:59 EDT
  assert.equal(dentroDeHorario(new Date('2026-09-24T12:00:00Z'), NY), true);  // 8:00
  assert.equal(dentroDeHorario(new Date('2026-09-25T00:59:00Z'), NY), true);  // 20:59
  assert.equal(dentroDeHorario(new Date('2026-09-25T01:00:00Z'), NY), false); // 21:00
});

test('horario de invierno (EST): 8:00 son las 13:00Z', () => {
  assert.equal(dentroDeHorario(new Date('2026-12-10T12:59:00Z'), NY), false);
  assert.equal(dentroDeHorario(new Date('2026-12-10T13:00:00Z'), NY), true);
});

test('próxima apertura: de noche → mañana 8:00; de madrugada → hoy 8:00', () => {
  assert.equal(proximaApertura(new Date('2026-09-25T02:00:00Z'), NY).toISOString(), '2026-09-25T12:00:00.000Z');
  assert.equal(proximaApertura(new Date('2026-09-24T10:00:00Z'), NY).toISOString(), '2026-09-24T12:00:00.000Z');
});

// ── Reglas de resultado ─────────────────────────────────────────
const AHORA = new Date('2026-09-24T14:00:00Z');

test('no_llamar y numero_malo fuerzan NO volver a llamar y suprimen, aunque el cliente mande true', () => {
  for (const outcome of ['no_llamar', 'numero_malo']) {
    const r = reglasDeResultado({ outcome, callAgain: true, nextCallAt: '2026-09-30T14:00:00Z' }, AHORA);
    assert.equal(r.ok, true);
    assert.equal(r.callAgain, false);
    assert.equal(r.nextCallAt, null);
    assert.equal(r.suppress, outcome);
    assert.equal(r.leadStatus, 'descartado');
  }
});

test('volver a llamar exige fecha futura', () => {
  assert.equal(reglasDeResultado({ outcome: 'llamar_luego', callAgain: true }, AHORA).ok, false);
  assert.equal(reglasDeResultado({ outcome: 'llamar_luego', callAgain: true, nextCallAt: '2026-09-20T10:00:00Z' }, AHORA).ok, false);
  const r = reglasDeResultado({ outcome: 'llamar_luego', callAgain: true, nextCallAt: '2026-09-25T14:00:00Z' }, AHORA);
  assert.equal(r.ok, true);
  assert.equal(r.nextCallAt, '2026-09-25T14:00:00.000Z');
});

test('estado del lead según resultado', () => {
  const s = o => reglasDeResultado({ outcome: o, callAgain: false }, AHORA).leadStatus;
  assert.equal(s('no_contesto'), 'llamado');
  assert.equal(s('buzon'), 'llamado');
  assert.equal(s('interesado'), 'interesado');
  assert.equal(s('demo'), 'demo');
  assert.equal(s('no_interesa'), 'descartado');
});

test('resultado desconocido y notas enormes se rechazan', () => {
  assert.equal(reglasDeResultado({ outcome: 'otro' }, AHORA).ok, false);
  assert.equal(reglasDeResultado({ outcome: 'buzon', notes: 'x'.repeat(5001) }, AHORA).ok, false);
  assert.ok(RESULTADOS.includes('buzon'));
});

test('cola: primero los "llamar luego" vencidos (el más antiguo), luego los nuevos (el más reciente)', () => {
  const leads = [
    { id: 'nuevo-viejo', status: 'nuevo', next_call_at: null, created_at: '2026-09-01T00:00:00Z' },
    { id: 'futuro', status: 'llamado', next_call_at: '2026-09-30T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
    { id: 'vencido-2', status: 'llamado', next_call_at: '2026-09-23T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
    { id: 'nuevo-reciente', status: 'nuevo', next_call_at: null, created_at: '2026-09-20T00:00:00Z' },
    { id: 'vencido-1', status: 'llamado', next_call_at: '2026-09-22T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
    { id: 'reservado', status: 'nuevo', next_call_at: null, reserved_until: '2026-09-24T14:05:00Z', created_at: '2026-09-21T00:00:00Z' }
  ];
  assert.deepEqual(ordenCola(leads, AHORA).map(l => l.id), ['vencido-1', 'vencido-2', 'nuevo-reciente', 'nuevo-viejo']);
});

// ── Scoreboard ──────────────────────────────────────────────────
test('semana ISO en hora de NY (domingo 23:30 EDT sigue siendo esa semana)', () => {
  assert.equal(semanaIso(new Date('2026-09-28T03:30:00Z')), '2026-W39'); // dom 27 23:30 EDT
  assert.equal(semanaIso(new Date('2026-09-28T05:00:00Z')), '2026-W40'); // lun 28 01:00 EDT
  const r = rangoSemana('2026-W39');
  assert.equal(r.desde.toISOString(), '2026-09-21T04:00:00.000Z');
  assert.equal(r.hasta.toISOString(), '2026-09-28T04:00:00.000Z');
});

test('scoreboard: cifras y tasas exactas, las filas corregidas no cuentan', () => {
  const log = [
    { id: 'a', outcome: 'no_contesto' }, { id: 'b', outcome: 'buzon' }, { id: 'c', outcome: 'buzon' },
    { id: 'd', outcome: 'no_interesa' }, { id: 'e', outcome: 'interesado' }, { id: 'f', outcome: 'demo' },
    { id: 'g', outcome: 'no_llamar' }, { id: 'h', outcome: 'interesado' },       // mal marcada…
    { id: 'i', outcome: 'llamar_luego', corrects_id: 'h' }                         // …y corregida
  ];
  const s = scoreboard(log);
  assert.equal(s.calls, 8);
  assert.equal(s.voicemail, 2);
  assert.equal(s.noAnswer, 1);
  assert.equal(s.answered, 5);          // no_interesa, interesado, demo, no_llamar, llamar_luego
  assert.equal(s.interested, 1);
  assert.equal(s.demos, 1);
  assert.equal(s.doNotCall, 1);
  assert.equal(s.contactRate, 0.625);   // 5/8
  assert.equal(s.interestRate, 0.4);    // (1+1)/5
});

test('scoreboard vacío no divide por cero', () => {
  const s = scoreboard([]);
  assert.equal(s.calls, 0);
  assert.equal(s.contactRate, 0);
  assert.equal(s.interestRate, 0);
});
