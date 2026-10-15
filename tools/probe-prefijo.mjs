/* ¿De dónde salen los ~25.000 tokens que se cachean en cada conversación?

   Un "Hola" costó $0.0939 con 2 tokens de entrada y 26 de salida: el coste
   entero era la ESCRITURA EN CACHÉ de un prefijo de 24.937 tokens. Antes de
   optimizar a ciegas hay que saber si ese prefijo es el system prompt del
   preset claude_code o las definiciones de las herramientas.

   Tres configuraciones, mismo prompt, mismo modelo barato. La respuesta es
   `cache_creation_input_tokens`. */

import { query } from '@anthropic-ai/claude-agent-sdk';

const TODAS = ['Read', 'Glob', 'Grep', 'WebSearch', 'Bash', 'Write', 'Edit', 'NotebookEdit'];

const CASOS = [
  { etiqueta: 'actual (8 tools, preset por defecto)', tools: TODAS },
  { etiqueta: 'sin herramientas, preset por defecto', tools: [] },
  { etiqueta: 'sin herramientas + systemPrompt propio', tools: [],
    systemPrompt: 'Eres el orquestador de tu empresa. Responde en español, breve.' },
  { etiqueta: '3 tools + systemPrompt propio', tools: ['Read', 'Glob', 'Grep'],
    systemPrompt: 'Eres el orquestador de tu empresa. Responde en español, breve.' }
];

for (const c of CASOS) {
  const opciones = {
    model: 'claude-haiku-4-5',
    cwd: '/workspace',
    allowedTools: c.tools,
    tools: c.tools,
    settingSources: [],
    maxTurns: 1,
    ...(c.systemPrompt ? { systemPrompt: c.systemPrompt } : {})
  };
  let r = null;
  try {
    for await (const m of query({ prompt: 'Hola', options: opciones })) {
      if (m.type === 'result') r = m;
    }
    const u = r?.usage || {};
    console.log(
      `${String(u.cache_creation_input_tokens ?? 0).padStart(7)} tok cacheados · ` +
      `$${Number(r?.total_cost_usd || 0).toFixed(6)} · ${c.etiqueta}`);
  } catch (e) {
    console.log(`  ERROR · ${c.etiqueta} · ${e.message}`);
  }
}
