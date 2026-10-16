/* DECISIVE TEST — the same defer/resume, but with a BUILT-IN tool (Write)
   instead of an in-process MCP one.

   It isolates the two hypotheses still standing:

     · If it DOES run here   → the defer/resume mechanism works, and the only
       broken part is in-process MCP (`type: 'sdk'`, which the types themselves
       describe as "Not serializable"). Fix: move APM's tools out of process.
     · If it does NOT run here either → defer/resume is no good for APM and we
       go to plan B in ARCHITECTURE.md §2.

   Both processes live in the same file, split by argv, so the only difference
   between them is the hook's decision. */

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
  console.log('── A: asks to write and DEFERS ──');
  let r = null;
  for await (const m of query({
    prompt: `Write the text "expense 12.50 coffee" to the file ${DESTINO}. Use the Write tool.`,
    options: { ...base, hooks: hooks('defer') }
  })) { if (m.type === 'result') r = m; }
  console.log('  terminal_reason:', r.terminal_reason);
  console.log('  deferred:', r.deferred_tool_use?.name);
  console.log('  file exists after A:', fs.existsSync(DESTINO));
  fs.writeFileSync(ESTADO, JSON.stringify({ session_id: r.session_id }));
  if (r.terminal_reason !== 'tool_deferred') process.exit(1);
} else {
  const { session_id } = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
  console.log('── B: NEW process, resumes and APPROVES ──');
  console.log('  session:', session_id);
  let r = null;
  for await (const m of query({
    prompt: '',
    options: { ...base, resume: session_id, hooks: hooks('allow') }
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
  console.log(ok
    ? '\n>>> defer/resume WORKS with a built-in tool'
    : '\n>>> defer/resume does NOT work even with a built-in tool');
}
