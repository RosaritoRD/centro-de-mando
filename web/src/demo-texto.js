/* The /try demo text the owner sends after a call (12/10/2026).

   Only when the person says yes (TCPA): that's why these are copy buttons and
   not a send. The link opens the your-domain.com/try demo with THAT business's
   name, trade and area, and the receptionist answers "Thanks for calling
   <their business>". The /try pages are in English: the Spanish text says so
   and mentions that the voice answers in Spanish if spoken to in Spanish.
   (The message texts themselves are customer-facing content, in both languages.)

   Clinics get no demo: their calls are health data (HIPAA) and today there's
   no BAA with the voice providers. */

const DOMINIO = 'https://your-domain.com';

/* APM niche → "What you do" option on /try. Specific trades go before
   "contractor": a roofing_contractor is roofing, not general. */
const OFICIOS = [
  [/plumb/, 'plumbing'],
  [/electric/, 'electrical'],
  [/hvac|heating|air_cond|cooling/, 'hvac'],
  [/roof/, 'roofing'],
  [/handyman/, 'handyman'],
  [/paint/, 'painting'],
  [/locksmith/, 'locksmith'],
  [/landscap|lawn/, 'landscaping'],
  [/clean|maid|janitor/, 'cleaning'],
  [/pest|extermin/, 'pest'],
  [/^mov(ing|ers?)(_|$)/, 'moving'],
  [/contractor|construction|remodel|renovat|builder|home_improvement/, 'general']
];

export function oficioDeNicho(niche) {
  const n = String(niche || '').toLowerCase();
  const hallado = OFICIOS.find(([re]) => re.test(n));
  return hallado ? hallado[1] : 'other';
}

export const esSalud = (niche) => /dental|dentist|medic|clinic|doctor|health|chiro|therap/.test(String(niche || '').toLowerCase());

export function enlaceDemo(lead) {
  const q = new URLSearchParams();
  q.set('b', String(lead.businessName || '').trim().slice(0, 60));
  q.set('t', oficioDeNicho(lead.niche));
  const zona = [lead.boroughCity, lead.state].filter(Boolean).join(', ').slice(0, 40);
  if (lead.boroughCity && zona) q.set('c', zona);
  return `${DOMINIO}/try?${q}`;
}

export function textoDemo(lead, idioma = 'en') {
  const url = enlaceDemo(lead);
  if (idioma === 'es') {
    return 'Hola, soy Alex de Acme. Aquí está la demo que le comenté: contesta con el nombre de su negocio y, '
      + `si usted le habla en español, le contesta en español. Son 3 minutos y no hay que registrarse: ${url}`;
  }
  return `Hi, it's Alex from Acme. Here's the demo I mentioned. It answers with your business name. Takes 3 minutes, no sign-up: ${url}`;
}
