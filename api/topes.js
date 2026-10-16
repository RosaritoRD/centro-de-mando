/* Acme — APM · per-run spending caps. Pure logic, no DB.

   The daily cap used to be checked only BEFORE launching, and every turn got
   its whole budget: with $4.50 spent out of $5, a $1 run ended the day at
   $5.50. And `budgetUsd` came from the client with no limit (`budgetUsd: 500`
   or a NaN the SDK reads as "no cap"). Here the code decides, not the client. */

export const PRESUPUESTO_RUN_DEFECTO = 1;
export const PRESUPUESTO_RUN_MAX = 5;

/* The budget stored in the run's row. */
export function presupuestoDeRun(pedido) {
  const n = Number(pedido);
  if (!Number.isFinite(n) || n <= 0) return PRESUPUESTO_RUN_DEFECTO;
  return Math.min(n, PRESUPUESTO_RUN_MAX);
}

/* The maxBudgetUsd for ONE turn: the run's budget, but never more than what's
   left of the day. Computed on every turn (create, continue, resume after approval). */
export function topeDeVuelta(presupuestoRun, { limitUsd, spentUsd }) {
  const queda = Math.max(0, Number(limitUsd) - Number(spentUsd));
  return Math.min(presupuestoDeRun(presupuestoRun), queda);
}
