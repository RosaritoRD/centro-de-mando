/* tu empresa — APM · puente con n8n (Fase 6).

   n8n sigue ejecutando lo suyo; APM lo mira. Esto NO reimplementa n8n ni
   mueve sus workflows: da una vista de "qué hay corriendo y qué se ha roto"
   dentro del centro de mando, para no tener que abrir otro panel.

   ⚠️ La REST API de n8n **no tiene endpoint para ejecutar un workflow**
   (informe F, verificado). Disparar es por webhook; esto es la mitad de
   monitorización del puente, que es la que aporta valor sin riesgo.

   Se habla por la red interna (`http://n8n:5678`), no por el dominio
   público: no sale a internet ni pasa por el proxy. */

import { Router } from 'express';

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.N8N_API_KEY;
const TIMEOUT_MS = 10_000;

async function n8n(ruta) {
  if (!BASE || !KEY) {
    const e = new Error('n8n no está configurado (faltan N8N_BASE_URL o N8N_API_KEY)');
    e.code = 'sin_config';
    throw e;
  }
  const r = await fetch(`${BASE}/api/v1${ruta}`, {
    headers: { 'X-N8N-API-KEY': KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) {
    const e = new Error(`n8n respondió ${r.status}`);
    e.code = r.status === 401 ? 'clave_invalida' : 'n8n_error';
    throw e;
  }
  return r.json();
}

/* Los errores de n8n no son errores de APM: si n8n está caído, esta pestaña
   lo dice y el resto del panel sigue funcionando. Por eso 502 y no 500. */
function fallo(res, e, msg) {
  const code = e.code || 'n8n_error';
  const status = code === 'sin_config' ? 501 : code === 'clave_invalida' ? 502 : 502;
  console.error('n8n:', e.message);
  res.status(status).json({ error: { code, message: msg } });
}

/* ── Workflows mudos ─────────────────────────────────────────────
   La lista de ejecuciones no basta para saber si algo va bien, y esta es la
   parte que costó descubrir: cuando lo que falla es el TRIGGER, n8n no crea
   ninguna ejecución. No hay fila roja, no hay `status: 'error'`, no hay nada
   que contar. El workflow simplemente deja de aparecer, y una lista de
   "últimas ejecuciones" llena de verdes se lee como salud.

   Pasó el 23/08/2026: la credencial de Gmail quedó revocada y el trigger
   `Correo nuevo` falló casi 6.000 veces en cuatro días — todas en el log del
   contenedor, ninguna en la base de datos. El panel seguía enseñando
   `13 de 13 workflows activos` y una tira de ejecuciones en verde.

   La señal que sí existe es el silencio: un workflow que venía ejecutándose
   cada X y lleva mucho más de X sin hacerlo. Se compara contra su PROPIA
   cadencia y no contra un umbral fijo, porque aquí conviven un cron de 15
   minutos y un informe semanal, y cualquier número único mentiría sobre uno
   de los dos.

   Lo que NO se hace: inventar un veredicto cuando no hay datos. Un workflow
   activo con menos de dos ejecuciones puede ser un webhook que nadie ha
   llamado todavía, y llamarlo "roto" enseñaría a ignorar el aviso. */

/* Con menos de esto no se marca nada aunque la cadencia sea de segundos: un
   cron de un minuto que se salta dos por un pico de carga no está roto. */
const MARGEN_MINIMO_MS = 60 * 60 * 1000;
/* Tres cadencias de silencio. Dos daba falsos positivos con los crons que
   dependen de que haya algo que procesar (el de leads no ejecuta si no hay
   leads nuevos). */
const CADENCIAS_DE_GRACIA = 3;

export function mediana(nums) {
  if (nums.length === 0) return null;
  const orden = [...nums].sort((a, b) => a - b);
  const m = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[m] : (orden[m - 1] + orden[m]) / 2;
}

/* Puro: entra un workflow y SUS ejecuciones, sale un veredicto. Sin red, sin
   reloj propio —`ahora` se inyecta— para que se pueda probar entero. */
export function diagnosticar(workflow, ejecuciones, ahora = Date.now()) {
  const base = { id: workflow.id, name: workflow.name };

  const marcas = (ejecuciones || [])
    .map((e) => Date.parse(e.startedAt))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);

  if (marcas.length < 2) {
    return { ...base, estado: 'sin_datos', ultima: marcas[0] ? new Date(marcas[0]).toISOString() : null,
      cadenciaMs: null, silencioMs: marcas[0] ? ahora - marcas[0] : null };
  }

  const huecos = [];
  for (let i = 0; i < marcas.length - 1; i++) huecos.push(marcas[i] - marcas[i + 1]);
  const cadenciaMs = mediana(huecos);
  const silencioMs = ahora - marcas[0];

  /* Una cadencia de cero (dos ejecuciones en el mismo milisegundo) haría que
     cualquier silencio superase el umbral. Se cae al margen mínimo. */
  const umbral = Math.max(cadenciaMs * CADENCIAS_DE_GRACIA, MARGEN_MINIMO_MS);

  return {
    ...base,
    estado: silencioMs > umbral ? 'mudo' : 'ok',
    ultima: new Date(marcas[0]).toISOString(),
    cadenciaMs,
    silencioMs
  };
}

export function rutasN8n(auth) {
  const r = Router();

  r.get('/api/n8n/workflows', auth, async (_req, res) => {
    try {
      const d = await n8n('/workflows?limit=100');
      /* Solo lo que se pinta. Un workflow trae sus nodos enteros y eso son
         cientos de KB por respuesta que el navegador no necesita. */
      res.json((d.data || [])
        .filter((w) => !w.isArchived)
        .map((w) => ({ id: w.id, name: w.name, active: !!w.active, updatedAt: w.updatedAt }))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)));
    } catch (e) { fallo(res, e, 'no pude leer los workflows de n8n'); }
  });

  r.get('/api/n8n/executions', auth, async (req, res) => {
    const limite = Math.min(Number(req.query.limit) || 20, 100);
    try {
      const d = await n8n(`/executions?limit=${limite}&includeData=false`);
      res.json((d.data || []).map((x) => ({
        id: x.id,
        workflowId: x.workflowId,
        /* `status` puede ser success|error|running|waiting. Se pasa tal cual:
           traducirlo aquí sería inventar un vocabulario que n8n ya tiene. */
        status: x.status,
        startedAt: x.startedAt,
        stoppedAt: x.stoppedAt
      })));
    } catch (e) { fallo(res, e, 'no pude leer las ejecuciones de n8n'); }
  });


  /* Un diagnóstico por workflow activo. Se piden las ejecuciones de cada uno
     por separado en vez de una lista global: con un cron de 15 minutos en la
     casa, cualquier página global se llena de ese y entierra a los demás. */
  r.get('/api/n8n/salud', auth, async (_req, res) => {
    try {
      const d = await n8n('/workflows?limit=100&active=true');
      const activos = (d.data || []).filter((w) => !w.isArchived);

      const ahora = Date.now();
      const partes = await Promise.all(activos.map(async (w) => {
        try {
          const e = await n8n(`/executions?workflowId=${encodeURIComponent(w.id)}&limit=10&includeData=false`);
          return diagnosticar(w, e.data || [], ahora);
        } catch {
          /* Que falle la lectura de UN workflow no puede tumbar el informe
             entero: se marca sin datos y el resto se entrega. */
          return { id: w.id, name: w.name, estado: 'sin_datos', ultima: null, cadenciaMs: null, silencioMs: null };
        }
      }));

      const orden = { mudo: 0, sin_datos: 1, ok: 2 };
      partes.sort((a, b) => orden[a.estado] - orden[b.estado] || a.name.localeCompare(b.name));
      res.json({ leidoA: new Date(ahora).toISOString(), mudos: partes.filter((p) => p.estado === 'mudo').length, workflows: partes });
    } catch (e) { fallo(res, e, 'no pude diagnosticar los workflows de n8n'); }
  });

  return r;
}
