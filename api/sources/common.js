/* Piezas compartidas por las fuentes de leads. */

import { normalizarTelefono } from '../phone.js';

const SIGLAS = new Set(['LLC', 'INC', 'CORP', 'LTD', 'NY', 'NYC', 'NJ', 'USA', 'DBA', 'II', 'III', 'HVAC', 'LP', 'PC']);

/** "EJEMPLO GENERAL CONSTRUCTION LLC" → "Ejemplo General Construction LLC". */
export function nombreBonito(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/[a-z0-9&'.]+/g, (w) => {
      const limpio = w.replace(/[.,]/g, '').toUpperCase();
      return SIGLAS.has(limpio) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .replace(/,\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Solo http(s): una ficha pública de Maps podría traer "javascript:…" y acabar en un href. */
export function webSegura(url) {
  const u = String(url || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 500 ? u : null;
}

/**
 * Filas crudas → leads normalizados. `mapear(fila)` devuelve el lead sin
 * teléfono normalizado; aquí se normaliza, se descartan inválidos y se
 * deduplica dentro del mismo lote.
 */
export function normalizarLote(filas, mapear) {
  const vistos = new Set();
  const leads = [];
  let invalid = 0;
  for (const fila of filas) {
    const lead = mapear(fila);
    const phoneE164 = normalizarTelefono(lead.phone);
    if (!phoneE164 || !lead.businessName) { invalid++; continue; }
    if (vistos.has(phoneE164)) continue;
    vistos.add(phoneE164);
    const { phone, ...resto } = lead;
    leads.push({ ...resto, website: webSegura(lead.website), phoneE164 });
  }
  return { found: filas.length, invalid, leads };
}
