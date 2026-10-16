/* Google Maps source — gosom/google-maps-scraper in its web (REST) mode.

   ⚠ the owner's decision (24/09/2026): it's used accepting the risk under Google's
   ToS. That's why:
   - every lead from here is internal_only = true (the customer version never sees it);
   - searching is GENTLE: 1 at a time, 3 a day, max 100 results, always by hand;
   - it runs in its own container, with no public ports (gmaps-scraper service).

   The limits are checked here (pure function) and the container also runs
   with -c 1 and a single browser. */

import { nombreBonito, normalizarLote } from './common.js';

export const LIMITES_GMAPS = { porDia: 3, simultaneos: 1, maxResultados: 100 };

export function comprobarLimites({ corriendo, hoy }, limites = LIMITES_GMAPS) {
  if (corriendo >= limites.simultaneos) {
    return { ok: false, status: 409, code: 'scrape_busy', message: 'a Google Maps search is already running' };
  }
  if (hoy >= limites.porDia) {
    return { ok: false, status: 429, code: 'scrape_daily_limit', message: `limit of ${limites.porDia} Google Maps searches per day` };
  }
  return { ok: true };
}

export function leadsDesdeGmaps(filas, { location = null } = {}) {
  const r = normalizarLote(filas.slice(0, LIMITES_GMAPS.maxResultados), (f) => {
    const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(f.address || '')?.[1] || null;
    // "741 Lydig Ave, Bronx, NY 10462" → "Bronx". An area search brings in
    // businesses from nearby neighborhoods: the city comes from the address, not the search.
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

/** CSV (RFC 4180) → objects. The scraper exports CSV; no dependencies. */
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
 * Client for the scraper's REST API. `base` = http://gmaps-scraper:8080 (internal network).
 * Creates the job, waits for it to finish (polling) and downloads the CSV.
 */
export async function buscarGmaps({ query, location, limit }, { base, fetch = globalThis.fetch, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), maxMinutos = 20 } = {}) {
  if (!base) throw new Error('GMAPS_SCRAPER_URL is not configured');
  const texto = `${String(query || '').trim()} ${location ? `in ${location}` : ''}`.trim();
  if (texto.length < 3 || texto.length > 120) throw new Error('search is empty or too long');
  const crear = await fetch(`${base}/api/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `apm ${texto}`.slice(0, 60), keywords: [texto], lang: 'en', depth: 2, max_time: 600 })
  });
  if (!crear.ok) throw new Error(`the scraper did not accept the job (${crear.status})`);
  const { id } = await crear.json();
  if (!id) throw new Error('the scraper returned no job id');

  const limite = Date.now() + maxMinutos * 60_000;
  for (;;) {
    await esperar(15_000);
    const e = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(id)}`);
    if (!e.ok) throw new Error(`job status: ${e.status}`);
    const job = await e.json();
    const estado = String(job.status || job.Status || '').toLowerCase();
    if (estado === 'ok' || estado === 'done' || estado === 'completed') break;
    if (estado === 'failed' || estado === 'error') throw new Error('the scraper marked the job as failed');
    if (Date.now() > limite) throw new Error(`the scraper did not finish within ${maxMinutos} min`);
  }
  const d = await fetch(`${base}/api/v1/jobs/${encodeURIComponent(id)}/download`);
  if (!d.ok) throw new Error(`results download: ${d.status}`);
  const filas = parseCsv(await d.text());
  return leadsDesdeGmaps(filas.slice(0, Math.min(limit || LIMITES_GMAPS.maxResultados, LIMITES_GMAPS.maxResultados)), { location });
}
