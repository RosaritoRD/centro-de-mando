/* Pieza común de los dos procesos del spike.

   La herramienta tiene un EFECTO OBSERVABLE FUERA DEL PROCESO: escribe una
   línea en un archivo. Es lo único que responde a la pregunta de verdad —
   "¿se ejecutó?"— sin depender de lo que el modelo diga que hizo. Si el
   proceso B termina diciendo "listo, gasto registrado" pero el archivo está
   vacío, la respuesta es NO y da igual lo elocuente que fuera. */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const DIR = '/tmp/apm-spike';
export const EFECTO = path.join(DIR, 'efecto.log');
export const ESTADO = path.join(DIR, 'estado.json');

/* Modelo barato a propósito: el spike prueba fontanería, no inteligencia.
   Lo paga el dueño y no hay razón para usar Opus en esto. */
export const MODELO = 'claude-haiku-4-5';

export const TOOL_NAME = 'registrar_gasto';
/* Los nombres MCP llegan al hook con este prefijo. */
export const TOOL_FQN = `mcp__spike__${TOOL_NAME}`;

export function prepararDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

export const servidor = createSdkMcpServer({
  name: 'spike',
  version: '0.0.1',
  /* CLAVE DEL SPIKE. Sin esto, al reanudar el modelo dice literalmente que la
     herramienta "no está disponible": por defecto las tools de un servidor SDK
     quedan detrás de la búsqueda de herramientas (`defer_loading`), y en el
     turno de reanudación no llegan a cargarse en el prompt. La llamada
     pendiente existe en el transcript, pero el modelo no puede volver a
     emitirla porque no ve la herramienta.

     Con alwaysLoad la tool va SIEMPRE en el prompt. Es exactamente la
     condición que la doc esconde bajo "if the deferred tool is no longer
     available when you resume". */
  alwaysLoad: true,
  tools: [
    tool(
      TOOL_NAME,
      'Registra un gasto en el libro. Úsala cuando te pidan registrar un gasto.',
      { concepto: z.string(), importe: z.number() },
      async ({ concepto, importe }) => {
        fs.appendFileSync(EFECTO,
          `${new Date().toISOString()} pid=${process.pid} ${concepto} ${importe}\n`);
        return { content: [{ type: 'text', text: `registrado: ${concepto} ${importe}` }] };
      }
    )
  ]
});

/* El hook. `decision` la pone cada proceso: A difiere, B permite.
   Los dos usan EXACTAMENTE el mismo código para que la única variable del
   experimento sea la decisión. */
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
  /* Lista blanca tool por tool, nunca comodín: es la regla del informe A. */
  allowedTools: [TOOL_FQN],
  /* Sin herramientas de disco ni de red: el spike no las necesita y cada una
     es superficie de más. */
  settingSources: [],
  maxTurns: 4
};
