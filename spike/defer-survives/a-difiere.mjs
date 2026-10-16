/* PROCESS A — asks for an expense, the hook DEFERS, and the process dies.

   All that's kept for process B is what would survive a real restart: the
   session_id and the tool left pending. Nothing in memory. */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import { prepararDir, hooks, OPCIONES_BASE, ESTADO, EFECTO } from './shared.mjs';

prepararDir();
fs.rmSync(EFECTO, { force: true });
fs.rmSync(ESTADO, { force: true });

console.log('── PROCESS A (pid ' + process.pid + ') ──');

let resultado = null;
for await (const m of query({
  prompt: 'Log an expense of 12.50 for "meeting coffee". Use the tool.',
  options: { ...OPCIONES_BASE, hooks: hooks('defer', 'waiting for human approval') }
})) {
  if (m.type === 'system' && m.subtype === 'init') {
    console.log('  session:', m.session_id);
    console.log('  [init] mcp_servers:', JSON.stringify(m.mcp_servers));
    console.log('  [init] tools with "spike":', JSON.stringify((m.tools||[]).filter(t=>String(t).includes('spike'))));
  }
  if (m.type === 'result') resultado = m;
}

if (!resultado) {
  console.error('FAIL: no result message arrived');
  process.exit(1);
}

console.log('  terminal_reason:', resultado.terminal_reason);
console.log('  deferred_tool_use:', JSON.stringify(resultado.deferred_tool_use || null));
console.log('  cost USD:', resultado.total_cost_usd);

fs.writeFileSync(ESTADO, JSON.stringify({
  session_id: resultado.session_id,
  terminal_reason: resultado.terminal_reason,
  deferred_tool_use: resultado.deferred_tool_use || null,
  coste_a: resultado.total_cost_usd
}, null, 2));

const efectoTrasA = fs.existsSync(EFECTO) ? fs.readFileSync(EFECTO, 'utf8') : '';
console.log('  effect after A (must be EMPTY):', JSON.stringify(efectoTrasA));

/* A's contract: the tool did NOT run, and there's a record of which tool it
   was. If any of this fails, the rest of the spike is meaningless. */
if (efectoTrasA !== '') {
  console.error('FAIL: the defer did not prevent execution');
  process.exit(1);
}
if (resultado.terminal_reason !== 'tool_deferred') {
  console.error(`FAIL: expected terminal_reason=tool_deferred, got ${resultado.terminal_reason}`);
  process.exit(1);
}
console.log('  A OK: deferred and not executed\n');
