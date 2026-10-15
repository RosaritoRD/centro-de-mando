import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presupuestoDeRun, topeDeVuelta, PRESUPUESTO_RUN_DEFECTO, PRESUPUESTO_RUN_MAX } from './topes.js';

test('sin presupuesto pedido, el de por defecto', () => {
  assert.equal(presupuestoDeRun(undefined), PRESUPUESTO_RUN_DEFECTO);
  assert.equal(presupuestoDeRun(''), PRESUPUESTO_RUN_DEFECTO);
});

test('basura, negativos o cero no dan NaN ni "sin tope": dan el de por defecto', () => {
  for (const v of ['abc', -5, 0, NaN, Infinity, null, {}]) {
    assert.equal(presupuestoDeRun(v), PRESUPUESTO_RUN_DEFECTO, String(v));
  }
});

test('un presupuesto enorme se recorta al máximo por ejecución', () => {
  assert.equal(presupuestoDeRun(500), PRESUPUESTO_RUN_MAX);
});

test('un presupuesto razonable se respeta', () => {
  assert.equal(presupuestoDeRun('0.5'), 0.5);
});

test('la vuelta nunca puede gastar más de lo que queda del día', () => {
  assert.equal(topeDeVuelta(1, { limitUsd: 5, spentUsd: 4.5 }), 0.5);
});

test('si queda más que el presupuesto de la ejecución, manda el de la ejecución', () => {
  assert.equal(topeDeVuelta(1, { limitUsd: 5, spentUsd: 0 }), 1);
});

test('día agotado: tope 0 (comprobarTopes ya habrá frenado antes)', () => {
  assert.equal(topeDeVuelta(1, { limitUsd: 5, spentUsd: 6 }), 0);
});

test('una fila vieja con presupuesto roto no deja la vuelta sin tope', () => {
  assert.equal(topeDeVuelta('NaN', { limitUsd: 5, spentUsd: 0 }), PRESUPUESTO_RUN_DEFECTO);
});
