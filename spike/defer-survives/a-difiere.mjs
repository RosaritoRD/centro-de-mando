/* PROCESO A — pide un gasto, el hook DIFIERE, y el proceso muere.

   Lo que se guarda para el proceso B es solo lo que sobreviviría a un
   reinicio real: el session_id y la herramienta que quedó pendiente. Nada
   en memoria. */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import { prepararDir, hooks, OPCIONES_BASE, ESTADO, EFECTO } from './shared.mjs';

prepararDir();
fs.rmSync(EFECTO, { force: true });
fs.rmSync(ESTADO, { force: true });

console.log('── PROCESO A (pid ' + process.pid + ') ──');

let resultado = null;
for await (const m of query({
  prompt: 'Registra un gasto de 12.50 por "café de la reunión". Usa la herramienta.',
  options: { ...OPCIONES_BASE, hooks: hooks('defer', 'espera aprobación humana') }
})) {
  if (m.type === 'system' && m.subtype === 'init') {
    console.log('  sesión:', m.session_id);
    console.log('  [init] mcp_servers:', JSON.stringify(m.mcp_servers));
    console.log('  [init] tools con "spike":', JSON.stringify((m.tools||[]).filter(t=>String(t).includes('spike'))));
  }
  if (m.type === 'result') resultado = m;
}

if (!resultado) {
  console.error('FALLO: no llegó ningún mensaje result');
  process.exit(1);
}

console.log('  terminal_reason:', resultado.terminal_reason);
console.log('  deferred_tool_use:', JSON.stringify(resultado.deferred_tool_use || null));
console.log('  coste USD:', resultado.total_cost_usd);

fs.writeFileSync(ESTADO, JSON.stringify({
  session_id: resultado.session_id,
  terminal_reason: resultado.terminal_reason,
  deferred_tool_use: resultado.deferred_tool_use || null,
  coste_a: resultado.total_cost_usd
}, null, 2));

const efectoTrasA = fs.existsSync(EFECTO) ? fs.readFileSync(EFECTO, 'utf8') : '';
console.log('  efecto tras A (debe estar VACÍO):', JSON.stringify(efectoTrasA));

/* El contrato de A: la herramienta NO se ejecutó y quedó constancia de cuál
   era. Si algo de esto falla, el resto del spike no tiene sentido. */
if (efectoTrasA !== '') {
  console.error('FALLO: el defer no impidió la ejecución');
  process.exit(1);
}
if (resultado.terminal_reason !== 'tool_deferred') {
  console.error(`FALLO: esperaba terminal_reason=tool_deferred, llegó ${resultado.terminal_reason}`);
  process.exit(1);
}
console.log('  A OK: diferido y sin ejecutar\n');
