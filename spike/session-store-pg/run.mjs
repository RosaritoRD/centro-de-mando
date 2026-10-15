/* SPIKE 02 — ¿sobrevive una aprobación diferida a la RECREACIÓN DEL CONTENEDOR?

   SPIKE 01 probó que defer/resume funciona cuando muere el PROCESO. Pero el
   transcript vive en ~/.claude/projects/…, dentro del contenedor, y un
   `docker compose up -d --build` lo borra. Este spike cierra ese hueco:
   cablea un SessionStore sobre Postgres y ejecuta las dos fases en
   contenedores DISTINTOS y efímeros.

   Se usa la herramienta INTEGRADA `Write`, no un MCP in-process: SPIKE 01
   demostró que un servidor `sdk` no se reconecta al reanudar y la ejecución
   diferida se pierde en silencio.

   Fase A (contenedor 1):  difiere el Write. El archivo NO existe.
   Fase B (contenedor 2):  disco limpio, reanuda desde Postgres, aprueba.
                           El archivo aparece.

   La prueba de que el contenedor es otro no se asume: la fase B FALLA si
   encuentra el transcript en el disco local, porque entonces estaría
   reanudando desde el archivo y no desde Postgres.

   Se corre con tools/spike-02.sh (levanta y destruye los dos contenedores).
   Modelo barato a propósito: esto prueba fontanería, no inteligencia. */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createPgSessionStore } from './pg-store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* MISMO cwd en las dos fases, y no por comodidad: el SDK deriva el
   `projectKey` del cwd saneado y no expone una opción para fijarlo. Dos
   contenedores con cwd distinto generan claves distintas, `load()` devuelve
   null y la sesión reanuda VACÍA sin un solo error. Es la misma clase de
   fallo silencioso que SPIKE 01 encontró con el MCP in-process.

   SPIKE_DIR existe para poder PROBAR ese fallo, no por comodidad. */
const DIR = process.env.SPIKE_DIR || '/tmp/apm-spike2';
const DESTINO = path.join(DIR, 'gasto.txt');
const MODELO = 'claude-haiku-4-5';

const fase = process.argv[2];
const sessionIdArg = process.argv[3];

const dbUrl = process.env.APM_DB_URL;
if (!dbUrl) { console.error('falta APM_DB_URL'); process.exit(1); }

const store = createPgSessionStore(dbUrl);

function hooks(decision) {
  return {
    PreToolUse: [{
      matcher: 'Write',
      hooks: [async (input) => {
        console.log(`  [hook] ${input.tool_name} -> ${decision}`);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: decision,
            permissionDecisionReason: 'spike-02'
          }
        };
      }]
    }]
  };
}

const base = {
  model: MODELO,
  allowedTools: ['Write'],
  settingSources: [],
  maxTurns: 4,
  cwd: DIR,
  sessionStore: store,
  /* MEDIDO, no supuesto. La sospecha era que 'batched' (el defecto) dejaría
     el lote sin salir al morir el proceso en el defer, y que haría falta
     'eager'. Es falso: las dos fases completan con 'batched'. Un defer emite
     un mensaje `result`, y el SDK vacía el buffer del mirror en cada
     `result` — o sea, el defer YA es un punto de flush.
     Se queda el defecto: 'eager' cuesta un append por frame sin comprar nada
     aquí. SPIKE_FLUSH permite reproducir ambos. */
  sessionStoreFlush: process.env.SPIKE_FLUSH || 'batched'
};

/* Busca el transcript en el disco local. La fase B lo usa como guardián. */
function transcriptEnDisco(sessionId) {
  const raiz = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(raiz)) return null;
  const pila = [raiz];
  while (pila.length) {
    const d = pila.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) pila.push(p);
      else if (e.name.includes(sessionId)) return p;
    }
  }
  return null;
}

async function contarEntradas(sessionId) {
  const { rows } = await store.pool.query(
    `SELECT count(*)::int AS n FROM session_entry WHERE session_id = $1`,
    [sessionId]
  );
  return rows[0].n;
}

async function faseA() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  console.log('── A: pide escribir y DIFIERE ──');

  let r = null;
  for await (const m of query({
    prompt: `Escribe el texto "gasto 12.50 cafe" en el archivo ${DESTINO}. Usa la herramienta Write.`,
    options: { ...base, hooks: hooks('defer') }
  })) { if (m.type === 'result') r = m; }

  console.log('  terminal_reason:', r?.terminal_reason);
  console.log('  deferred:', r?.deferred_tool_use?.name);
  console.log('  archivo existe tras A:', fs.existsSync(DESTINO));
  if (r?.terminal_reason !== 'tool_deferred') {
    console.error('\n>>> FALLO: A no difirió; el spike no prueba nada');
    process.exit(1);
  }

  const n = await contarEntradas(r.session_id);
  console.log(`  entradas en Postgres: ${n}`);
  if (n === 0) {
    console.error('\n>>> FALLO: el mirror no escribió nada. B no tendría de dónde reanudar');
    process.exit(1);
  }

  console.log(`\nSESSION_ID=${r.session_id}`);
}

async function faseB() {
  if (!sessionIdArg) { console.error('uso: node run.mjs b <session_id>'); process.exit(1); }
  console.log('── B: contenedor NUEVO, reanuda desde Postgres y APRUEBA ──');
  console.log('  sesión:', sessionIdArg);

  /* Guardián. Si el transcript está en disco, la reanudación podría venir de
     ahí y el spike no demostraría nada sobre Postgres. */
  const enDisco = transcriptEnDisco(sessionIdArg);
  if (enDisco) {
    console.error(`\n>>> INVÁLIDO: el transcript sigue en disco (${enDisco}).`);
    console.error('    Esto no es un contenedor nuevo; el spike no prueba lo que dice probar.');
    process.exit(1);
  }
  console.log('  disco local: sin transcript ✓ (la única fuente es Postgres)');
  console.log(`  entradas en Postgres: ${await contarEntradas(sessionIdArg)}`);

  fs.mkdirSync(DIR, { recursive: true });
  console.log('  archivo existe antes de B:', fs.existsSync(DESTINO));

  let r = null;
  for await (const m of query({
    prompt: '',
    options: { ...base, resume: sessionIdArg, hooks: hooks('allow') }
  })) {
    if (m.type === 'system' && m.subtype === 'init') {
      console.log('  [init] tools:', (m.tools || []).includes('Write') ? 'Write presente' : 'Write AUSENTE');
    }
    if (m.type === 'assistant') {
      for (const b of m.message.content || []) {
        if (b.type === 'tool_use') console.log('  [assistant] tool_use ->', b.name);
      }
    }
    if (m.type === 'result') r = m;
  }

  console.log('  terminal_reason:', r?.terminal_reason);
  const ok = fs.existsSync(DESTINO);
  console.log('  archivo existe tras B:', ok);
  if (ok) console.log('  contenido:', JSON.stringify(fs.readFileSync(DESTINO, 'utf8').trim()));

  /* El veredicto es el ARCHIVO, no lo que diga el modelo ni el
     terminal_reason. SPIKE 01: un turno puede terminar `completed`, sin
     error, con el agente disculpándose, y la herramienta no haberse
     ejecutado nunca. */
  console.log(ok
    ? '\n>>> SÍ: la aprobación diferida sobrevive a la recreación del contenedor'
    : '\n>>> NO: el transcript viajó pero la herramienta diferida no se ejecutó');
  if (!ok) process.exit(1);
}

try {
  if (fase === 'a') await faseA();
  else if (fase === 'b') await faseB();
  else { console.error('uso: node run.mjs a | node run.mjs b <session_id>'); process.exit(1); }
} finally {
  await store.pool.end();
}
