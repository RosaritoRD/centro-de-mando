import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizaNicho, preparaLeads } from './lead-tool.js';

test('el nicho se normaliza a snake_case sin acentos', () => {
  assert.equal(normalizaNicho('Dental Clinic'), 'dental_clinic');
  assert.equal(normalizaNicho('Clínicas dentales'), 'clinicas_dentales');
  assert.equal(normalizaNicho('  dental_clinic '), 'dental_clinic');
});

test('los leads del agente salen listos para guardarLeads', () => {
  const p = preparaLeads({
    niche: 'dental_clinic', runId: 'r1',
    leads: [
      { name: 'Hudson Family Dental', phone: '(201) 555-0100', website: 'hudsonfamilydentalnj.com',
        address: '42 Central Ave, 07306', city: 'Jersey City', state: 'nj' },
      { name: 'Sin teléfono', phone: 'n/a' },
      { name: 'Duplicado', phone: '201-555-0100' }
    ]
  });
  assert.equal(p.nicho, 'dental_clinic');
  assert.equal(p.leads.length, 1);
  assert.equal(p.invalid, 1);
  const l = p.leads[0];
  assert.equal(l.phoneE164, '+12015550100');
  assert.equal(l.website, 'https://hudsonfamilydentalnj.com');
  assert.equal(l.zip, '07306');
  assert.equal(l.state, 'NJ');
  assert.equal(l.boroughCity, 'Jersey City');
  assert.deepEqual(l.sourceIds, { apm_run: 'r1' });
});

test('una web con javascript: no entra', () => {
  const p = preparaLeads({ niche: 'x_y', leads: [{ name: 'A', phone: '2015550100', website: 'javascript:alert(1)' }] });
  assert.equal(p.leads[0].website, null);
});

test('un nicho vacío no guarda nada', () => {
  assert.ok(preparaLeads({ niche: '', leads: [] }).error);
});
