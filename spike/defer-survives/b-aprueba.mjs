/* PROCESO B — proceso NUEVO. Reanuda por session_id y aprueba.

   Arranca sin nada en memoria del proceso A: lo único que recibe es lo que
   estaba en disco. Es la simulación honesta de "el contenedor se reinició y
   el dueño aprueba desde el móvil una hora después". */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import { hooks, OPCIONES_BASE, ESTADO, EFECTO } from './shared.mjs';

const estado = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
console.log('── PROCESO B (pid ' + process.pid + ') ──');
console.log('  reanudando sesión:', estado.session_id);
console.log('  herramienta pendiente:', estado.deferred_tool_use?.name);

let resultado = null;
for await (const m of query({
  /* Sin prompt nuevo: no se le pide nada más, solo que continúe lo que
     quedó pendiente. Si hubiera que repetir la instrucción, el "defer" no
     estaría reanudando nada — estaría empezando otra vez. */
  prompt: 'Continúa.',
  options: {
    ...OPCIONES_BASE,
    resume: estado.session_id,
    hooks: hooks('allow', 'aprobado por el dueño')
  }
})) {
  if (m.type === 'result') resultado = m;
}

console.log('  terminal_reason:', resultado?.terminal_reason);
console.log('  coste USD:', resultado?.total_cost_usd);

const efecto = fs.existsSync(EFECTO) ? fs.readFileSync(EFECTO, 'utf8').trim() : '';
console.log('  efecto tras B:', JSON.stringify(efecto));

console.log('\n════════ VEREDICTO ════════');
if (efecto.includes('café') || /caf/i.test(efecto)) {
  console.log('SOBREVIVE: la aprobación diferida se resolvió en un proceso');
  console.log('           distinto y la herramienta SE EJECUTÓ.');
  console.log('coste total del spike USD:', (estado.coste_a + (resultado?.total_cost_usd || 0)).toFixed(6));
  process.exit(0);
} else {
  console.log('NO SOBREVIVE: el proceso B reanudó pero la herramienta no se');
  console.log('              ejecutó. Toca el plan B (ver ARCHITECTURE.md §2).');
  process.exit(2);
}
