/* Qué significa cada botón de resultado y a quién se llama después.

   Todo en funciones puras: la API solo las aplica. Así las reglas que tienen
   consecuencias legales (un "no me llames" DEBE suprimir el teléfono) se
   prueban sin base de datos y no dependen de lo que mande el navegador. */

export const RESULTADOS = ['no_contesto', 'buzon', 'no_interesa', 'interesado', 'llamar_luego', 'no_llamar', 'numero_malo', 'demo'];

const ESTADO = {
  no_contesto: 'llamado', buzon: 'llamado', llamar_luego: 'llamado',
  interesado: 'interesado', demo: 'demo',
  no_interesa: 'descartado', no_llamar: 'descartado', numero_malo: 'descartado'
};
const SUPRIME = new Set(['no_llamar', 'numero_malo']);
const MAX_NOTAS = 5000;

/**
 * Valida y resuelve un resultado de llamada.
 * @returns {{ok:true, outcome, notes, callAgain, nextCallAt, suppress, leadStatus} | {ok:false, code, message}}
 */
export function reglasDeResultado(input = {}, ahora = new Date()) {
  const outcome = String(input.outcome || '');
  if (!RESULTADOS.includes(outcome)) return { ok: false, code: 'bad_outcome', message: 'resultado desconocido' };
  const notes = input.notes == null ? null : String(input.notes).trim() || null;
  if (notes && notes.length > MAX_NOTAS) return { ok: false, code: 'notes_too_long', message: `las notas pasan de ${MAX_NOTAS} caracteres` };

  const suppress = SUPRIME.has(outcome) ? outcome : null;
  // Un "no llamar" gana siempre a lo que diga el formulario.
  let callAgain = suppress ? false : input.callAgain === true;
  let nextCallAt = null;
  if (callAgain) {
    const fecha = new Date(input.nextCallAt);
    if (!input.nextCallAt || Number.isNaN(fecha.getTime())) {
      return { ok: false, code: 'next_call_required', message: 'para volver a llamar hace falta una fecha' };
    }
    if (fecha.getTime() <= ahora.getTime()) {
      return { ok: false, code: 'next_call_past', message: 'la fecha para volver a llamar ya pasó' };
    }
    nextCallAt = fecha.toISOString();
  }
  return { ok: true, outcome, notes, callAgain, nextCallAt, suppress, leadStatus: ESTADO[outcome] };
}

/**
 * Orden de llamada: primero los "volver a llamar" ya vencidos (el más antiguo
 * primero, que es el que lleva más esperando), después los nuevos (el más
 * reciente primero: una licencia recién sacada es un negocio que arranca).
 * Fuera: los reservados por otra pestaña y los que se llaman más adelante.
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
