/* Acme — APM · where queries come from and where leads are searched.

   Two locations, not one, because they're two different questions:

   - `base`   → where you're asking from. The asker's context: time zone,
                market, which laws apply.
   - `target` → where to look for prospects. It can be a thousand kilometers
                from the base, and often is.

   Without this, "find me DSPs" returns whatever the model assumes — and it
   assumes California or London. The cost of getting it wrong isn't an error:
   it's a useless lead list that looks good.

   This file deliberately doesn't touch the database or Express: it's pure
   logic so it can be tested with `node --test` without starting anything. */

/* ISO 3166-1 alpha-2. The SHAPE is validated, not whether the country
   exists: the live list is in the browser (web/src/paises.js, generated from
   the system's /usr/share/zoneinfo/iso3166.tab), and duplicating 250 codes
   here would guarantee the two lists drift apart one day. A well-formed but
   nonexistent code breaks nothing: it travels into the prompt as text. */
const ALFA2 = /^[A-Za-z]{2}$/;

/* Cities are typed by hand ("Bronx, NY" or "Newark"), so the cap is generous
   but real: without it, the field is a way to inject 20 KB of text into every
   run's system prompt. */
const MAX_CIUDAD = 80;

function limpiar(v) {
  if (typeof v !== 'string') return null;
  /* Line breaks are flattened: the value ends up inside a system prompt
     sentence, and a "\n\nIgnore the above" typed into the city field must
     not be able to start a new line in there. */
  const s = v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_CIUDAD);
  return s || null;
}

function pais(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return ALFA2.test(s) ? s.toUpperCase() : null;
}

/* Always returns all four keys, with null where there's no data. An object
   with a constant shape saves checks in the route, the UI and the SQL. */
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

/* A run's effective location: whatever the chat sent, and for anything
   missing, the saved default.

   ⚠️ The target falls back to the base when empty, not the other way round.
   "Find leads" without saying where means "where I am"; "I am" without saying
   where doesn't mean "where I search" — an accountant in New York looking for
   clients in Miami isn't in Miami. */
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

/* Country name from its code, in English (the system prompt is English).
   Node ships full ICU (verified in the container: 'DO' → 'Dominican
   Republic'), but if it's ever built without it, this returns the code instead
   of crashing a run's startup. */
export function nombrePais(codigo) {
  if (!codigo) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(codigo) || codigo;
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

/* The sentences added to the system prompt. Only what's known is said: a
   "search in null" line is worse than saying nothing, because the model obeys
   it anyway. */
export function lineasDeUbicacion(u) {
  const base = comoTexto(u.base);
  const target = comoTexto(u.target);
  const l = [];
  if (base) l.push(`the owner is asking from ${base}: that is their time zone and market.`);
  if (target) {
    l.push(`When you look for prospects, businesses, competitors or prices,`
      + ` focus on ${target}.`);
    /* The instruction that prevents the expensive mistake: a lead list from
       another city looks just like a good one until you start calling. */
    l.push("If you can't narrow a search to that area, say so in your reply instead of"
      + ' returning results from somewhere else as if they counted.');
  }
  return l;
}

/* From `run` columns to the object, and back. Both directions live together
   so adding a field isn't forgotten in one of them. */
export function desdeFilaRun(row) {
  return normalizarUbicacion({
    base:   { city: row?.base_city,   country: row?.base_country },
    target: { city: row?.target_city, country: row?.target_country }
  });
}

export function aColumnas(u) {
  return [u.base.city, u.base.country, u.target.city, u.target.country];
}
