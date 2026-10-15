/* PROCESO B (variante 2) — reanuda con prompt VACÍO.

   La v1 pasaba "Continúa." y el hook no se disparó: el turno de usuario nuevo
   parece descartar la llamada pendiente. La doc dice que al reanudar "the same
   tool call fires PreToolUse again", así que la hipótesis es que sobra el
   prompt. Aquí se registra TODO lo que llega, para no volver a concluir a
   ciegas. */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import { hooks, OPCIONES_BASE, ESTADO, EFECTO } from './shared.mjs';

const estado = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
fs.rmSync(EFECTO, { force: true });

console.log('── PROCESO B2 (pid ' + process.pid + ') ──');
console.log('  reanudando:', estado.session_id, 'con prompt VACÍO');

let resultado = null;
for await (const m of query({
  prompt: process.argv[2] ?? '',
  options: { ...OPCIONES_BASE, resume: estado.session_id, forkSession: process.env.FORK==='1', hooks: hooks('allow', 'aprobado por el dueño') }
})) {
  if (m.type === 'assistant') {
    for (const b of m.message.content || []) {
      if (b.type === 'tool_use') console.log('  [assistant] tool_use ->', b.name);
      if (b.type === 'text' && b.text.trim()) console.log('  [assistant]', b.text.trim().slice(0, 120));
    }
  } else if (m.type === 'result') {
    resultado = m;
  } else if (m.type === 'system' && m.subtype === 'init') {
    /* La pregunta que zanja el asunto: ¿ve el proceso reanudado la herramienta? */
    console.log('  [init] mcp_servers:', JSON.stringify(m.mcp_servers));
    console.log('  [init] tools con "spike":',
      JSON.stringify((m.tools || []).filter((t) => String(t).includes('spike'))));
    console.log('  [init] nº total de tools:', (m.tools || []).length);
  } else if (m.type !== 'stream_event') {
    console.log('  [' + m.type + ']', m.subtype || '');
  }
}

console.log('  terminal_reason:', resultado?.terminal_reason);
const efecto = fs.existsSync(EFECTO) ? fs.readFileSync(EFECTO, 'utf8').trim() : '';
console.log('  efecto:', JSON.stringify(efecto));
console.log(efecto ? '\n>>> SE EJECUTÓ' : '\n>>> NO se ejecutó');
