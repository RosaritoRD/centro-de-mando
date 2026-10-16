/* Calling window: 8:00 to 21:00 in the lead's LOCAL time.

   It's the TCPA rule (47 CFR 64.1200(c)(1)). Computed in the lead's time zone,
   not the server's (UTC) or the caller's: the time that counts is the time of
   whoever receives the call. */

import { partesLocales as horaLocal, horaEnZona } from './tz.js';

const ABRE = 8;
const CIERRA = 21;

export function dentroDeHorario(ahora, zona = 'America/New_York') {
  const { h } = horaLocal(ahora, zona);
  return h >= ABRE && h < CIERRA;
}

/** When you can call again if it's currently outside the window. */
export function proximaApertura(ahora, zona = 'America/New_York') {
  const local = horaLocal(ahora, zona);
  if (local.h < ABRE) return horaEnZona(local.y, local.m, local.d, ABRE, 0, zona);
  const manana = new Date(Date.UTC(local.y, local.m - 1, local.d + 1, 12));
  return horaEnZona(manana.getUTCFullYear(), manana.getUTCMonth() + 1, manana.getUTCDate(), ABRE, 0, zona);
}
