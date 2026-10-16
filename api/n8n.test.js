/* What this file protects isn't the median arithmetic: it's the difference
   between a dashboard that watches and one that reassures.

   The failure behind these tests didn't leave a single red row in the
   database. The Gmail credential was revoked on 23/08/2026 and the trigger
   failed ~5,900 times in four days, all of it in the container log. The
   executions table stayed at 100% `success` because the failed executions
   never came into existence. Any monitoring that counts errors is blind to
   that; you have to count SILENCES.

   The two ways to fail badly, and why each has its own test:

   1. Missing a silent one. If the threshold is a fixed number instead of the
      workflow's own cadence, the weekly report shows up "silent" every Tuesday
      and the 15-minute cron can be stopped for four hours without anyone
      noticing. A single threshold lies about one of the two.

   2. Crying wolf. An active workflow that has never run isn't broken: it may
      be a webhook nobody has called. If that shows up red, the warning turns
      into noise and by the third week nobody looks at it — which is exactly how
      you miss the warning that did matter.

   Run:  node --test n8n.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticar, mediana } from './n8n.js';

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const AHORA = Date.parse('2026-08-27T18:00:00Z');

/* Generates executions going back from `desde`, one every `ms`. */
function cada(n, ms, desde = AHORA) {
  return Array.from({ length: n }, (_, i) => ({ startedAt: new Date(desde - i * ms).toISOString() }));
}

const wf = { id: 'W1', name: 'A workflow' };

test('the median of an even number of gaps is the mean of the two middle ones', () => {
  assert.equal(mediana([10, 20, 30, 40]), 25);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([]), null);
});

test('a cron that just ran is ok', () => {
  const d = diagnosticar(wf, cada(10, 15 * MIN), AHORA);
  assert.equal(d.estado, 'ok');
  assert.equal(d.cadenciaMs, 15 * MIN);
});

test('the Gmail case: active, with history, and four days of silence', () => {
  /* It ran every couple of hours until the credential was revoked. */
  const d = diagnosticar(wf, cada(10, 2 * HORA, AHORA - 4 * DIA), AHORA);
  assert.equal(d.estado, 'mudo', 'four days without running a two-hour cron is the signal, and it was the only one');
  assert.equal(d.silencioMs, 4 * DIA);
});

test('the weekly report is not silent just because it stopped three days ago', () => {
  /* It runs on Mondays. On a Thursday it hasn't run for three days and is
     healthy. With a fixed 24h threshold it would turn red every week. */
  const d = diagnosticar(wf, cada(5, 7 * DIA, AHORA - 3 * DIA), AHORA);
  assert.equal(d.estado, 'ok');
});

test('a one-minute cron is not flagged for skipping a few runs', () => {
  /* 3 × 1 min would be 3 minutes: without the minimum margin, a load spike on
     the VPS — which already touches swap — would paint the dashboard red all
     the time. */
  const d = diagnosticar(wf, cada(10, 1 * MIN, AHORA - 20 * MIN), AHORA);
  assert.equal(d.estado, 'ok');
});

test('that same one-minute cron IS flagged after half a day stopped', () => {
  const d = diagnosticar(wf, cada(10, 1 * MIN, AHORA - 12 * HORA), AHORA);
  assert.equal(d.estado, 'mudo');
});

test('an active workflow with no executions is no-data, not red', () => {
  const d = diagnosticar(wf, [], AHORA);
  assert.equal(d.estado, 'sin_datos', 'a webhook nobody has called is not broken');
  assert.equal(d.ultima, null);
});

test('with a single execution there is no cadence to compare either', () => {
  const d = diagnosticar(wf, cada(1, 0, AHORA - 30 * DIA), AHORA);
  assert.equal(d.estado, 'sin_datos');
  assert.equal(d.cadenciaMs, null);
  assert.ok(d.silencioMs > 29 * DIA, 'the silence is still reported, so you can eyeball it');
});

test('two executions at the same instant do not turn the margin into zero', () => {
  /* cadence 0 × 3 = 0: without the floor, any silence would be "silent". */
  const t = new Date(AHORA - 10 * MIN).toISOString();
  const d = diagnosticar(wf, [{ startedAt: t }, { startedAt: t }], AHORA);
  assert.equal(d.estado, 'ok');
});

test('unreadable dates are dropped instead of poisoning the cadence', () => {
  const buenas = cada(4, 30 * MIN);
  const d = diagnosticar(wf, [{ startedAt: 'not-a-date' }, ...buenas, { startedAt: null }], AHORA);
  assert.equal(d.estado, 'ok');
  assert.equal(d.cadenciaMs, 30 * MIN);
});

test('arrival order does not matter: n8n does not promise sorted results', () => {
  const revueltas = [...cada(6, 20 * MIN)].reverse();
  const d = diagnosticar(wf, revueltas, AHORA);
  assert.equal(d.cadenciaMs, 20 * MIN);
  assert.equal(d.estado, 'ok');
});

test('a burst of tests and then thirteen days of nothing IS silent', () => {
  /* The real Recepcionista-Llamadas-Agenda case: six executions in a row the
     day it was set up, and not a single call since. You could argue it isn't
     "broken" — nobody called — but for a one-person dashboard the useful answer
     is the same: it's been thirteen days without a sign of life and it needs a
     look. Staying quiet would treat "never worked for real" as health. */
  const t0 = AHORA - 13 * DIA;
  const rafaga = [0, 2, 5, 9, 14, 20].map((s) => ({ startedAt: new Date(t0 + s * 1000).toISOString() }));
  const d = diagnosticar(wf, rafaga, AHORA);
  assert.equal(d.estado, 'mudo');
});
