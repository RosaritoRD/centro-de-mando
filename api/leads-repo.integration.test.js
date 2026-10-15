/* SQL de prospección contra un Postgres DE VERDAD (desechable, con las
   migraciones 001-006). Se salta si no hay APM_TEST_DB_URL: nunca apunta a la
   BD real.

   Correr:
     docker run -d --rm --name apm-migr-test -e POSTGRES_USER=n8n -e POSTGRES_PASSWORD=x -e POSTGRES_DB=apm postgres:16-alpine
     (aplicar db/migrations/*.sql)
     APM_TEST_DB_URL=postgres://n8n:x@<ip>:5432/apm node --test leads-repo.integration.test.js  */

import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { crearRepoLeads } from './leads-repo.js';
import { reglasDeResultado } from './lead-queue.js';

const URL_BD = process.env.APM_TEST_DB_URL;
const opciones = { skip: !URL_BD && 'APM_TEST_DB_URL no definida' };
const T = `t_${Date.now()}`;
const NICHO = 'home_improvement_contractor';
const MEDIODIA = new Date('2026-09-24T16:00:00Z'); // 12:00 EDT

const lead = (tel, extra = {}) => ({
  businessName: `Negocio ${tel}`, phoneE164: tel, website: null, address: null, zip: '10469',
  boroughCity: 'Bronx', state: 'NY', sourceIds: { nyc_open_data: tel }, internalOnly: false, ...extra
});

test('repositorio de leads contra Postgres', opciones, async (t) => {
  const db = new pg.Pool({ connectionString: URL_BD, max: 3 });
  const repo = crearRepoLeads({ db });
  t.after(() => db.end());

  await t.test('importar y volver a importar une, no duplica', async () => {
    const r1 = await repo.guardarLeads({ tenant: T, niche: NICHO, source: 'nyc_open_data', leads: [lead('+13470000001'), lead('+13470000002')] });
    assert.deepEqual(r1, { inserted: 2, merged: 0, suppressed: 0 });
    const r2 = await repo.guardarLeads({ tenant: T, niche: NICHO, source: 'google_maps',
      leads: [lead('+13470000001', { website: 'https://a.example', internalOnly: true, sourceIds: { google_maps: 'L1' } })] });
    assert.deepEqual(r2, { inserted: 0, merged: 1, suppressed: 0 });
    const { leads } = await repo.listarLeads({ tenant: T, q: '0000001' });
    assert.equal(leads.length, 1);
    assert.deepEqual([...leads[0].sources].sort(), ['google_maps', 'nyc_open_data']);
    assert.equal(leads[0].website, 'https://a.example');
    assert.equal(leads[0].internal_only, false, 'si una fuente es legítima, el lead no es solo interno');
    assert.deepEqual(leads[0].source_ids, { nyc_open_data: '+13470000001', google_maps: 'L1' });
  });

  await t.test('siguiente lead se reserva: dos pestañas no reciben el mismo', async () => {
    const a = await repo.siguienteLead({ tenant: T, niche: NICHO, ahora: MEDIODIA });
    const b = await repo.siguienteLead({ tenant: T, niche: NICHO, ahora: MEDIODIA });
    assert.ok(a.lead && b.lead);
    assert.notEqual(a.lead.id, b.lead.id);
    const c = await repo.siguienteLead({ tenant: T, niche: NICHO, ahora: MEDIODIA });
    assert.equal(c.lead, null);
    assert.equal(c.reason, 'empty');
  });

  await t.test('fuera de horario (22:00 NY) no ofrece leads y dice cuándo abre', async () => {
    const noche = new Date('2026-09-25T02:30:00Z');
    const r = await repo.siguienteLead({ tenant: T, niche: NICHO, ahora: noche });
    assert.equal(r.lead, null);
    assert.equal(r.reason, 'outside_hours');
    assert.equal(r.opensAt.toISOString(), '2026-09-25T12:00:00.000Z');
  });

  await t.test('"no llamar" suprime y el teléfono no vuelve aunque se reimporte', async () => {
    const { leads } = await repo.listarLeads({ tenant: T, q: '0000002' });
    const r = reglasDeResultado({ outcome: 'no_llamar', callAgain: true }, MEDIODIA);
    const res = await repo.registrarLlamada({ tenant: T, leadId: leads[0].id, r });
    assert.equal(res.leadStatus, 'descartado');
    const re = await repo.guardarLeads({ tenant: T, niche: NICHO, source: 'nyc_open_data', leads: [lead('+13470000002')] });
    assert.equal(re.suppressed, 1);
    assert.equal(re.merged + re.inserted, 0);
  });

  await t.test('llamar luego vuelve a la cola cuando vence; historial y corrección', async () => {
    const { leads } = await repo.listarLeads({ tenant: T, q: '0000001' });
    const id = leads[0].id;
    const r = reglasDeResultado({ outcome: 'interesado', callAgain: true, nextCallAt: '2026-09-25T15:00:00Z', notes: 'dueño el jueves' }, MEDIODIA);
    const primera = await repo.registrarLlamada({ tenant: T, leadId: id, r });
    const fix = reglasDeResultado({ outcome: 'llamar_luego', callAgain: true, nextCallAt: '2026-09-25T15:00:00Z' }, MEDIODIA);
    await repo.registrarLlamada({ tenant: T, leadId: id, r: fix, correctsId: primera.callId });
    const mala = await repo.registrarLlamada({ tenant: T, leadId: id, r: fix, correctsId: '00000000-0000-0000-0000-000000000000' });
    assert.deepEqual(mala, { error: 'bad_correction' });

    const antes = await repo.siguienteLead({ tenant: T, niche: NICHO, ahora: MEDIODIA });
    assert.equal(antes.lead, null);
    const despues = await repo.siguienteLead({ tenant: T, niche: NICHO, ahora: new Date('2026-09-25T15:30:00Z') });
    assert.equal(despues.lead?.id, id);

    const ficha = await repo.obtenerLead(T, id);
    assert.equal(ficha.history.length, 2);
    assert.equal(ficha.history.find((h) => h.outcome === 'interesado').notes, 'dueño el jueves');

    const filas = await repo.llamadasEntre({ tenant: T, desde: new Date('2026-09-01'), hasta: new Date('2026-10-01') });
    assert.equal(filas.length, 3);
  });

  await t.test('aislamiento por tenant', async () => {
    const otro = await repo.listarLeads({ tenant: `${T}_otro` });
    assert.equal(otro.total, 0);
    const r = await repo.siguienteLead({ tenant: `${T}_otro`, niche: NICHO, ahora: MEDIODIA });
    assert.equal(r.lead, null);
  });

  await t.test('límites de scraper: runs corriendo y del día', async () => {
    const id = await repo.crearRun({ tenant: T, source: 'google_maps', niche: NICHO, params: { query: 'x' } });
    assert.deepEqual(await repo.contarRuns({ tenant: T, source: 'google_maps' }), { corriendo: 1, hoy: 1 });
    await repo.terminarRun(id, { status: 'done', found: 3, inserted: 2 });
    assert.deepEqual(await repo.contarRuns({ tenant: T, source: 'google_maps' }), { corriendo: 0, hoy: 1 });
    assert.equal((await repo.obtenerRun(T, id)).inserted, 2);
  });

  await t.test('límite atómico: 5 peticiones simultáneas → solo 1 búsqueda lanzada', async () => {
    const { comprobarLimites } = await import('./sources/google-maps.js');
    const T2 = `${T}_lim`;
    const res = await Promise.all(Array.from({ length: 5 }, () =>
      repo.crearRunConLimite({ tenant: T2, source: 'google_maps', niche: NICHO, params: {}, comprobar: comprobarLimites })));
    assert.equal(res.filter((r) => r.id).length, 1);
    assert.equal(res.filter((r) => r.bloqueo?.status === 409).length, 4);
  });

  await t.test('guiones: guardar sobreescribe por nicho', async () => {
    await repo.guardarGuion({ tenant: T, niche: 'locksmith', title: 'v1', body: 'a' });
    const g = await repo.guardarGuion({ tenant: T, niche: 'locksmith', title: 'v2', body: 'b' });
    assert.equal(g.title, 'v2');
    assert.equal((await repo.guiones(T)).length, 1);
  });
});
