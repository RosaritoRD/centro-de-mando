/* Fuentes de leads: que lo que entra ya venga normalizado, y que un fallo del
   proveedor se vea como fallo y no como "no hay negocios".

   Correr:  node --test sources/sources.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buscarNyc, urlNyc, CATEGORIAS_NYC } from './nyc-open-data.js';
import { leadsDesdeGmaps, comprobarLimites, LIMITES_GMAPS } from './google-maps.js';

const fixture = async (f) => JSON.parse(await readFile(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));

// ── NYC Open Data ───────────────────────────────────────────────
test('la URL filtra activos, categoría, barrio y con teléfono, sin inyección en $where', () => {
  const u = new URL(urlNyc({ category: "Home Improvement Contractor", borough: "Bronx' OR '1'='1" }));
  const where = u.searchParams.get('$where');
  assert.match(where, /license_status='Active'/);
  assert.match(where, /business_category='Home Improvement Contractor'/);
  assert.match(where, /contact_phone IS NOT NULL/);
  assert.match(where, /address_borough='Bronx'' OR ''1''=''1'/); // comillas escapadas SoQL
});

test('categoría fuera de la lista blanca se rechaza', async () => {
  await assert.rejects(buscarNyc({ category: 'Drop table' }, { fetch: async () => ({}) }), /categoría/);
  assert.ok(CATEGORIAS_NYC.includes('Locksmith'));
});

test('fixture NYC → leads normalizados; inválidos contados aparte', async () => {
  const datos = await fixture('nyc-sample.json');
  const fetch = async () => ({ ok: true, status: 200, json: async () => datos });
  const r = await buscarNyc({ category: 'Home Improvement Contractor', borough: 'Bronx' }, { fetch });
  assert.equal(r.found, 4);
  assert.equal(r.invalid, 1);
  assert.equal(r.leads.length, 3);
  const l = r.leads[0];
  assert.equal(l.phoneE164, '+16465550192');
  assert.equal(l.businessName, 'Ejemplo General Construction LLC');
  assert.deepEqual(l.sourceIds, { nyc_open_data: '0000001-DCWP' });
  assert.equal(l.internalOnly, false);
  assert.equal(l.boroughCity, 'Bronx');
});

test('API de NYC caída → error, nunca lista vacía', async () => {
  const fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(buscarNyc({ category: 'Locksmith', borough: 'Bronx' }, { fetch }), /503/);
});

// ── Google Maps (scraper) ───────────────────────────────────────
test('resultados del scraper → leads internal_only, sin teléfono fuera', async () => {
  const filas = await fixture('gmaps-sample.json');
  const r = leadsDesdeGmaps(filas, { location: 'Bronx, NY' });
  assert.equal(r.found, 3);
  assert.equal(r.invalid, 1);
  assert.equal(r.leads.length, 2);
  assert.equal(r.leads[0].internalOnly, true);
  assert.equal(r.leads[0].phoneE164, '+17185550172');
  assert.equal(r.leads[0].website, 'https://prueba-construction.example');
  assert.ok(r.leads[0].sourceIds.google_maps);
  assert.equal(r.leads[0].boroughCity, 'Bronx', 'la ciudad sale de la dirección');
});

test('límites suaves: uno a la vez (409) y 3 al día (429)', () => {
  assert.deepEqual(comprobarLimites({ corriendo: 0, hoy: 0 }), { ok: true });
  assert.equal(comprobarLimites({ corriendo: 1, hoy: 0 }).status, 409);
  assert.equal(comprobarLimites({ corriendo: 0, hoy: LIMITES_GMAPS.porDia }).status, 429);
  assert.equal(LIMITES_GMAPS.maxResultados, 100);
});

test('CSV con comillas, comas y saltos dentro de campos', async () => {
  const { parseCsv } = await import('./google-maps.js');
  const filas = parseCsv('title,phone,address\r\n"Prueba Co, Inc.","+1 718-555-0172","4000 Broadway\nBronx, NY 10463"\r\n"Dice ""hola""",,x\n');
  assert.equal(filas.length, 2);
  assert.equal(filas[0].title, 'Prueba Co, Inc.');
  assert.equal(filas[0].address, '4000 Broadway\nBronx, NY 10463');
  assert.equal(filas[1].title, 'Dice "hola"');
  assert.equal(filas[1].phone, '');
});

test('cliente del scraper: crea, espera, descarga; fallo del trabajo → error', async () => {
  const { buscarGmaps } = await import('./google-maps.js');
  const csv = 'title,phone,website,address,link\nPrueba Co,+1 718-555-0172,,"Bronx, NY 10463",L1\n';
  let sondeos = 0;
  const fetch = async (url, opt = {}) => {
    if (opt.method === 'POST') return { ok: true, json: async () => ({ id: 'j1' }) };
    if (url.endsWith('/download')) return { ok: true, text: async () => csv };
    sondeos++;
    return { ok: true, json: async () => ({ status: sondeos < 2 ? 'working' : 'ok' }) };
  };
  const r = await buscarGmaps({ query: 'contractors', location: 'Bronx, NY' }, { base: 'http://s', fetch, esperar: async () => {} });
  assert.equal(r.leads.length, 1);
  assert.equal(r.leads[0].internalOnly, true);

  const falla = async (url, opt = {}) => opt.method === 'POST'
    ? { ok: true, json: async () => ({ id: 'j2' }) }
    : { ok: true, json: async () => ({ status: 'failed' }) };
  await assert.rejects(buscarGmaps({ query: 'x plumbers' }, { base: 'http://s', fetch: falla, esperar: async () => {} }), /fallido/);
});

test('web solo http(s): javascript: y basura se descartan', async () => {
  const { webSegura } = await import('./common.js');
  assert.equal(webSegura('https://a.example/x'), 'https://a.example/x');
  assert.equal(webSegura('javascript:alert(1)'), null);
  assert.equal(webSegura(' JaVaScRiPt:alert(1)'), null);
  assert.equal(webSegura('data:text/html,hi'), null);
  const r = leadsDesdeGmaps([{ title: 'X', phone: '+1 718-555-0172', website: 'javascript:alert(document.cookie)' }]);
  assert.equal(r.leads[0].website, null);
});
