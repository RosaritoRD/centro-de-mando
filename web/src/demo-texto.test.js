/* Texto con la demo de /try para mandar después de una llamada (12/10/2026).
   Correr:  node --test web/src/demo-texto.test.js */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enlaceDemo, textoDemo, oficioDeNicho, esSalud } from './demo-texto.js';

const BRONX = { businessName: 'Prueba Construction INC.', niche: 'home_improvement_contractor', boroughCity: 'Bronx', state: 'NY' };

test('el enlace abre /try con el nombre, el oficio y la zona de ese negocio', () => {
  assert.equal(enlaceDemo(BRONX), 'https://tu-dominio.com/try?b=Prueba+Construction+INC.&t=general&c=Bronx%2C+NY');
});

test('el oficio de /try sale del nicho de APM (los específicos antes que "contratista")', () => {
  const casos = {
    plumbers: 'plumbing', plumbing: 'plumbing', roofing_contractor: 'roofing', electrical_contractor: 'electrical',
    electricians: 'electrical', hvac_contractor: 'hvac', heating_and_air_conditioning: 'hvac', handyman: 'handyman',
    painters: 'painting', locksmith: 'locksmith', landscaping: 'landscaping', cleaning_services: 'cleaning',
    pest_control: 'pest', movers: 'moving', general_contractor: 'general', home_improvement_contractor: 'general',
    firewood_delivery: 'other', '': 'other'
  };
  for (const [nicho, oficio] of Object.entries(casos)) assert.equal(oficioDeNicho(nicho), oficio, nicho);
});

test('nombres y zonas largas se recortan como en /try; sin ciudad no se manda zona', () => {
  const u = new URL(enlaceDemo({ businessName: 'A'.repeat(80), niche: 'plumbers', boroughCity: 'B'.repeat(50), state: 'NJ' }));
  assert.equal(u.searchParams.get('b').length, 60);
  assert.equal(u.searchParams.get('c').length, 40);
  const sin = new URL(enlaceDemo({ businessName: 'Solo Nombre', niche: 'plumbers' }));
  assert.equal(sin.searchParams.has('c'), false);
});

test('texto en inglés: el enlace de ese negocio, sin registrarse, y nada de SMS', () => {
  const t = textoDemo(BRONX, 'en');
  assert.ok(t.includes(enlaceDemo(BRONX)));
  assert.match(t, /no sign-up/);
  assert.doesNotMatch(t, /text you|sms/i);
});

test('texto en español: honesto con que la página está en inglés y la voz contesta en español', () => {
  const t = textoDemo(BRONX, 'es');
  assert.ok(t.includes(enlaceDemo(BRONX)));
  assert.match(t, /en español/);
  assert.doesNotMatch(t, /lang=es/, 'las páginas de /try aún no tienen versión en español');
});

test('las clínicas no reciben demo (HIPAA)', () => {
  assert.equal(esSalud('dental_clinic'), true);
  assert.equal(esSalud('medical_office'), true);
  assert.equal(esSalud('home_improvement_contractor'), false);
  assert.equal(esSalud(undefined), false);
});
