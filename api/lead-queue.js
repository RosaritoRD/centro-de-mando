/* What each outcome button means and who gets called next.

   All pure functions: the API only applies them. That way the rules with
   legal consequences (a "don't call me" MUST suppress the number) are tested
   without a database and don't depend on what the browser sends. */

export const RESULTADOS = ['no_contesto', 'buzon', 'no_interesa', 'interesado', 'llamar_luego', 'no_llamar', 'numero_malo', 'demo'];

const ESTADO = {
  no_contesto: 'llamado', buzon: 'llamado', llamar_luego: 'llamado',
  interesado: 'interesado', demo: 'demo',
  no_interesa: 'descartado', no_llamar: 'descartado', numero_malo: 'descartado'
};
const SUPRIME = new Set(['no_llamar', 'numero_malo']);
const MAX_NOTAS = 5000;

/**
 * Validates and resolves a call outcome.
 * @returns {{ok:true, outcome, notes, callAgain, nextCallAt, suppress, leadStatus} | {ok:false, code, message}}
 */
export function reglasDeResultado(input = {}, ahora = new Date()) {
  const outcome = String(input.outcome || '');
  if (!RESULTADOS.includes(outcome)) return { ok: false, code: 'bad_outcome', message: 'resultado desconocido' };
  const notes = input.notes == null ? null : String(input.notes).trim() || null;
  if (notes && notes.length > MAX_NOTAS) return { ok: false, code: 'notes_too_long', message: `notes exceed ${MAX_NOTAS} characters` };

  const suppress = SUPRIME.has(outcome) ? outcome : null;
  // A "do not call" always beats whatever the form says.
  let callAgain = suppress ? false : input.callAgain === true;
  let nextCallAt = null;
  if (callAgain) {
    const fecha = new Date(input.nextCallAt);
    if (!input.nextCallAt || Number.isNaN(fecha.getTime())) {
      return { ok: false, code: 'next_call_required', message: 'a call-back needs a date' };
    }
    if (fecha.getTime() <= ahora.getTime()) {
      return { ok: false, code: 'next_call_past', message: 'the call-back date has already passed' };
    }
    nextCallAt = fecha.toISOString();
  }
  return { ok: true, outcome, notes, callAgain, nextCallAt, suppress, leadStatus: ESTADO[outcome] };
}

/**
 * Call order: first the overdue "call back" ones (oldest first, since it has
 * waited longest), then the new ones (newest first: a freshly issued license is
 * a business just getting started).
 * Left out: those reserved by another tab and those scheduled for later.
 */
export function ordenCola(leads, ahora = new Date()) {
  const t = ahora.getTime();
  const libre = (l) => !l.reserved_until || new Date(l.reserved_until).getTime() <= t;
  const vencidos = leads
    .filter((l) => libre(l) && l.next_call_at && new Date(l.next_call_at).getTime() <= t)
    .sort((a, b) => new Date(a.next_call_at) - new Date(b.next_call_at));
  const nuevos = leads
    .filter((l) => libre(l) && !l.next_call_at && l.status === 'nuevo')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return [...vencidos, ...nuevos];
}
