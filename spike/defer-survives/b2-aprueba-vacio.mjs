/* PROCESS B (variant 2) — resumes with an EMPTY prompt.

   v1 passed "Continue." and the hook never fired: the new user turn seems to
   discard the pending call. The docs say that on resume "the same tool call
   fires PreToolUse again", so the hypothesis is that the prompt is in the way.
   Here EVERYTHING that arrives is logged, so we never conclude blind again. */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import { hooks, OPCIONES_BASE, ESTADO, EFECTO } from './shared.mjs';

const estado = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
fs.rmSync(EFECTO, { force: true });

console.log('── PROCESS B2 (pid ' + process.pid + ') ──');
console.log('  resuming:', estado.session_id, 'with an EMPTY prompt');

let resultado = null;
for await (const m of query({
  prompt: process.argv[2] ?? '',
  options: { ...OPCIONES_BASE, resume: estado.session_id, forkSession: process.env.FORK==='1', hooks: hooks('allow', 'approved by the owner') }
})) {
  if (m.type === 'assistant') {
    for (const b of m.message.content || []) {
      if (b.type === 'tool_use') console.log('  [assistant] tool_use ->', b.name);
      if (b.type === 'text' && b.text.trim()) console.log('  [assistant]', b.text.trim().slice(0, 120));
    }
  } else if (m.type === 'result') {
    resultado = m;
  } else if (m.type === 'system' && m.subtype === 'init') {
    /* The question that settles it: does the resumed process see the tool? */
    console.log('  [init] mcp_servers:', JSON.stringify(m.mcp_servers));
    console.log('  [init] tools with "spike":',
      JSON.stringify((m.tools || []).filter((t) => String(t).includes('spike'))));
    console.log('  [init] total tools:', (m.tools || []).length);
  } else if (m.type !== 'stream_event') {
    console.log('  [' + m.type + ']', m.subtype || '');
  }
}

console.log('  terminal_reason:', resultado?.terminal_reason);
const efecto = fs.existsSync(EFECTO) ? fs.readFileSync(EFECTO, 'utf8').trim() : '';
console.log('  effect:', JSON.stringify(efecto));
console.log(efecto ? '\n>>> IT RAN' : '\n>>> it did NOT run');
