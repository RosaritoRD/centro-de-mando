/* tu empresa — APM · runtime de agentes (Fase 2).

   Aquí vive el flujo que define el producto (docs/ARCHITECTURE.md §2):
   una ejecución que puede PARARSE a pedir permiso, sobrevivir horas y un
   redespliegue, y continuar cuando el dueño aprueba desde el móvil.

   Los tres invariantes que no se negocian:

   1. El estado de verdad es `run_event`, append-only. Reconstruir = releer
      eventos. Si el proceso muere a mitad, la reanudación sigue funcionando.
   2. La aprobación se verifica en el SERVIDOR, contra la fila de `approval`.
      Nunca se confía en que el prompt "recuerde" pedir permiso.
   3. Los topes (coste, iteraciones, presupuesto del día) los aplica este
      código, no el modelo.

   ⚠️ CORRECCIÓN A ARCHITECTURE.md §2: el diagrama dibuja
   `canUseTool → {behavior:"defer"}`. Eso NO existe. En los tipos del SDK,
   `PermissionResult` solo admite 'allow' y 'deny'; el 'defer' vive
   exclusivamente en los hooks (`HookPermissionDecision`). Por eso la puerta
   de aprobación es un hook PreToolUse y no canUseTool. */

import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { db } from './db.js';
import { sessionStore } from './session-store.js';
import { desdeFilaRun, lineasDeUbicacion, ubicacionEfectiva, aColumnas } from './location.js';
import { crearRepoLeads } from './leads-repo.js';
import { servidorDeLeads, NOMBRE_HERRAMIENTA as GUARDAR_LEADS } from './lead-tool.js';
import { presupuestoDeRun, topeDeVuelta } from './topes.js';

/* El repo de leads, para la herramienta `guardar_leads` (lead-tool.js). */
const repoLeads = crearRepoLeads({ db });

/* ⚠️ CONSTANTE DEL DESPLIEGUE, no una preferencia. El SDK deriva el
   `projectKey` del cwd y no deja fijarlo; cambiar esto invalida todas las
   aprobaciones pendientes (medido en docs/SPIKE-02-container.md). Si algún
   día hay que cambiarlo, hay que vaciar antes la cola de aprobaciones. */
export const AGENT_CWD = '/workspace';

/* Bus en memoria para el SSE. No es el estado: es solo el empujón para que un
   navegador conectado vea el evento sin hacer polling. Quien llega tarde
   relee `run_event`, que sí es el estado. */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

/* Herramientas que NO se ejecutan sin permiso humano. El criterio es
   irreversibilidad: escribir en disco, ejecutar comandos o salir a la red
   con efectos. Leer no pide permiso — nadie aprueba un `grep`. */
const CON_APROBACION = ['Bash', 'Write', 'Edit', 'NotebookEdit'];

/* Lo que el agente puede usar sin preguntar. Lista blanca explícita, nunca
   comodín: es la regla del informe A. */
/* ⚠️ 'Task' es la herramienta de delegación y es OBLIGATORIA para que el
   orquestador pueda usar subagentes. Comprobado quitándola: sin ella el
   agente no delega, se va a `Bash` y acaba pidiendo una aprobación que nadie
   quería. Ojo con el nombre: se DECLARA como 'Task' pero en los eventos
   aparece como 'Agent', así que buscar 'Agent' en esta lista no encuentra
   nada y parece que sobra. No sobra. */
const HERRAMIENTAS = ['Read', 'Glob', 'Grep', 'WebSearch', 'Task', ...CON_APROBACION];

/* Modelo por defecto: Haiku, no Sonnet. Medido: un "Hola" cuesta $0.037 con
   Sonnet 5 y ~$0.012 con Haiku, y casi todo el gasto es el prefijo cacheado,
   no la respuesta. Para lo que se pide 20 veces al día, Sonnet es pagar de
   más. El chat deja subir de modelo cuando el trabajo lo pide. */
export const MODELO_DEFECTO = 'claude-haiku-4-5';

/* ── Subagentes ──────────────────────────────────────────────────
   El orquestador delega con la herramienta `Task`.

   ⚠️ Un subagente MULTIPLICA el coste: rehace contexto, explora por su
   cuenta y luego el orquestador relee su informe. Por eso hay uno solo y es
   de SOLO LECTURA — sin Bash, Write ni Edit. Un subagente que solo investiga
   no puede pedir aprobaciones, y eso evita el peor caso: una cola de
   permisos generada por un agente que el dueño nunca lanzó a mano.

   Corre en Haiku a propósito: la parte cara del multi-agente es el número de
   agentes, no la calidad de cada uno. */
const SUBAGENTES = {
  investigador: {
    description: 'Busca y resume información. Úsalo para preguntas que exigen '
      + 'buscar en la web o leer varios archivos, cuando el resultado quepa en un resumen.',
    prompt: 'Investigas para el centro de mando de tu empresa. Busca, contrasta y '
      + 'devuelve un resumen breve en español con las fuentes. No inventes datos: '
      + 'si no lo encuentras, dilo. No puedes escribir ni ejecutar nada.',
    tools: ['Read', 'Glob', 'Grep', 'WebSearch'],
    model: 'claude-haiku-4-5'
  }
};

/* System prompt propio en vez del preset `claude_code`. El motivo NO es el
   coste (medido: apenas unos cientos de tokens): es que el preset describe a
   un asistente de programación, y APM es un centro de mando de negocio. */
const SISTEMA_BASE = [
  'Eres el orquestador de APM, el centro de mando de tu empresa.',
  'Trabajas para el dueño, una sola persona. No eres un asistente de programación.',
  'Responde en español, directo y sin preámbulos.',
  'Todo lo que escriba en disco o ejecute comandos se para a pedir permiso:',
  'no prometas que algo está hecho hasta que la herramienta haya devuelto resultado.',
  'Si no puedes completar algo, dilo claramente en vez de rellenar.',
  /* 26/09/2026: sin esta línea, las búsquedas de leads se quedaban como una
     tabla en el chat y nunca llegaban a la pestaña Leads. */
  'Cuando encuentres negocios con teléfono (leads), guárdalos SIEMPRE con la herramienta',
  'guardar_leads antes de responder, en un nicho en inglés, singular y snake_case',
  '(ej. dental_clinic), sin cadenas ni franquicias grandes, y di en tu respuesta cuántos se guardaron.'
];

/* El system prompt se arma POR EJECUCIÓN porque lleva la ubicación con la que
   se lanzó, que está en sus columnas. Al reanudar tras una aprobación se
   vuelve a leer la fila, así que un chat que empezó buscando en Newark sigue
   buscando en Newark aunque el ajuste global haya cambiado entre medias. */
function sistema(run) {
  return [...SISTEMA_BASE, ...lineasDeUbicacion(desdeFilaRun(run))].join(' ');
}

const MAX_CONCURRENTES = Number(process.env.MAX_CONCURRENT_RUNS || 2);
const vivas = new Set();

/* ── Eventos ─────────────────────────────────────────────────────── */

/* El `seq` se calcula dentro del INSERT y no en JavaScript: dos escrituras
   concurrentes sobre la misma ejecución no pueden darse el mismo número, y
   el índice único (run_id, seq) lo garantiza. */
async function evento(runId, kind, payload) {
  const { rows } = await db.query(
    `INSERT INTO run_event (run_id, seq, kind, payload)
     SELECT $1, coalesce(max(seq), 0) + 1, $2, $3 FROM run_event WHERE run_id = $1
     RETURNING seq, kind, payload, created_at`,
    [runId, kind, JSON.stringify(payload)]
  );
  const e = rows[0];
  bus.emit(runId, { seq: e.seq, kind: e.kind, payload: e.payload, at: e.created_at });
  return e;
}

/* Ultimo texto que emitio el asistente en esta ejecucion, o null. Sirve para
   no duplicar el `result` de cierre del SDK (ver `cerrar`). */
async function ultimoTextoAsistente(runId) {
  const { rows } = await db.query(
    `SELECT payload->>'text' AS t FROM run_event
      WHERE run_id = $1 AND kind = 'assistant'
      ORDER BY seq DESC LIMIT 1`,
    [runId]
  );
  return rows[0]?.t ?? null;
}

async function estado(runId, status, extra = {}) {
  const campos = ['status = $2', 'updated_at = now()'];
  const args = [runId, status];
  if (extra.sessionId) { args.push(extra.sessionId); campos.push(`session_id = $${args.length}`); }
  if (extra.error) { args.push(extra.error); campos.push(`error = $${args.length}`); }
  if (extra.ended) campos.push('ended_at = now()');
  if (extra.started) campos.push('started_at = now()');
  /* Reabrir: una ejecución terminada a la que se le manda otro mensaje deja
     de estar terminada. Sin limpiar ended_at y error, el historial diría que
     acabó a las 10:04 mientras sigue escribiendo a las 10:30. */
  if (extra.reopen) campos.push('ended_at = NULL', 'error = NULL');
  await db.query(`UPDATE run SET ${campos.join(', ')} WHERE id = $1`, args);
  bus.emit(runId, { kind: 'status', payload: { status } });
}

/* ── Presupuesto ─────────────────────────────────────────────────── */

/* El freno de mano. Se consulta ANTES de lanzar, porque con el multiplicador
   del multi-agente un solo despiste cuesta dinero de verdad. */
export async function presupuestoDelDia() {
  const limite = Number(process.env.DAILY_BUDGET_USD || 5);
  const { rows } = await db.query(
    `INSERT INTO budget_day (day, limit_usd) VALUES (CURRENT_DATE, $1)
     ON CONFLICT (day) DO UPDATE SET day = EXCLUDED.day
     RETURNING limit_usd, spent_usd`, [limite]);
  const r = rows[0];
  return { limitUsd: Number(r.limit_usd), spentUsd: Number(r.spent_usd) };
}

/* ⚠️ cost_usd sale de `total_cost_usd` del SDK y NUNCA de `usage`: usage
   EXCLUYE los tokens de los subagentes (corrección del informe A). Contar por
   usage subestimaría justo el caso caro. */
async function anotarCoste(runId, msg) {
  const coste = Number(msg.total_cost_usd || 0);
  const u = msg.usage || {};
  await db.query(
    `INSERT INTO run_cost (run_id, model, input_tokens, output_tokens,
                           cache_read_input_tokens, cache_creation_input_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [runId, msg.model || 'desconocido', u.input_tokens || 0, u.output_tokens || 0,
     u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0, coste]
  );
  await db.query(
    `INSERT INTO budget_day (day, limit_usd, spent_usd)
          VALUES (CURRENT_DATE, $1, $2)
     ON CONFLICT (day) DO UPDATE
        SET spent_usd = budget_day.spent_usd + EXCLUDED.spent_usd, updated_at = now()`,
    [Number(process.env.DAILY_BUDGET_USD || 5), coste]
  );
  return coste;
}

/* ── La puerta de aprobación ─────────────────────────────────────── */

/* Un hook PreToolUse por ejecución. Decide mirando la BD, no la memoria del
   proceso: si el contenedor se recreó entre el defer y la aprobación, este
   código es nuevo pero la fila de `approval` sigue ahí. */
function puerta(runId) {
  return {
    PreToolUse: [{
      matcher: CON_APROBACION.join('|'),
      hooks: [async (input) => {
        const requestId = input.tool_use_id;
        const { rows } = await db.query(
          'SELECT decision, deny_reason FROM approval WHERE run_id = $1 AND request_id = $2',
          [runId, requestId]);
        const previa = rows[0];

        if (previa?.decision === 'allow') {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',
            permissionDecisionReason: 'aprobado por el usuario' } };
        }
        if (previa?.decision === 'deny') {
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
            permissionDecisionReason: previa.deny_reason || 'denegado por el usuario' } };
        }

        /* Primera vez que se ve esta llamada: se crea la solicitud y se
           difiere. ON CONFLICT DO NOTHING porque el hook puede repetirse si el
           SDK reintenta el turno, y dos filas para la misma llamada dejarían
           una aprobación huérfana para siempre. */
        await db.query(
          `INSERT INTO approval (run_id, request_id, tool_name, tool_input, summary)
                VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (run_id, request_id) DO NOTHING`,
          [runId, requestId, input.tool_name, JSON.stringify(input.tool_input ?? {}),
           resumen(input.tool_name, input.tool_input)]);
        await evento(runId, 'approval_requested',
          { requestId, tool: input.tool_name, input: input.tool_input });
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'defer',
          permissionDecisionReason: 'esperando aprobación humana' } };
      }]
    }]
  };
}

/* Una frase en cristiano para la notificación del móvil. Aprobar algo que
   solo se entiende leyendo JSON es como no aprobar nada. */
function resumen(tool, input) {
  const i = input || {};
  if (tool === 'Bash') return `Ejecutar en la terminal: ${String(i.command || '').slice(0, 200)}`;
  if (tool === 'Write') return `Escribir el archivo ${i.file_path || '(sin ruta)'}`;
  if (tool === 'Edit' || tool === 'NotebookEdit') return `Modificar el archivo ${i.file_path || '(sin ruta)'}`;
  return `Usar la herramienta ${tool}`;
}

/* ── El bucle ────────────────────────────────────────────────────── */

/* Drena una vuelta del agente. `arranque` distingue la primera ejecución de
   una reanudación tras aprobación: cambia el prompt y añade `resume`. */
async function vuelta(run, arranque) {
  /* Lo que queda del día, leído en CADA vuelta: una reanudación tras aprobar
     no puede gastar su presupuesto entero si el día ya va casi lleno. */
  const tope = topeDeVuelta(run.budget_usd, await presupuestoDelDia());
  /* Día agotado: no se lanza. Nunca se pasa 0 al SDK (lo manda tal cual como
     --max-budget-usd 0) y la reanudación tras aprobar no pasaba por comprobarTopes. */
  if (tope <= 0) {
    const e = new Error('presupuesto diario agotado');
    e.code = 'budget_exhausted';
    throw e;
  }
  const opciones = {
    model: run.model,
    cwd: AGENT_CWD,
    systemPrompt: sistema(run),
    agents: SUBAGENTES,
    /* `tools` y `allowedTools` NO son lo mismo, y confundirlos cuesta dinero.
       `allowedTools` solo dice qué se PERMITE usar; el SDK sigue cargando su
       catálogo entero en el prompt. `tools` es el que decide qué definiciones
       viajan. Medido: sin `tools`, un "Hola" cacheaba 24.937 tokens y costaba
       $0.094 con casi todo el gasto en definiciones de herramientas que ni
       siquiera estaban permitidas. Con ambos, el prefijo baja a ~7.400. */
    tools: HERRAMIENTAS,
    /* La herramienta propia va por MCP en proceso: no está en `tools` (que
       es el catálogo del SDK), pero sí tiene que estar permitida. */
    allowedTools: [...HERRAMIENTAS, GUARDAR_LEADS],
    mcpServers: { apm: servidorDeLeads({ repo: repoLeads, runId: run.id }) },
    /* settingSources vacío: el agente NO hereda la configuración de la
       máquina (~/.claude). Lo que puede hacer se decide aquí y solo aquí. */
    settingSources: [],
    maxTurns: run.max_iterations,
    maxBudgetUsd: tope,
    sessionStore,
    hooks: puerta(run.id),
    ...(arranque.resume ? { resume: arranque.resume } : {})
  };

  let resultado = null;
  for await (const m of query({ prompt: arranque.prompt, options: opciones })) {
    if (m.type === 'system' && m.subtype === 'init') {
      if (m.session_id) await estado(run.id, 'running', { sessionId: m.session_id });
    } else if (m.type === 'assistant') {
      for (const b of m.message?.content || []) {
        if (b.type === 'text' && b.text) await evento(run.id, 'assistant', { text: b.text });
        else if (b.type === 'tool_use') await evento(run.id, 'tool_use', { name: b.name, input: b.input });
      }
    } else if (m.type === 'user') {
      for (const b of m.message?.content || []) {
        if (b.type === 'tool_result') {
          await evento(run.id, 'tool_result',
            { ok: !b.is_error, content: typeof b.content === 'string' ? b.content.slice(0, 4000) : b.content });
        }
      }
    } else if (m.type === 'result') {
      resultado = m;
    }
  }
  return resultado;
}

/* Cierra una vuelta. Devuelve true si la ejecución quedó EN ESPERA (no
   terminada), que es el caso interesante. */
async function cerrar(run, r) {
  if (!r) {
    await estado(run.id, 'failed', { error: 'el agente no devolvió resultado', ended: true });
    return false;
  }
  const coste = await anotarCoste(run.id, r);
  await evento(run.id, 'system', { terminal: r.terminal_reason, costUsd: coste });

  if (r.terminal_reason === 'tool_deferred') {
    await estado(run.id, 'awaiting_approval');
    return true;
  }
  if (r.is_error || r.terminal_reason === 'tool_deferred_unavailable') {
    await estado(run.id, 'failed', { error: r.result || r.terminal_reason, ended: true });
    return false;
  }
  /* El SDK cierra la vuelta con un `result` que casi siempre REPITE, palabra
     por palabra, el último bloque de texto del asistente. Guardarlo dejaba una
     fila duplicada en `run_event` y una burbuja repetida en el chat (arreglado
     tambien en la UI, pero la raiz esta aqui). Solo se guarda `final` cuando
     aporta algo distinto de lo ultimo que ya dijo el asistente. */
  const textoFinal = r.result || '';
  if (textoFinal && textoFinal !== (await ultimoTextoAsistente(run.id))) {
    await evento(run.id, 'final', { text: textoFinal });
  }
  await estado(run.id, 'done', { ended: true });
  return false;
}

/* ── API pública ─────────────────────────────────────────────────── */

/* Los dos frenos de mano, juntos, para que arrancar y continuar no puedan
   divergir: una conversación reanudada gasta exactamente igual que una nueva. */
function comprobarTopes({ limitUsd, spentUsd }) {
  if (spentUsd >= limitUsd) {
    const e = new Error('presupuesto diario agotado');
    e.code = 'budget_exhausted';
    throw e;
  }
  if (vivas.size >= MAX_CONCURRENTES) {
    const e = new Error(`ya hay ${vivas.size} ejecuciones en marcha (tope ${MAX_CONCURRENTES})`);
    e.code = 'too_many_runs';
    throw e;
  }
}

export async function crearRun({ prompt, area, model, budgetUsd, title, location }) {
  comprobarTopes(await presupuestoDelDia());

  /* La ubicación se resuelve AQUÍ y se congela en la fila: lo que mandó el
     chat, y lo que no venga, el ajuste guardado. */
  const ubic = ubicacionEfectiva(location, await ubicacionGuardada());

  const { rows } = await db.query(
    `INSERT INTO run (area, title, model, budget_usd, status, started_at,
                      base_city, base_country, target_city, target_country)
          VALUES ($1, $2, $3, $4, 'running', now(), $5, $6, $7, $8)
       RETURNING *`,
    [area || 'general', title || prompt.slice(0, 120), model || MODELO_DEFECTO,
     presupuestoDeRun(budgetUsd), ...aColumnas(ubic)]);
  const run = rows[0];

  await evento(run.id, 'user', { text: prompt });
  lanzar(run, { prompt });
  return run;
}

/* No se hace await a propósito: el HTTP contesta con el id y el navegador se
   engancha al SSE. Una ejecución puede durar minutos. */
function lanzar(run, arranque) {
  vivas.add(run.id);
  (async () => {
    try {
      const r = await vuelta(run, arranque);
      await cerrar(run, r);
    } catch (e) {
      console.error('run', run.id, e.message);
      await evento(run.id, 'error', { message: e.message }).catch(() => {});
      await estado(run.id, 'failed', { error: e.message, ended: true }).catch(() => {});
    } finally {
      vivas.delete(run.id);
    }
  })();
}

/* El ajuste global, leído de `setting`. Devuelve null si no hay fila: una
   ubicación sin configurar no es un error, solo significa que el prompt no
   lleva líneas de ubicación. */
export async function ubicacionGuardada() {
  const { rows } = await db.query("SELECT value FROM setting WHERE key = 'location'");
  return rows[0]?.value || null;
}

/* Otro mensaje en una conversación que ya existe.

   Esto es lo que convierte el historial en chats de verdad y no en un registro
   de ejecuciones sueltas. Se apoya en el `session_id` del SDK, que es lo mismo
   que usa la reanudación tras una aprobación: si no hay sesión no hay nada que
   continuar, y decirlo es mejor que empezar una conversación nueva a
   escondidas con el nombre de la vieja. */
export async function continuarRun(runId, prompt) {
  const { rows } = await db.query('SELECT * FROM run WHERE id = $1', [runId]);
  const run = rows[0];
  if (!run) return null;

  if (run.status === 'running' || run.status === 'queued' || run.status === 'awaiting_approval') {
    const e = new Error('esa conversación todavía está trabajando');
    e.code = 'run_busy';
    throw e;
  }
  if (!run.session_id) {
    const e = new Error('esa conversación no tiene sesión: no se puede continuar');
    e.code = 'no_session';
    throw e;
  }

  comprobarTopes(await presupuestoDelDia());

  await evento(runId, 'user', { text: prompt });
  await estado(runId, 'running', { reopen: true });
  lanzar(run, { prompt, resume: run.session_id });
  return { id: run.id, status: 'running', model: run.model };
}

/* Decide una aprobación pendiente y, si procede, reanuda. */
export async function decidir(approvalId, decision, denyReason) {
  const { rows } = await db.query(
    `UPDATE approval SET decision = $2, deny_reason = $3, decided_at = now()
      WHERE id = $1 AND decision IS NULL
      RETURNING run_id, request_id, tool_name`,
    [approvalId, decision, denyReason || null]);
  if (!rows[0]) return null;
  const { run_id: runId } = rows[0];

  const { rows: rr } = await db.query('SELECT * FROM run WHERE id = $1', [runId]);
  const run = rr[0];
  if (!run) return null;

  await evento(runId, 'approval_decided', { approvalId, decision, tool: rows[0].tool_name });

  if (!run.session_id) {
    await estado(runId, 'failed', { error: 'no hay session_id: imposible reanudar', ended: true });
    return { runId, resumed: false };
  }

  await estado(runId, 'running');
  /* Prompt vacío: no se le pide nada nuevo, solo que siga con la llamada que
     tenía pendiente. */
  lanzar(run, { prompt: '', resume: run.session_id });
  return { runId, resumed: true };
}

export function ejecucionesVivas() {
  return vivas.size;
}
