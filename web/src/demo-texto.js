/* El texto con la demo de /try que el dueño manda después de una llamada (12/10/2026).

   Solo cuando la persona dice que sí (TCPA): por eso son botones de copiar y no
   un envío. El enlace abre la demo de tu-dominio.com/try con el nombre, el oficio
   y la zona de ESE negocio, y la recepcionista contesta "Thanks for calling
   <su negocio>". Las páginas de /try están en inglés: el texto en español lo dice
   y avisa de que la voz contesta en español si le hablan en español.

   Las clínicas no reciben demo: sus llamadas son datos de salud (HIPAA) y hoy no
   hay contrato BAA con los proveedores de voz. */

const DOMINIO = 'https://tu-dominio.com';

/* Nicho de APM → opción de "What you do" en /try. Los oficios concretos van
   antes que "contractor": un roofing_contractor es de techos, no general. */
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
    return 'Hola, soy el dueño de tu empresa Tech. Aquí está la demo que le comenté: contesta con el nombre de su negocio y, '
      + `si usted le habla en español, le contesta en español. Son 3 minutos y no hay que registrarse: ${url}`;
  }
  return `Hi, it's el dueño from tu empresa Tech. Here's the demo I mentioned. It answers with your business name. Takes 3 minutes, no sign-up: ${url}`;
}
