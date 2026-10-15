/* Hora local ↔ instante UTC, con dos pasadas para el cambio de hora.
   Sin dependencias: Intl basta y en la imagen ya está la base de zonas. */

export function partesLocales(fecha, zona) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(fecha);
  const n = (t) => Number(p.find((x) => x.type === t).value);
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour'), min: n('minute') };
}

/** Instante UTC de y-m-d h:min en `zona`. */
export function horaEnZona(y, m, d, h, min, zona) {
  const objetivo = Date.UTC(y, m - 1, d, h, min);
  let utc = objetivo;
  for (let i = 0; i < 2; i++) {
    const v = partesLocales(new Date(utc), zona);
    utc += objetivo - Date.UTC(v.y, v.m - 1, v.d, v.h, v.min);
  }
  return new Date(utc);
}

export const zonedMidnight = (y, m, d, zona) => horaEnZona(y, m, d, 0, 0, zona);
