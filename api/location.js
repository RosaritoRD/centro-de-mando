/* tu empresa — APM · ubicación de la consulta y de los leads.

   Dos ubicaciones y no una, porque son dos preguntas distintas:

   - `base`   → desde dónde se consulta. Es el contexto de quien pregunta:
                huso horario, mercado, qué leyes aplican.
   - `target` → dónde hay que buscar los clientes potenciales. Puede estar a
                mil kilómetros de la base y muchas veces lo está.

   Sin esto, un "búscame DSPs" devuelve lo que el modelo suponga — y lo que
   supone es California o Londres. El coste de equivocarse no es un error:
   es una lista de leads inútil que parece buena.

   Este archivo no toca la base de datos ni Express a propósito: es lógica
   pura para poder probarla con `node --test` sin levantar nada. */

/* Alfa-2 de ISO 3166-1. Se valida la FORMA, no la existencia del país: la
   lista viva está en el navegador (web/src/paises.js, generada del
   /usr/share/zoneinfo/iso3166.tab del sistema) y duplicar aquí 250 códigos
   sería garantizar que un día las dos listas no coincidan. Un código con
   forma válida pero inexistente no rompe nada: viaja al prompt como texto. */
const ALFA2 = /^[A-Za-z]{2}$/;

/* Las ciudades se escriben a mano ("Bronx, NY" o "Newark"), así que el tope
   es generoso pero existe: sin él, el campo es una vía para inyectar 20 KB
   de texto en el system prompt de cada ejecución. */
const MAX_CIUDAD = 80;

function limpiar(v) {
  if (typeof v !== 'string') return null;
  /* Los saltos de línea se aplastan: el valor termina en una frase del
     system prompt, y un "\n\nOlvida lo anterior" escrito en el campo ciudad
     no debe poder empezar una línea nueva ahí dentro. */
  const s = v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_CIUDAD);
  return s || null;
}

function pais(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return ALFA2.test(s) ? s.toUpperCase() : null;
}

/* Deja siempre las cuatro claves, con null donde no hay dato. Un objeto con
   forma constante ahorra comprobaciones en la ruta, en la UI y en el SQL. */
export function normalizarUbicacion(entrada) {
  const e = entrada || {};
  const b = e.base || {};
  const t = e.target || {};
  return {
    base:   { city: limpiar(b.city),   country: pais(b.country) },
    target: { city: limpiar(t.city),   country: pais(t.country) }
  };
}

export function ubicacionVacia(u) {
  return !u || (!u.base.city && !u.base.country && !u.target.city && !u.target.country);
}

/* La ubicación efectiva de una ejecución: lo que mandó el chat, y lo que no
   venga, lo guardado como predeterminado.

   ⚠️ El destino cae en la base cuando está vacío, y no al revés. "Busca
   leads" sin decir dónde significa "donde estoy"; "estoy" sin decir dónde no
   significa "donde busco" — un contable en Nueva York que busca clientes en
   Miami no está en Miami. */
export function ubicacionEfectiva(delChat, guardada) {
  const a = normalizarUbicacion(delChat);
  const b = normalizarUbicacion(guardada);
  const base = {
    city: a.base.city || b.base.city,
    country: a.base.country || b.base.country
  };
  const target = {
    city: a.target.city || b.target.city || base.city,
    country: a.target.country || b.target.country || base.country
  };
  return { base, target };
}

/* Nombre del país en español a partir del código. Node trae ICU completo
   (verificado en el contenedor: 'DO' → 'República Dominicana'), pero si un
   día se compila sin él, esto devuelve el código en vez de reventar el
   arranque de una ejecución. */
export function nombrePais(codigo) {
  if (!codigo) return null;
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' }).of(codigo) || codigo;
  } catch {
    return codigo;
  }
}

export function comoTexto(sitio) {
  if (!sitio || (!sitio.city && !sitio.country)) return null;
  const p = nombrePais(sitio.country);
  if (sitio.city && p) return `${sitio.city} (${p})`;
  return sitio.city || p;
}

/* Las frases que se le añaden al system prompt. Solo se dice lo que se sabe:
   una línea "busca en null" es peor que no decir nada, porque el modelo la
   obedece igual. */
export function lineasDeUbicacion(u) {
  const base = comoTexto(u.base);
  const target = comoTexto(u.target);
  const l = [];
  if (base) l.push(`el dueño te consulta desde ${base}: esa es su zona horaria y su mercado.`);
  if (target) {
    l.push(`Cuando busques clientes potenciales, negocios, competencia o precios,`
      + ` céntrate en ${target}.`);
    /* La instrucción que evita el fallo caro: una lista de leads de otra
       ciudad no se distingue de una buena hasta que se llama por teléfono. */
    l.push('Si no puedes acotar una búsqueda a esa zona, dilo en la respuesta en vez de'
      + ' devolver resultados de otro sitio como si valieran.');
  }
  return l;
}

/* De columnas de `run` al objeto, y al revés. Las dos direcciones viven
   juntas para que añadir un campo no se olvide en una de las dos. */
export function desdeFilaRun(row) {
  return normalizarUbicacion({
    base:   { city: row?.base_city,   country: row?.base_country },
    target: { city: row?.target_city, country: row?.target_country }
  });
}

export function aColumnas(u) {
  return [u.base.city, u.base.country, u.target.city, u.target.country];
}
