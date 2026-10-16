/* SPIKE 02 — does a deferred approval survive CONTAINER RECREATION?

   SPIKE 01 proved defer/resume works when the PROCESS dies. But the transcript
   lives in ~/.claude/projects/…, inside the container, and a
   `docker compose up -d --build` wipes it. This spike closes that gap: it wires
   a SessionStore on Postgres and runs the two phases in DIFFERENT, throwaway
   containers.

   It uses the BUILT-IN `Write` tool, not in-process MCP: SPIKE 01 showed that
   an `sdk` server doesn't reconnect on resume and the deferred run is silently
   lost.

   Phase A (container 1):  defers the Write. The file does NOT exist.
   Phase B (container 2):  clean disk, resumes from Postgres, approves.
                           The file appears.

   That the container is a different one isn't assumed: phase B FAILS if it
   finds the transcript on local disk, because it would then be resuming from
   the file and not from Postgres.

   Run with tools/spike-02.sh (it starts and destroys both containers).
   Cheap model on purpose: this tests plumbing, not intelligence. */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createPgSessionStore } from './pg-store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* The SAME cwd in both phases, and not for convenience: the SDK derives the
   `projectKey` from the sanitized cwd and exposes no option to set it. Two
   containers with different cwds produce different keys, `load()` returns null
   and the session resumes EMPTY without a single error. It's the same kind of
   silent failure SPIKE 01 found with in-process MCP.

   SPIKE_DIR exists to be able to TEST that failure, not for convenience. */
const DIR = process.env.SPIKE_DIR || '/tmp/apm-spike2';
const DESTINO = path.join(DIR, 'gasto.txt');
const MODELO = 'claude-haiku-4-5';

const fase = process.argv[2];
const sessionIdArg = process.argv[3];

const dbUrl = process.env.APM_DB_URL;
if (!dbUrl) { console.error('APM_DB_URL missing'); process.exit(1); }

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
  /* MEASURED, not assumed. The suspicion was that 'batched' (the default)
     would leave the batch unsent when the process died on the defer, and that
     'eager' would be needed. False: both phases complete with 'batched'. A
     defer emits a `result` message, and the SDK flushes the mirror buffer on
     every `result` — so the defer ALREADY is a flush point.
     The default stays: 'eager' costs one append per frame and buys nothing
     here. SPIKE_FLUSH lets you reproduce both. */
  sessionStoreFlush: process.env.SPIKE_FLUSH || 'batched'
};

/* Looks for the transcript on local disk. Phase B uses it as a guard. */
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
  console.log('── A: asks to write and DEFERS ──');

  let r = null;
  for await (const m of query({
    prompt: `Write the text "expense 12.50 coffee" to the file ${DESTINO}. Use the Write tool.`,
    options: { ...base, hooks: hooks('defer') }
  })) { if (m.type === 'result') r = m; }

  console.log('  terminal_reason:', r?.terminal_reason);
  console.log('  deferred:', r?.deferred_tool_use?.name);
  console.log('  file exists after A:', fs.existsSync(DESTINO));
  if (r?.terminal_reason !== 'tool_deferred') {
    console.error('\n>>> FAIL: A did not defer; the spike proves nothing');
    process.exit(1);
  }

  const n = await contarEntradas(r.session_id);
  console.log(`  entries in Postgres: ${n}`);
  if (n === 0) {
    console.error('\n>>> FAIL: the mirror wrote nothing. B would have nothing to resume from');
    process.exit(1);
  }

  console.log(`\nSESSION_ID=${r.session_id}`);
}

async function faseB() {
  if (!sessionIdArg) { console.error('usage: node run.mjs b <session_id>'); process.exit(1); }
  console.log('── B: NEW container, resumes from Postgres and APPROVES ──');
  console.log('  session:', sessionIdArg);

  /* Guard. If the transcript is on disk, the resume could come from there and
     the spike would prove nothing about Postgres. */
  const enDisco = transcriptEnDisco(sessionIdArg);
  if (enDisco) {
    console.error(`\n>>> INVALID: the transcript is still on disk (${enDisco}).`);
    console.error('    This is not a new container; the spike does not test what it claims to.');
    process.exit(1);
  }
  console.log('  local disk: no transcript ✓ (Postgres is the only source)');
  console.log(`  entries in Postgres: ${await contarEntradas(sessionIdArg)}`);

  fs.mkdirSync(DIR, { recursive: true });
  console.log('  file exists before B:', fs.existsSync(DESTINO));

  let r = null;
  for await (const m of query({
    prompt: '',
    options: { ...base, resume: sessionIdArg, hooks: hooks('allow') }
  })) {
    if (m.type === 'system' && m.subtype === 'init') {
      console.log('  [init] tools:', (m.tools || []).includes('Write') ? 'Write present' : 'Write MISSING');
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
  console.log('  file exists after B:', ok);
  if (ok) console.log('  content:', JSON.stringify(fs.readFileSync(DESTINO, 'utf8').trim()));

  /* The verdict is the FILE, not what the model says or the terminal_reason.
     SPIKE 01: a turn can end `completed`, with no error, the agent
     apologizing, and the tool never having run. */
  console.log(ok
    ? '\n>>> YES: the deferred approval survives container recreation'
    : '\n>>> NO: the transcript traveled but the deferred tool did not run');
  if (!ok) process.exit(1);
}

try {
  if (fase === 'a') await faseA();
  else if (fase === 'b') await faseB();
  else { console.error('usage: node run.mjs a | node run.mjs b <session_id>'); process.exit(1); }
} finally {
  await store.pool.end();
}
