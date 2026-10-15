/* Fuente Google Maps — scraper gosom/google-maps-scraper en su modo web (REST).

   ⚠ Decisión de el dueño (24/09/2026): se usa asumiendo el riesgo de los ToS de
   Google. Por eso:
   - todo lead de aquí es internal_only = true (la versión para clientes no lo ve);
   - la búsqueda es SUAVE: 1 a la vez, 3 al día, máx. 100 resultados, siempre a mano;
   - corre en su propio contenedor, sin puertos públicos (servicio gmaps-scraper).

   Los límites se comprueban aquí (función pura) y el contenedor además corre
   con -c 1 y un solo navegador. */

import { nombreBonito, normalizarLote } from './common.js';

export const LIMITES_GMAPS = { porDia: 3, simultaneos: 1, maxResultados: 100 };

export function comprobarLimites({ corriendo, hoy }, limites = LIMITES_GMAPS) {
  if (corriendo >= limites.simultaneos) {
    return { ok: false, status: 409, code: 'scrape_busy', message: 'ya hay una búsqueda de Google Maps en marcha' };
  }
  if (hoy >= limites.porDia) {
    return { ok: false, status: 429, code: 'scrape_daily_limit', message: `límite de ${limites.porDia} búsquedas de Google Maps por día` };
  }
  return { ok: true };
}

export function leadsDesdeGmaps(filas, { location = null } = {}) {
  const r = normalizarLote(filas.slice(0, LIMITES_GMAPS.maxResultados), (f) => {
    const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(f.address || '')?.[1] || null;
    // "741 Lydig Ave, Bronx, NY 10462" → "Bronx". La búsqueda por zona trae
    // negocios de barrios vecinos: la ciudad sale de la dirección, no de la búsqueda.
    const ciudad = /,\s*([^,]+),\s*[A-Z]{2}\s+\d{5}/.exec(f.address || '')?.[1]?.trim();
    return {
      businessName: nombreBonito(f.title),
      phone: f.phone,
      website: f.website || null,
      address: f.address || null,
      zip,
      boroughCity: ciudad || (location ? String(location).split(',')[0].trim() : null),
      state: /\b(NY|NJ|CT|PA)\b/.exec(f.address || '')?.[1] || null,
      sourceIds: { google_maps: f.place_id || f.cid || f.link || null },
      internalOnly: true
    };
  });
  return { ...r, found: Math.min(filas.length, r.found) };
}

/** CSV (RFC 4180) → objetos. El scraper exporta CSV; sin dependencias. */
export function parseCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  const s = String(texto || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '"' && s[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); if (fila.some((x) => x !== '')) filas.push(fila); }
  const [cab = [], ...resto] = filas;
  return resto.map((f) => Object.fromEntries(cab.map((k, i) => [k.trim(), f[i] ?? ''])));
}

/**
 * Cliente del REST del scraper. `base` = http://gmaps-scraper:8080 (red interna).
 * Crea el trabajo, espera a que termine (sondeando) y descarga el CSV.
 */
export async function buscarGmaps({ query, location, limit }, { base, fetch = globalThis.fetch, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), maxMinutos = 20 } = {}) {
  if (!base) throw new Error('GMAPS_SCRAPER_URL no está configurada');
  const texto = `${String(query || '').trim()} ${location ? `in ${location}` : ''}`.trim();
  if (texto.length < 3 || texto.length > 120) throw new Error('búsqueda vacía o demasiado larga');
  const crear = await fetch(`${base}/api/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `apm ${texto}`.slice(0, 60), keywords: [texto], lang: 'en', depth: 2, max_time: 600 })
  });
  if (!crear.ok) throw new Error(`el scraper no aceptó el trabajo (${crear.status})`);
  const { id } = await crear.json();
  if (!id) throw new Error('el scraper no devolvió id de trabajo');

  const limite = Date.now() + maxMinutos * 60_000;
  for (;;) {
    await esperar(15_000);
    const e = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(id)}`);
    if (!e.ok) throw new Error(`estado del trabajo: ${e.status}`);
    const job = await e.json();
    const estado = String(job.status || job.Status || '').toLowerCase();
    if (estado === 'ok' || estado === 'done' || estado === 'completed') break;
    if (estado === 'failed' || estado === 'error') throw new Error('el scraper marcó el trabajo como fallido');
    if (Date.now() > limite) throw new Error(`el scraper no terminó en ${maxMinutos} min`);
  }
  const d = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(id)}/download`);
  if (!d.ok) throw new Error(`descarga de resultados: ${d.status}`);
  const filas = parseCsv(await d.text());
  return leadsDesdeGmaps(filas.slice(0, Math.min(limit || LIMITES_GMAPS.maxResultados, LIMITES_GMAPS.maxResultados)), { location });
}
