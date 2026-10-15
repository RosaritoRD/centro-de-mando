/* Fuente NYC Open Data — DCWP "Legally Operating Businesses" (w7w3-xahh).

   Pública, gratis y sin clave (Socrata). Verificada el 17/09/2026: 13.385
   Home Improvement Contractors activos con teléfono. Es la fuente principal:
   legal, sin scraping y vendible a clientes (internal_only = false).

   Las categorías van en lista blanca: el valor acaba dentro de una cláusula
   SoQL y así no hay forma de colar nada aunque el escape fallara. */

import { nombreBonito, normalizarLote } from './common.js';

const BASE = 'https://data.cityofnewyork.us/resource/w7w3-xahh.json';
const LIMITE = 5000;

export const CATEGORIAS_NYC = [
  'Home Improvement Contractor', 'Locksmith', 'Garage and Parking Lot',
  'Electronic & Home Appliance Service Dealer', 'Laundries', 'Tow Truck Company'
];
export const BARRIOS_NYC = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'];

const soql = (v) => `'${String(v).replace(/'/g, "''")}'`;

export function urlNyc({ category, borough, zip } = {}) {
  const filtros = [
    "license_status='Active'",
    `business_category=${soql(category)}`,
    'contact_phone IS NOT NULL'
  ];
  if (borough) filtros.push(`address_borough=${soql(borough)}`);
  if (zip) filtros.push(`address_zip=${soql(String(zip).replace(/\D/g, '').slice(0, 5))}`);
  const u = new URL(BASE);
  u.searchParams.set('$where', filtros.join(' AND '));
  u.searchParams.set('$order', 'license_creation_date DESC');
  u.searchParams.set('$limit', String(LIMITE));
  return u.toString();
}

export async function buscarNyc(params = {}, { fetch = globalThis.fetch } = {}) {
  if (!CATEGORIAS_NYC.includes(params.category)) throw new Error(`categoría no permitida: ${params.category}`);
  if (params.borough && !BARRIOS_NYC.includes(params.borough)) throw new Error(`barrio no válido: ${params.borough}`);
  const r = await fetch(urlNyc(params), { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`NYC Open Data respondió ${r.status}`);
  const filas = await r.json();
  if (!Array.isArray(filas)) throw new Error('NYC Open Data devolvió algo que no es una lista');
  return normalizarLote(filas, (f) => ({
    businessName: nombreBonito(f.business_name),
    phone: f.contact_phone,
    website: null,
    address: [f.address_building, f.address_street_name].filter(Boolean).join(' ') || null,
    zip: f.address_zip || null,
    boroughCity: f.address_borough || nombreBonito(f.address_city) || null,
    state: f.address_state || 'NY',
    sourceIds: { nyc_open_data: f.license_nbr },
    internalOnly: false
  }));
}
