/* The /try demo text to send after a call (12/10/2026).
   Run:  node --test web/src/demo-texto.test.js */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enlaceDemo, textoDemo, oficioDeNicho, esSalud } from './demo-texto.js';

const BRONX = { businessName: 'Demo Construction INC.', niche: 'home_improvement_contractor', boroughCity: 'Bronx', state: 'NY' };

test('the link opens /try with that business\'s name, trade and area', () => {
  assert.equal(enlaceDemo(BRONX), 'https://your-domain.com/try?b=Demo+Construction+INC.&t=general&c=Bronx%2C+NY');
});

test('the /try trade comes from the APM niche (specific trades before "contractor")', () => {
  const casos = {
    plumbers: 'plumbing', plumbing: 'plumbing', roofing_contractor: 'roofing', electrical_contractor: 'electrical',
    electricians: 'electrical', hvac_contractor: 'hvac', heating_and_air_conditioning: 'hvac', handyman: 'handyman',
    painters: 'painting', locksmith: 'locksmith', landscaping: 'landscaping', cleaning_services: 'cleaning',
    pest_control: 'pest', movers: 'moving', general_contractor: 'general', home_improvement_contractor: 'general',
    firewood_delivery: 'other', '': 'other'
  };
  for (const [nicho, oficio] of Object.entries(casos)) assert.equal(oficioDeNicho(nicho), oficio, nicho);
});

test('long names and areas are trimmed like on /try; no city means no area', () => {
  const u = new URL(enlaceDemo({ businessName: 'A'.repeat(80), niche: 'plumbers', boroughCity: 'B'.repeat(50), state: 'NJ' }));
  assert.equal(u.searchParams.get('b').length, 60);
  assert.equal(u.searchParams.get('c').length, 40);
  const sin = new URL(enlaceDemo({ businessName: 'Solo Nombre', niche: 'plumbers' }));
  assert.equal(sin.searchParams.has('c'), false);
});

test('English text: that business\'s link, no sign-up, and no SMS', () => {
  const t = textoDemo(BRONX, 'en');
  assert.ok(t.includes(enlaceDemo(BRONX)));
  assert.match(t, /no sign-up/);
  assert.doesNotMatch(t, /text you|sms/i);
});

test('Spanish text: honest that the page is in English and the voice answers in Spanish', () => {
  const t = textoDemo(BRONX, 'es');
  assert.ok(t.includes(enlaceDemo(BRONX)));
  assert.match(t, /en español/);
  assert.doesNotMatch(t, /lang=es/, 'the /try pages have no Spanish version yet');
});

test('clinics get no demo (HIPAA)', () => {
  assert.equal(esSalud('dental_clinic'), true);
  assert.equal(esSalud('medical_office'), true);
  assert.equal(esSalud('home_improvement_contractor'), false);
  assert.equal(esSalud(undefined), false);
});
