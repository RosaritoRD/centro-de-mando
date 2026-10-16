/* Shared piece for the spike's two processes.

   The tool has an effect OBSERVABLE OUTSIDE THE PROCESS: it writes a line to a
   file. It's the only thing that answers the real question — "did it run?" —
   without depending on what the model says it did. If process B ends by saying
   "done, expense logged" but the file is empty, the answer is NO, however
   eloquent it was. */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const DIR = '/tmp/apm-spike';
export const EFECTO = path.join(DIR, 'efecto.log');
export const ESTADO = path.join(DIR, 'estado.json');

/* Cheap model on purpose: the spike tests plumbing, not intelligence.
   the owner pays for it and there's no reason to use Opus here. */
export const MODELO = 'claude-haiku-4-5';

export const TOOL_NAME = 'registrar_gasto';
/* MCP names reach the hook with this prefix. */
export const TOOL_FQN = `mcp__spike__${TOOL_NAME}`;

export function prepararDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

export const servidor = createSdkMcpServer({
  name: 'spike',
  version: '0.0.1',
  /* THE KEY TO THE SPIKE. Without this, on resume the model literally says the
     tool "is not available": by default an SDK server's tools sit behind tool
     search (`defer_loading`), and on the resume turn they never get loaded into
     the prompt. The pending call exists in the transcript, but the model can't
     emit it again because it can't see the tool.

     With alwaysLoad the tool is ALWAYS in the prompt. That's exactly the
     condition the docs hide under "if the deferred tool is no longer
     available when you resume". */
  alwaysLoad: true,
  tools: [
    tool(
      TOOL_NAME,
      'Logs an expense in the ledger. Use it when asked to log an expense.',
      { concepto: z.string(), importe: z.number() },
      async ({ concepto, importe }) => {
        fs.appendFileSync(EFECTO,
          `${new Date().toISOString()} pid=${process.pid} ${concepto} ${importe}\n`);
        return { content: [{ type: 'text', text: `logged: ${concepto} ${importe}` }] };
      }
    )
  ]
});

/* The hook. Each process sets `decision`: A defers, B allows.
   Both use EXACTLY the same code so the experiment's only variable is the
   decision. */
export function hooks(decision, motivo) {
  return {
    PreToolUse: [{
      matcher: TOOL_FQN,
      hooks: [async (input) => {
        console.log(`  [hook] ${input.tool_name} -> ${decision}`);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: decision,
            permissionDecisionReason: motivo
          }
        };
      }]
    }]
  };
}

export const OPCIONES_BASE = {
  model: MODELO,
  mcpServers: { spike: servidor },
  /* Allowlist tool by tool, never a wildcard: that's the rule from report A. */
  allowedTools: [TOOL_FQN],
  /* No disk or network tools: the spike doesn't need them and each one is
     extra surface. */
  settingSources: [],
  maxTurns: 4
};
