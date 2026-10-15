/* Ventana horaria para llamar: 8:00 a 21:00 en la hora LOCAL del lead.

   Es la regla de la TCPA (47 CFR 64.1200(c)(1)). Se calcula en la zona del
   lead y no en la del servidor (UTC) ni en la de quien llama: la hora que
   cuenta es la del que recibe la llamada. */

import { partesLocales as horaLocal, horaEnZona } from './tz.js';

const ABRE = 8;
const CIERRA = 21;

export function dentroDeHorario(ahora, zona = 'America/New_York') {
  const { h } = horaLocal(ahora, zona);
  return h >= ABRE && h < CIERRA;
}

/** Cuándo se puede volver a llamar si ahora está fuera de horario. */
export function proximaApertura(ahora, zona = 'America/New_York') {
  const local = horaLocal(ahora, zona);
  if (local.h < ABRE) return horaEnZona(local.y, local.m, local.d, ABRE, 0, zona);
  const manana = new Date(Date.UTC(local.y, local.m - 1, local.d + 1, 12));
  return horaEnZona(manana.getUTCFullYear(), manana.getUTCMonth() + 1, manana.getUTCDate(), ABRE, 0, zona);
}
