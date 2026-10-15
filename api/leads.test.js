/* Rutas de prospección con repo y fuentes falsos: validación, límites del
   scraper, reglas legales (no_llamar) y que un fallo de la fuente quede
   registrado como fallo.

   Correr:  node --test leads.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { rutasLeads } from './leads.js';

const ID = '11111111-1111-4111-8111-111111111111';
const AHORA = new Date('2026-09-24T16:00:00Z');

function repoFalso(sobre = {}) {
  const llamadas = [];
  const runs = new Map();
  return {
    llamadas, runs,
    contarRuns: async () => ({ corriendo: 0, hoy: 0 }),
    crearRunConLimite: async function (a) {
      const lim = a.comprobar(await this.contarRuns());
      if (!lim.ok) return { bloqueo: lim };
      return { id: await this.crearRun(a) };
    },
    crearRun: async (r) => { runs.set('run-1', { ...r, status: 'running' }); return 'run-1'; },
    terminarRun: async (id, r) => { runs.set(id, { ...runs.get(id), ...r }); },
    guardarLeads: async ({ leads }) => ({ inserted: leads.length, merged: 0, suppressed: 0 }),
    siguienteLead: async () => ({ lead: { id: ID }, reason: null }),
    obtenerLead: async (_t, id) => (id === ID ? { id, business_name: 'Prueba Co', phone_e164: '+17185550172', sources: ['nyc_open_data'], history: [] } : null),
    guion: async () => ({ title: 'Guion', body: 'Hola' }),
    resumenCola: async () => ({ due: 0, new: 5, scheduled: 1 }),
    registrarLlamada: async (a) => { llamadas.push(a); return { callId: 'c1', leadStatus: a.r.leadStatus }; },
    listarLeads: async () => ({ total: 1, leads: [{ id: ID, business_name: '=HYPERLINK("x")', phone_e164: '+17185550172', sources: ['nyc_open_data'] }] }),
    llamadasEntre: async ({ desde }) => (desde.toISOString().startsWith('2026-09-21')
      ? [{ id: 'a', outcome: 'interesado' }, { id: 'b', outcome: 'buzon' }] : [{ id: 'z', outcome: 'buzon' }]),
    guardarGuion: async (g) => g,
    ...sobre
  };
}

async function servidor(repo, fuentes = {}, autenticado = true) {
  const app = express();
  app.use(express.json());
  const auth = (_req, res, next) => (autenticado ? next() : res.status(401).json({ error: { code: 'no_session' } }));
  app.use(rutasLeads(auth, { repo, fuentes, ahora: () => AHORA }));
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const pedir = async (ruta, opt = {}) => {
    const r = await fetch(base + ruta, { ...opt, headers: { 'Content-Type': 'application/json' }, body: opt.body && JSON.stringify(opt.body) });
    const bytes = Buffer.from(await r.arrayBuffer());
    const texto = bytes.toString('utf8');
    let json = null;
    try { json = JSON.parse(texto); } catch { /* csv */ }
    return { status: r.status, json, texto, bytes, tipo: r.headers.get('content-type') };
  };
  return { pedir, cerrar: () => srv.close() };
}

const esperaFondo = () => new Promise((r) => setTimeout(r, 20));

test('sin sesión → 401 en todas las rutas', async (t) => {
  const s = await servidor(repoFalso(), {}, false);
  t.after(s.cerrar);
  for (const ruta of ['/api/leads', '/api/leads/next?niche=x_y', '/api/scoreboard', '/api/scripts']) {
    assert.equal((await s.pedir(ruta)).status, 401, ruta);
  }
});

test('importar NYC: valida, responde 202 y registra el resultado en segundo plano', async (t) => {
  const repo = repoFalso();
  const fuentes = { nyc: async (p) => ({ found: 2, invalid: 1, leads: [{ phoneE164: '+13470000001', businessName: 'A', category: p.category }] }) };
  const s = await servidor(repo, fuentes);
  t.after(s.cerrar);
  assert.equal((await s.pedir('/api/leads/import', { method: 'POST', body: { source: 'nyc_open_data', niche: 'home_improvement_contractor', params: { category: 'DROP' } } })).status, 400);
  assert.equal((await s.pedir('/api/leads/import', { method: 'POST', body: { source: 'nyc_open_data', niche: 'Mal Nicho!', params: {} } })).status, 400);
  const r = await s.pedir('/api/leads/import', { method: 'POST', body: { source: 'nyc_open_data', niche: 'home_improvement_contractor', params: { category: 'Home Improvement Contractor', borough: 'Bronx' } } });
  assert.equal(r.status, 202);
  await esperaFondo();
  assert.deepEqual(
    (({ status, found, invalid, inserted }) => ({ status, found, invalid, inserted }))(repo.runs.get('run-1')),
    { status: 'done', found: 2, invalid: 1, inserted: 1 });
});

test('fuente caída → run failed con el motivo, nunca "done" vacío', async (t) => {
  const repo = repoFalso();
  const s = await servidor(repo, { nyc: async () => { throw new Error('NYC Open Data respondió 503'); } });
  t.after(s.cerrar);
  await s.pedir('/api/leads/import', { method: 'POST', body: { source: 'nyc_open_data', niche: 'locksmith', params: { category: 'Locksmith' } } });
  await esperaFondo();
  assert.equal(repo.runs.get('run-1').status, 'failed');
  assert.match(repo.runs.get('run-1').error, /503/);
});

test('Google Maps: 409 si hay uno corriendo, 429 si ya van 3 hoy, 400 con búsqueda vacía', async (t) => {
  const s1 = await servidor(repoFalso({ contarRuns: async () => ({ corriendo: 1, hoy: 1 }) }), { gmaps: async () => ({ leads: [] }) });
  t.after(s1.cerrar);
  const body = { source: 'google_maps', niche: 'locksmith', params: { query: 'locksmith', location: 'Bronx, NY' } };
  assert.equal((await s1.pedir('/api/leads/import', { method: 'POST', body })).status, 409);
  const s2 = await servidor(repoFalso({ contarRuns: async () => ({ corriendo: 0, hoy: 3 }) }), { gmaps: async () => ({ leads: [] }) });
  t.after(s2.cerrar);
  assert.equal((await s2.pedir('/api/leads/import', { method: 'POST', body })).status, 429);
  assert.equal((await s2.pedir('/api/leads/import', { method: 'POST', body: { ...body, params: { query: '' } } })).status, 400);
});

test('next: lead + guion + cola, con teléfono para mostrar', async (t) => {
  const s = await servidor(repoFalso());
  t.after(s.cerrar);
  const r = await s.pedir('/api/leads/next?niche=home_improvement_contractor');
  assert.equal(r.status, 200);
  assert.equal(r.json.lead.phoneDisplay, '(718) 555-0172');
  assert.equal(r.json.script.body, 'Hola');
  assert.equal(r.json.queue.new, 5);
  assert.equal((await s.pedir('/api/leads/next?niche=..%2F')).status, 400);
});

test('registrar llamada: no_llamar ignora "volver a llamar" del cliente; validaciones', async (t) => {
  const repo = repoFalso();
  const s = await servidor(repo);
  t.after(s.cerrar);
  const r = await s.pedir(`/api/leads/${ID}/calls`, { method: 'POST', body: { outcome: 'no_llamar', callAgain: true, nextCallAt: '2026-10-01T15:00:00Z', notes: 'pidió que no' } });
  assert.equal(r.status, 201);
  assert.equal(repo.llamadas[0].r.callAgain, false);
  assert.equal(repo.llamadas[0].r.suppress, 'no_llamar');
  assert.equal((await s.pedir(`/api/leads/${ID}/calls`, { method: 'POST', body: { outcome: 'llamar_luego', callAgain: true } })).status, 400);
  assert.equal((await s.pedir(`/api/leads/${ID}/calls`, { method: 'POST', body: { outcome: 'inventado' } })).status, 400);
  assert.equal((await s.pedir('/api/leads/no-es-uuid/calls', { method: 'POST', body: { outcome: 'buzon' } })).status, 400);
});

test('CSV: cabecera, BOM y fórmulas neutralizadas', async (t) => {
  const s = await servidor(repoFalso());
  t.after(s.cerrar);
  const r = await s.pedir('/api/leads?format=csv');
  assert.match(r.tipo, /text\/csv/);
  assert.ok(r.texto.startsWith('﻿business_name,'));
  assert.match(r.texto, /"'=HYPERLINK\(""x""\)"/);
});

test('scoreboard de la semana actual y la anterior', async (t) => {
  const s = await servidor(repoFalso());
  t.after(s.cerrar);
  const r = await s.pedir('/api/scoreboard');
  assert.equal(r.json.week, '2026-W39');
  assert.equal(r.json.calls, 2);
  assert.equal(r.json.interested, 1);
  assert.equal(r.json.previous.calls, 1);
  assert.equal((await s.pedir('/api/scoreboard?week=hola')).status, 400);
});

test('guardar guion valida longitud', async (t) => {
  const s = await servidor(repoFalso());
  t.after(s.cerrar);
  assert.equal((await s.pedir('/api/scripts/locksmith', { method: 'PUT', body: { title: 'x', body: '' } })).status, 400);
  assert.equal((await s.pedir('/api/scripts/locksmith', { method: 'PUT', body: { title: 'Cerrajeros', body: 'Hola' } })).status, 200);
});
