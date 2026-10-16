import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presupuestoDeRun, topeDeVuelta, PRESUPUESTO_RUN_DEFECTO, PRESUPUESTO_RUN_MAX } from './topes.js';

test('no budget requested gives the default', () => {
  assert.equal(presupuestoDeRun(undefined), PRESUPUESTO_RUN_DEFECTO);
  assert.equal(presupuestoDeRun(''), PRESUPUESTO_RUN_DEFECTO);
});

test('junk, negatives or zero never give NaN or "no cap": they give the default', () => {
  for (const v of ['abc', -5, 0, NaN, Infinity, null, {}]) {
    assert.equal(presupuestoDeRun(v), PRESUPUESTO_RUN_DEFECTO, String(v));
  }
});

test('a huge budget is clipped to the per-run maximum', () => {
  assert.equal(presupuestoDeRun(500), PRESUPUESTO_RUN_MAX);
});

test('a reasonable budget is respected', () => {
  assert.equal(presupuestoDeRun('0.5'), 0.5);
});

test('a turn can never spend more than what\'s left of the day', () => {
  assert.equal(topeDeVuelta(1, { limitUsd: 5, spentUsd: 4.5 }), 0.5);
});

test('if more is left than the run\'s budget, the run\'s budget wins', () => {
  assert.equal(topeDeVuelta(1, { limitUsd: 5, spentUsd: 0 }), 1);
});

test('day used up: cap 0 (comprobarTopes will already have stopped it)', () => {
  assert.equal(topeDeVuelta(1, { limitUsd: 5, spentUsd: 6 }), 0);
});

test('an old row with a broken budget never leaves a turn uncapped', () => {
  assert.equal(topeDeVuelta('NaN', { limitUsd: 5, spentUsd: 0 }), PRESUPUESTO_RUN_DEFECTO);
});
