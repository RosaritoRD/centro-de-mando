/* PROCESS B — a NEW process. Resumes by session_id and approves.

   It starts with nothing from process A in memory: all it gets is what was on
   disk. It's the honest simulation of "the container restarted and the owner
   approves from his phone an hour later". */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import { hooks, OPCIONES_BASE, ESTADO, EFECTO } from './shared.mjs';

const estado = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
console.log('── PROCESS B (pid ' + process.pid + ') ──');
console.log('  resuming session:', estado.session_id);
console.log('  pending tool:', estado.deferred_tool_use?.name);

let resultado = null;
for await (const m of query({
  /* No new prompt: nothing more is asked, just to continue what was left
     pending. If the instruction had to be repeated, the "defer" wouldn't be
     resuming anything — it would be starting over. */
  prompt: 'Continue.',
  options: {
    ...OPCIONES_BASE,
    resume: estado.session_id,
    hooks: hooks('allow', 'approved by the owner')
  }
})) {
  if (m.type === 'result') resultado = m;
}

console.log('  terminal_reason:', resultado?.terminal_reason);
console.log('  cost USD:', resultado?.total_cost_usd);

const efecto = fs.existsSync(EFECTO) ? fs.readFileSync(EFECTO, 'utf8').trim() : '';
console.log('  effect after B:', JSON.stringify(efecto));

console.log('\n════════ VERDICT ════════');
if (/coffee|caf/i.test(efecto)) {
  console.log('SURVIVES: the deferred approval was resolved in a different');
  console.log('          process and the tool RAN.');
  console.log('total spike cost USD:', (estado.coste_a + (resultado?.total_cost_usd || 0)).toFixed(6));
  process.exit(0);
} else {
  console.log('DOES NOT SURVIVE: process B resumed but the tool did not run.');
  console.log('                  Time for plan B (see ARCHITECTURE.md §2).');
  process.exit(2);
}
