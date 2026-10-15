/* Scoreboard semanal de ventas (EKER OS: "evaluar ventas según números, no emociones").

   Semanas ISO (lunes-domingo) en hora de Nueva York: una llamada del domingo a
   las 23:30 es de esa semana aunque en UTC ya sea lunes. Las filas corregidas
   (otra fila con corrects_id apuntándolas) no cuentan: si no, un botón mal
   pulsado inflaría los "interesados" para siempre. */

import { zonedMidnight, partesLocales } from './tz.js';

const ZONA = 'America/New_York';

/** "2026-W39" para una fecha, contada en hora de NY. */
export function semanaIso(fecha = new Date()) {
  const { y, m, d } = partesLocales(fecha, ZONA);
  const dia = new Date(Date.UTC(y, m - 1, d));
  const dow = dia.getUTCDay() || 7;
  dia.setUTCDate(dia.getUTCDate() + 4 - dow);             // jueves de esa semana
  const inicioAnio = new Date(Date.UTC(dia.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((dia - inicioAnio) / 86400000 + 1) / 7);
  return `${dia.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

/** [desde, hasta) en UTC para una semana ISO en hora de NY. */
export function rangoSemana(iso) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const anio = Number(m[1]);
  const semana = Number(m[2]);
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const lunes1 = new Date(cuatroEnero);
  lunes1.setUTCDate(4 - (cuatroEnero.getUTCDay() || 7) + 1);
  const lunes = new Date(lunes1);
  lunes.setUTCDate(lunes1.getUTCDate() + (semana - 1) * 7);
  const siguiente = new Date(lunes);
  siguiente.setUTCDate(lunes.getUTCDate() + 7);
  const a = (f) => zonedMidnight(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), ZONA);
  return { desde: a(lunes), hasta: a(siguiente) };
}

const CONTESTADAS = new Set(['no_interesa', 'interesado', 'demo', 'no_llamar', 'llamar_luego']);

export function scoreboard(filas = []) {
  const corregidas = new Set(filas.filter((f) => f.corrects_id).map((f) => f.corrects_id));
  const validas = filas.filter((f) => !corregidas.has(f.id));
  const cuenta = (o) => validas.filter((f) => f.outcome === o).length;
  const calls = validas.length;
  const answered = validas.filter((f) => CONTESTADAS.has(f.outcome)).length;
  const interested = cuenta('interesado');
  const demos = cuenta('demo');
  const redondea = (x) => Math.round(x * 1000) / 1000;
  return {
    calls,
    answered,
    noAnswer: cuenta('no_contesto'),
    voicemail: cuenta('buzon'),
    notInterested: cuenta('no_interesa'),
    interested,
    demos,
    callbacks: cuenta('llamar_luego'),
    doNotCall: cuenta('no_llamar'),
    badNumber: cuenta('numero_malo'),
    contactRate: calls ? redondea(answered / calls) : 0,
    interestRate: answered ? redondea((interested + demos) / answered) : 0
  };
}
