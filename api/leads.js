/* tu empresa — APM · prospección por llamadas (Fase 3).

   Spec: .planning/specs/apm-prospeccion-llamadas.md
   - Leads de NYC Open Data (principal, legal) y Google Maps (suave, solo interno).
   - Marca SIEMPRE el dueño desde su teléfono: aquí no hay marcador ni voz de IA (TCPA).
   - Cada llamada = una fila append-only con resultado, nota y si volver a llamar.

   Dependencias inyectadas (repo, fuentes, reloj) para probar las rutas sin BD
   ni red. `tenant` es fijo mientras APM sea de un solo usuario; es el hueco
   para la versión para clientes. */

import { Router } from 'express';
import { reglasDeResultado } from './lead-queue.js';
import { semanaIso, rangoSemana, scoreboard } from './scoreboard.js';
import { telefonoVisible } from './phone.js';
import { comprobarLimites } from './sources/google-maps.js';
import { CATEGORIAS_NYC, BARRIOS_NYC } from './sources/nyc-open-data.js';

const TENANT = 'principal';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NICHO = /^[a-z0-9_]{2,60}$/;
const ESTADOS = ['nuevo', 'llamado', 'interesado', 'demo', 'cliente', 'descartado'];
const FUENTES = ['nyc_open_data', 'google_maps', 'manual'];

const mal = (res, status, code, message) => res.status(status).json({ error: { code, message } });

function falloInterno(res, donde, e) {
  console.error(`leads ${donde}:`, e.message);
  return mal(res, 500, 'db_error', 'error interno');
}

/* CSV que abre bien en Excel/Sheets y no ejecuta fórmulas (=, +, -, @). */
function celda(v) {
  let s = v == null ? '' : String(v);
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function leadPublico(l) {
  return {
    id: l.id, businessName: l.business_name, phone: l.phone_e164, phoneDisplay: telefonoVisible(l.phone_e164),
    website: l.website, address: l.address, zip: l.zip, boroughCity: l.borough_city, state: l.state,
    niche: l.niche, sources: l.sources, internalOnly: l.internal_only, status: l.status,
    nextCallAt: l.next_call_at, updatedAt: l.updated_at,
    history: l.history?.map((h) => ({
      id: h.id, outcome: h.outcome, notes: h.notes, callAgain: h.call_again,
      nextCallAt: h.next_call_at, correctsId: h.corrects_id, createdAt: h.created_at
    }))
  };
}

function runPublico(r) {
  return {
    id: r.id, source: r.source, niche: r.niche, params: r.params, status: r.status, found: r.found,
    inserted: r.inserted, merged: r.merged, suppressed: r.suppressed, invalid: r.invalid,
    error: r.error, startedAt: r.started_at, endedAt: r.ended_at
  };
}

export function rutasLeads(auth, { repo, fuentes, ahora = () => new Date() }) {
  const r = Router();

  /* Importar: 202 y se trabaja en segundo plano. La respuesta no espera al
     scraper (tarda minutos); la UI sondea /api/leads/import/:id. */
  r.post('/api/leads/import', auth, async (req, res) => {
    const { source, niche, params = {} } = req.body || {};
    if (!['nyc_open_data', 'google_maps'].includes(source)) return mal(res, 400, 'bad_source', 'fuente no válida');
    if (!NICHO.test(String(niche || ''))) return mal(res, 400, 'bad_niche', 'nicho no válido (a-z, 0-9, _)');
    let buscar;
    if (source === 'nyc_open_data') {
      if (!CATEGORIAS_NYC.includes(params.category)) return mal(res, 400, 'bad_category', 'categoría no permitida');
      if (params.borough && !BARRIOS_NYC.includes(params.borough)) return mal(res, 400, 'bad_borough', 'barrio no válido');
      const p = { category: params.category, borough: params.borough || null, zip: params.zip || null };
      buscar = () => fuentes.nyc(p);
    } else {
      const query = String(params.query || '').trim();
      const location = String(params.location || '').trim();
      if (query.length < 2 || query.length > 60 || location.length > 60) return mal(res, 400, 'bad_query', 'búsqueda o zona no válidas');
      buscar = () => fuentes.gmaps({ query, location, limit: Number(params.limit) || 100 });
    }
    let runId;
    try {
      if (source === 'google_maps') {
        // Comprobación y alta en la misma transacción (ver crearRunConLimite).
        const out = await repo.crearRunConLimite({ tenant: TENANT, source, niche, params, comprobar: comprobarLimites });
        if (out.bloqueo) return mal(res, out.bloqueo.status, out.bloqueo.code, out.bloqueo.message);
        runId = out.id;
      } else {
        runId = await repo.crearRun({ tenant: TENANT, source, niche, params });
      }
    } catch (e) { return falloInterno(res, 'import', e); }
    res.status(202).json({ runId, status: 'running' });

    try {
      const lote = await buscar();
      const g = await repo.guardarLeads({ tenant: TENANT, niche, source, leads: lote.leads });
      await repo.terminarRun(runId, { status: 'done', found: lote.found, invalid: lote.invalid, ...g });
    } catch (e) {
      console.error(`leads import ${source}:`, e.message);
      await repo.terminarRun(runId, { status: 'failed', error: String(e.message).slice(0, 300) })
        .catch((e2) => console.error('leads import terminarRun:', e2.message));
    }
  });

  r.get('/api/leads/import/:id', auth, async (req, res) => {
    if (!UUID.test(req.params.id)) return mal(res, 400, 'bad_id', 'id no válido');
    try {
      const run = await repo.obtenerRun(TENANT, req.params.id);
      return run ? res.json(runPublico(run)) : mal(res, 404, 'not_found', 'no existe');
    } catch (e) { return falloInterno(res, 'run', e); }
  });

  r.get('/api/leads/runs', auth, async (_req, res) => {
    try {
      const [runs, limites] = await Promise.all([
        repo.ultimosRuns(TENANT, 10), repo.contarRuns({ tenant: TENANT, source: 'google_maps' })]);
      res.json({ runs: runs.map(runPublico), gmapsToday: limites.hoy, categories: CATEGORIAS_NYC, boroughs: BARRIOS_NYC });
    } catch (e) { return falloInterno(res, 'runs', e); }
  });

  r.get('/api/leads/niches', auth, async (_req, res) => {
    try { res.json({ niches: await repo.nichos(TENANT) }); } catch (e) { return falloInterno(res, 'niches', e); }
  });

  /* El siguiente a llamar + su guion + cuántos quedan. */
  r.get('/api/leads/next', auth, async (req, res) => {
    const niche = String(req.query.niche || '');
    if (!NICHO.test(niche)) return mal(res, 400, 'bad_niche', 'nicho no válido');
    try {
      const t = ahora();
      const [sig, guion, cola] = await Promise.all([
        repo.siguienteLead({ tenant: TENANT, niche, ahora: t }),
        repo.guion(TENANT, niche),
        repo.resumenCola({ tenant: TENANT, niche, ahora: t })
      ]);
      const lead = sig.lead ? await repo.obtenerLead(TENANT, sig.lead.id) : null;
      res.json({
        lead: lead ? leadPublico(lead) : null, reason: sig.reason, opensAt: sig.opensAt || null,
        script: guion ? { title: guion.title, body: guion.body } : null, queue: cola
      });
    } catch (e) { return falloInterno(res, 'next', e); }
  });

  r.post('/api/leads/:id/calls', auth, async (req, res) => {
    if (!UUID.test(req.params.id)) return mal(res, 400, 'bad_id', 'id no válido');
    const correctsId = req.body?.correctsId || null;
    if (correctsId && !UUID.test(correctsId)) return mal(res, 400, 'bad_id', 'corrección no válida');
    const reglas = reglasDeResultado(req.body || {}, ahora());
    if (!reglas.ok) return mal(res, 400, reglas.code, reglas.message);
    try {
      const out = await repo.registrarLlamada({ tenant: TENANT, leadId: req.params.id, r: reglas, correctsId });
      if (!out) return mal(res, 404, 'not_found', 'lead no encontrado');
      if (out.error) return mal(res, 400, out.error, 'la llamada a corregir no es de este lead');
      return res.status(201).json(out);
    } catch (e) { return falloInterno(res, 'call', e); }
  });

  r.get('/api/leads/:id', auth, async (req, res) => {
    if (!UUID.test(req.params.id)) return mal(res, 400, 'bad_id', 'id no válido');
    try {
      const l = await repo.obtenerLead(TENANT, req.params.id);
      return l ? res.json(leadPublico(l)) : mal(res, 404, 'not_found', 'no existe');
    } catch (e) { return falloInterno(res, 'lead', e); }
  });

  r.get('/api/leads', auth, async (req, res) => {
    const { niche, status, source, q, format } = req.query;
    if (niche && !NICHO.test(niche)) return mal(res, 400, 'bad_niche', 'nicho no válido');
    if (status && !ESTADOS.includes(status)) return mal(res, 400, 'bad_status', 'estado no válido');
    if (source && !FUENTES.includes(source)) return mal(res, 400, 'bad_source', 'fuente no válida');
    const csv = format === 'csv';
    const limit = csv ? 5000 : Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = csv ? 0 : Math.max(Number(req.query.offset) || 0, 0);
    try {
      const out = await repo.listarLeads({ tenant: TENANT, niche, status, source, q: q ? String(q).slice(0, 80) : null, limit, offset });
      if (!csv) return res.json({ total: out.total, leads: out.leads.map(leadPublico) });
      const cols = ['business_name', 'phone', 'borough_city', 'zip', 'website', 'niche', 'status', 'next_call_at', 'sources'];
      const filas = out.leads.map((l) => [l.business_name, telefonoVisible(l.phone_e164), l.borough_city, l.zip, l.website,
        l.niche, l.status, l.next_call_at?.toISOString?.() || l.next_call_at, (l.sources || []).join('|')].map(celda).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
      return res.send(`﻿${cols.join(',')}\n${filas.join('\n')}`);
    } catch (e) { return falloInterno(res, 'list', e); }
  });

  r.get('/api/scoreboard', auth, async (req, res) => {
    const semana = req.query.week ? String(req.query.week) : semanaIso(ahora());
    const rango = rangoSemana(semana);
    if (!rango) return mal(res, 400, 'bad_week', 'semana no válida (AAAA-Www)');
    const previo = { desde: new Date(rango.desde.getTime() - 7 * 86400000), hasta: rango.desde };
    try {
      const [actual, anterior] = await Promise.all([
        repo.llamadasEntre({ tenant: TENANT, ...rango }), repo.llamadasEntre({ tenant: TENANT, ...previo })]);
      res.json({ week: semana, ...scoreboard(actual), previous: scoreboard(anterior) });
    } catch (e) { return falloInterno(res, 'scoreboard', e); }
  });

  r.get('/api/scripts', auth, async (_req, res) => {
    try { res.json({ scripts: await repo.guiones(TENANT) }); } catch (e) { return falloInterno(res, 'scripts', e); }
  });

  r.put('/api/scripts/:niche', auth, async (req, res) => {
    const niche = req.params.niche;
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!NICHO.test(niche)) return mal(res, 400, 'bad_niche', 'nicho no válido');
    if (!title || title.length > 120 || !body || body.length > 20000) return mal(res, 400, 'bad_script', 'título o guion vacíos o demasiado largos');
    try { res.json(await repo.guardarGuion({ tenant: TENANT, niche, title, body })); } catch (e) { return falloInterno(res, 'script', e); }
  });

  return r;
}
