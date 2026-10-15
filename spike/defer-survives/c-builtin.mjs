/* TEST DECISIVO — el mismo defer/resume, pero con una herramienta INTEGRADA
   (Write) en vez de una MCP in-process.

   Aísla las dos hipótesis que quedan vivas:

     · Si aquí SÍ se ejecuta  → el mecanismo defer/resume funciona, y lo que
       está roto es solo el MCP in-process (`type: 'sdk'`, que los propios
       tipos describen como "Not serializable"). Arreglo: sacar las
       herramientas de APM del proceso.
     · Si aquí TAMPOCO        → defer/resume no sirve para APM y hay que ir al
       plan B de ARCHITECTURE.md §2.

   Los dos procesos van en el mismo archivo, separados por argv, para que la
   única diferencia entre ellos sea la decisión del hook. */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/tmp/apm-spike-builtin';
const DESTINO = path.join(DIR, 'gasto.txt');
const ESTADO = path.join(DIR, 'estado.json');
const fase = process.argv[2];

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
            permissionDecisionReason: 'spike'
          }
        };
      }]
    }]
  };
}

const base = {
  model: 'claude-haiku-4-5',
  allowedTools: ['Write'],
  settingSources: [],
  maxTurns: 4,
  cwd: DIR
};

if (fase === 'a') {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  console.log('── A: pide escribir y DIFIERE ──');
  let r = null;
  for await (const m of query({
    prompt: `Escribe el texto "gasto 12.50 cafe" en el archivo ${DESTINO}. Usa la herramienta Write.`,
    options: { ...base, hooks: hooks('defer') }
  })) { if (m.type === 'result') r = m; }
  console.log('  terminal_reason:', r.terminal_reason);
  console.log('  deferred:', r.deferred_tool_use?.name);
  console.log('  archivo existe tras A:', fs.existsSync(DESTINO));
  fs.writeFileSync(ESTADO, JSON.stringify({ session_id: r.session_id }));
  if (r.terminal_reason !== 'tool_deferred') process.exit(1);
} else {
  const { session_id } = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
  console.log('── B: proceso NUEVO, reanuda y APRUEBA ──');
  console.log('  sesión:', session_id);
  let r = null;
  for await (const m of query({
    prompt: '',
    options: { ...base, resume: session_id, hooks: hooks('allow') }
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
  console.log(ok
    ? '\n>>> defer/resume FUNCIONA con herramienta integrada'
    : '\n>>> defer/resume NO funciona ni con herramienta integrada');
}
