/* Where do the ~25,000 tokens cached in every conversation come from?

   A "Hello" cost $0.0939 with 2 input tokens and 26 output tokens: the whole
   cost was the CACHE WRITE of a 24,937-token prefix. Before optimizing blind,
   we need to know whether that prefix is the claude_code preset's system
   prompt or the tool definitions.

   Several configurations, same prompt, same cheap model. The answer is
   `cache_creation_input_tokens`. */

import { query } from '@anthropic-ai/claude-agent-sdk';

const TODAS = ['Read', 'Glob', 'Grep', 'WebSearch', 'Bash', 'Write', 'Edit', 'NotebookEdit'];

const CASOS = [
  { etiqueta: 'current (8 tools, default preset)', tools: TODAS },
  { etiqueta: 'no tools, default preset', tools: [] },
  { etiqueta: 'no tools + own systemPrompt', tools: [],
    systemPrompt: 'You are the Acme orchestrator. Reply briefly.' },
  { etiqueta: '3 tools + own systemPrompt', tools: ['Read', 'Glob', 'Grep'],
    systemPrompt: 'You are the Acme orchestrator. Reply briefly.' }
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
    for await (const m of query({ prompt: 'Hello', options: opciones })) {
      if (m.type === 'result') r = m;
    }
    const u = r?.usage || {};
    console.log(
      `${String(u.cache_creation_input_tokens ?? 0).padStart(7)} tok cached · ` +
      `$${Number(r?.total_cost_usd || 0).toFixed(6)} · ${c.etiqueta}`);
  } catch (e) {
    console.log(`  ERROR · ${c.etiqueta} · ${e.message}`);
  }
}
