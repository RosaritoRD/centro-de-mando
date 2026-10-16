/* NYC Open Data source — DCWP "Legally Operating Businesses" (w7w3-xahh).

   Public, free and keyless (Socrata). Verified on 17/09/2026: 13,385 active
   Home Improvement Contractors with a phone number. It's the main source:
   legal, no scraping, and sellable to customers (internal_only = false).

   Categories are allowlisted: the value ends up inside a SoQL clause, so there's
   no way to sneak anything in even if escaping failed. */

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
  if (!CATEGORIAS_NYC.includes(params.category)) throw new Error(`category not allowed: ${params.category}`);
  if (params.borough && !BARRIOS_NYC.includes(params.borough)) throw new Error(`invalid borough: ${params.borough}`);
  const r = await fetch(urlNyc(params), { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`NYC Open Data answered ${r.status}`);
  const filas = await r.json();
  if (!Array.isArray(filas)) throw new Error('NYC Open Data returned something that is not a list');
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
