/* Pieces shared by the lead sources. */

import { normalizarTelefono } from '../phone.js';

const SIGLAS = new Set(['LLC', 'INC', 'CORP', 'LTD', 'NY', 'NYC', 'NJ', 'USA', 'DBA', 'II', 'III', 'HVAC', 'LP', 'PC']);

/** "EXAMPLE GENERAL CONSTRUCTION LLC" → "Example General Construction LLC". */
export function nombreBonito(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/[a-z0-9&'.]+/g, (w) => {
      const limpio = w.replace(/[.,]/g, '').toUpperCase();
      return SIGLAS.has(limpio) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .replace(/,\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** http(s) only: a public Maps listing could carry "javascript:…" and end up in an href. */
export function webSegura(url) {
  const u = String(url || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 500 ? u : null;
}

/**
 * Raw rows → normalized leads. `mapear(fila)` returns the lead without a
 * normalized phone; here it gets normalized, invalid ones are dropped and the
 * batch is deduplicated.
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
