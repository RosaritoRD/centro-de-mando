import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizaNicho, preparaLeads } from './lead-tool.js';

test('the niche is normalized to snake_case without accents', () => {
  assert.equal(normalizaNicho('Dental Clinic'), 'dental_clinic');
  assert.equal(normalizaNicho('Clínicas dentales'), 'clinicas_dentales');
  assert.equal(normalizaNicho('  dental_clinic '), 'dental_clinic');
});

test('the agent leads come out ready for guardarLeads', () => {
  const p = preparaLeads({
    niche: 'dental_clinic', runId: 'r1',
    leads: [
      { name: 'Hudson Family Dental', phone: '(201) 555-0100', website: 'hudsonfamilydentalnj.com',
        address: '42 Central Ave, 07306', city: 'Jersey City', state: 'nj' },
      { name: 'No phone', phone: 'n/a' },
      { name: 'Duplicate', phone: '201-555-0100' }
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

test('a javascript: website is rejected', () => {
  const p = preparaLeads({ niche: 'x_y', leads: [{ name: 'A', phone: '2015550100', website: 'javascript:alert(1)' }] });
  assert.equal(p.leads[0].website, null);
});

test('an empty niche saves nothing', () => {
  assert.ok(preparaLeads({ niche: '', leads: [] }).error);
});
