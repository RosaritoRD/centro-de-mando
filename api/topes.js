/* tu empresa — APM · topes de gasto por ejecución. Lógica pura, sin BD.

   El tope del día se comprobaba solo ANTES de lanzar, y cada vuelta recibía
   su presupuesto entero: con $4,50 gastados de $5, una ejecución de $1
   terminaba el día en $5,50. Y `budgetUsd` venía del cliente sin límite
   (`budgetUsd: 500` o un NaN que el SDK lee como "sin tope"). Aquí el código
   decide, no el cliente. */

export const PRESUPUESTO_RUN_DEFECTO = 1;
export const PRESUPUESTO_RUN_MAX = 5;

/* El presupuesto que se guarda en la fila del run. */
export function presupuestoDeRun(pedido) {
  const n = Number(pedido);
  if (!Number.isFinite(n) || n <= 0) return PRESUPUESTO_RUN_DEFECTO;
  return Math.min(n, PRESUPUESTO_RUN_MAX);
}

/* El maxBudgetUsd de UNA vuelta: lo del run, pero nunca más de lo que queda
   del día. Se calcula en cada vuelta (crear, continuar, reanudar tras aprobar). */
export function topeDeVuelta(presupuestoRun, { limitUsd, spentUsd }) {
  const queda = Math.max(0, Number(limitUsd) - Number(spentUsd));
  return Math.min(presupuestoDeRun(presupuestoRun), queda);
}
