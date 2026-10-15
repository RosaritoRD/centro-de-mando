# Categoría A — Núcleo de agentes: Claude Agent SDK (TypeScript)

**Investigación verificada el 2026-08-02.** Todo lo que aparece aquí fue comprobado por descarga directa de la documentación oficial (`.md` crudo, no resumen) y de las APIs de GitHub y npm. Lo que no pude verificar está marcado explícitamente como **NO VERIFICADO**.

> ⚠️ **Cambio de dominio importante:** `https://platform.claude.com/docs/en/agent-sdk/*` responde **307 Temporary Redirect** hacia `https://code.claude.com/docs/en/agent-sdk/*`. La documentación del Agent SDK ya **no** vive en `platform.claude.com`. Cualquier enlace guardado con el dominio viejo hay que actualizarlo.

---

## 1. Tabla de fuentes

| Fuente | URL | Fecha / versión verificada | Qué confirma |
|---|---|---|---|
| Agent SDK overview | https://code.claude.com/docs/en/agent-sdk/overview | consultada 2026-08-02 | Qué es el SDK, licencia comercial, prohibición de login claude.ai para terceros |
| Referencia TypeScript | https://code.claude.com/docs/en/agent-sdk/typescript.md | consultada 2026-08-02 (265 KB de markdown) | Tipos exactos: `Options`, `AgentDefinition`, `CanUseTool`, `PermissionResult`, `SDKResultMessage`, `HookEvent`, `createSdkMcpServer`, `tool()` |
| Subagents in the SDK | https://code.claude.com/docs/en/agent-sdk/subagents.md | consultada 2026-08-02 | Aislamiento de contexto, qué hereda un subagente, modelo por subagente, resume de subagentes |
| Configure permissions | https://code.claude.com/docs/en/agent-sdk/permissions.md | consultada 2026-08-02 | Orden de evaluación de permisos (6 pasos), modos |
| Handle approvals and user input | https://code.claude.com/docs/en/agent-sdk/user-input.md | consultada 2026-08-02 | `canUseTool` puede quedar pendiente **indefinidamente**; alternativa `defer` |
| Hooks (SDK) | https://code.claude.com/docs/en/agent-sdk/hooks.md | consultada 2026-08-02 | Tabla de 31 eventos, matchers, timeouts por evento |
| Hooks (Claude Code, sección defer) | https://code.claude.com/docs/en/hooks.md | consultada 2026-08-02 | Round-trip completo de `permissionDecision: "defer"` |
| Work with sessions | https://code.claude.com/docs/en/agent-sdk/sessions.md | consultada 2026-08-02 | Captura de `session_id`, `resume`, `forkSession` |
| Persist sessions to external storage | https://code.claude.com/docs/en/agent-sdk/session-storage.md | consultada 2026-08-02 | Interfaz `SessionStore` (S3/Redis/Postgres) — **clave para multi-usuario** |
| Hosting the Agent SDK | https://code.claude.com/docs/en/agent-sdk/hosting.md | consultada 2026-08-02 | Modelo de subproceso, Dockerfile, RAM/CPU, aislamiento multi-tenant |
| Securely deploying AI agents | https://code.claude.com/docs/en/agent-sdk/secure-deployment.md | consultada 2026-08-02 | Flags de `docker run` endurecidas, patrón proxy de credenciales |
| Track cost and usage | https://code.claude.com/docs/en/agent-sdk/cost-tracking.md | consultada 2026-08-02 | `total_cost_usd`, `usage`, `modelUsage`, deduplicación por `message.id` |
| Give Claude custom tools | https://code.claude.com/docs/en/agent-sdk/custom-tools.md | consultada 2026-08-02 | `tool()` + `createSdkMcpServer()` in-process |
| Quickstart (auth) | https://code.claude.com/docs/en/agent-sdk/quickstart.md | consultada 2026-08-02 | Node 18+, `ANTHROPIC_API_KEY`, binario CLI incluido |
| npm registry | https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk | **v0.3.220**, publicada **2026-07-24T23:11:19Z** | Versión, engines, peerDeps, binarios opcionales por plataforma |
| GitHub API — SDK TS | https://api.github.com/repos/anthropics/claude-agent-sdk-typescript | push **2026-07-25**, 1 668 ★, 176 issues abiertas, no archivado | Mantenido activamente (releases casi diarias) |
| GitHub API — demos | https://api.github.com/repos/anthropics/claude-agent-sdk-demos | push **2026-03-13**, 2 698 ★, 33 issues, no archivado | **Demos desactualizadas ~5 meses** frente al SDK |
| README del repo TS | https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/README.md | consultado 2026-08-02 | Licencia = Anthropic Commercial ToS, **no OSS** |

**Cadencia de publicación npm verificada** (últimas 5): 0.3.216 (2026-07-20), 0.3.217 (07-21), 0.3.218 (07-22), 0.3.219 (07-24), 0.3.220 (07-24). Es decir, **release casi diaria**. Los últimos commits del repo son todos `chore: Update CHANGELOG.md` — el código fuente real **no** está en ese repo (`language: Shell`); es un repo de distribución/changelog/issues.

---

## 2. `AgentDefinition`: campos exactos

Copiado literal de https://code.claude.com/docs/en/agent-sdk/typescript.md (sección `### AgentDefinition`):

```typescript
type AgentDefinition = {
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  prompt: string;
  model?: string;
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];
  initialPrompt?: string;
  maxTurns?: number;
  background?: boolean;
  memory?: "user" | "project" | "local";
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | number;
  permissionMode?: PermissionMode;
  criticalSystemReminder_EXPERIMENTAL?: string;
};
```

Solo **`description` y `prompt` son obligatorios**. No existe campo `systemPrompt` ni `instructions` dentro de `AgentDefinition` (el prompt del sistema del subagente **es** el campo `prompt`).

Snippet real de uso, copiado de https://code.claude.com/docs/en/agent-sdk/subagents.md:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Review the authentication module for security issues",
  options: {
    // Auto-approve these tools, including Agent for subagent invocation
    allowedTools: ["Read", "Grep", "Glob", "Agent"],
    agents: {
      "code-reviewer": {
        // description tells Claude when to use this subagent
        description:
          "Expert code review specialist. Use for quality, security, and maintainability reviews.",
        // prompt defines the subagent's behavior and expertise
        prompt: `You are a code review specialist with expertise in security, performance, and best practices.

When reviewing code:
- Identify security vulnerabilities
- Check for performance issues
- Verify adherence to coding standards
- Suggest specific improvements

Be thorough but concise in your feedback.`,
        // tools restricts what the subagent can do (read-only here)
        tools: ["Read", "Grep", "Glob"],
        // model overrides the default model for this subagent
        model: "sonnet"
      },
      "test-runner": {
        description:
          "Runs and analyzes test suites. Use for test execution and coverage analysis.",
        prompt: `You are a test execution specialist. Run tests and provide clear analysis of results.

Focus on:
- Running test commands
- Analyzing test output
- Identifying failing tests
- Suggesting fixes for failures`,
        // Bash access lets this subagent run test commands
        tools: ["Bash", "Read", "Grep"]
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

**Detalle operativo crítico:** hay que incluir **`"Agent"`** en `allowedTools` o las invocaciones de subagentes caen en `canUseTool` (o se deniegan en modo `dontAsk`). Documentado en la sección "Troubleshooting → Claude not delegating to subagents".

También se pueden definir subagentes como archivos markdown en `.claude/agents/`. Los definidos programáticamente **tienen prioridad** sobre los de disco con el mismo nombre.

---

## 3. Aislamiento de contexto por subagente

Cita literal (subagents.md → "Context isolation"):

> Each subagent runs in its own fresh conversation. Intermediate tool calls and results stay inside the subagent; only its final message returns to the parent.

Y la tabla exacta de qué hereda (subagents.md → "What subagents inherit"):

| El subagente **recibe** | El subagente **NO recibe** |
|---|---|
| Su propio system prompt (`AgentDefinition.prompt`) y el prompt de la herramienta `Agent` | El historial de conversación ni los resultados de herramientas del padre |
| El CLAUDE.md del proyecto (cargado vía `settingSources`) | Contenido de skills precargadas, salvo que se listen en `AgentDefinition.skills` |
| Definiciones de herramientas (heredadas del padre o el subconjunto de `tools`) | El system prompt del padre |

> "A subagent's context window starts fresh, with no parent conversation, but isn't empty. The only content you pass from parent to subagent is the Agent tool's prompt string, so include any file paths, error messages, or decisions the subagent needs directly in that prompt."

**Respuesta directa:** NO comparte historial con el orquestador. El único canal padre→hijo es el string del prompt de la llamada a `Agent`; el único canal hijo→padre es el mensaje final del subagente (que el padre puede resumir).

Consecuencias verificadas que afectan al diseño de APM:

- **Los subagentes corren en background por defecto** desde Claude Code v2.1.198. Si el orquestador omite `run_in_background`, la llamada es no bloqueante. `background: true` en la `AgentDefinition` fuerza background siempre.
- **Anidamiento:** por defecto un subagente puede lanzar subagentes hasta **3 capas** por debajo de la conversación principal (v2.1.219+). Se controla con `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; ponerlo a `1` desactiva el anidamiento.
- **La herramienta se llama `Agent`, no `Task`.** Renombrada en Claude Code v2.1.63. Las versiones actuales emiten `"Agent"` en los bloques `tool_use` pero **siguen usando `"Task"`** en la lista de herramientas de `system:init` y en `result.permission_denials[].tool_name`. Hay que comprobar ambos valores.
- **Escaneo de la salida del subagente** (v2.1.210+): antes de que el padre lea el mensaje final, Claude Code neutraliza patrones con forma de instrucción (`<system-reminder>`, `Human:`/`Assistant:`, menciones a la configuración de permisos) y antepone una línea `[harness: ...]`. Nunca borra ni reescribe texto. Es una mitigación de prompt-injection agente-a-agente que ya viene de serie.
- Los transcripts de subagentes **persisten aparte** del principal y sobreviven a la compactación del hilo principal. Se pueden reanudar por `agentId` (que aparece como texto `agentId: <id>` en el resultado de la herramienta `Agent`) reanudando la **misma sesión**. Los agentes integrados `Explore` y `Plan` son one-shot y **no** devuelven `agentId`.

---

## 4. Modelo distinto por subagente

**Sí.** Campo `model` en `AgentDefinition`. Valores aceptados, cita literal de la tabla de la referencia TypeScript:

> `model` — Model override for this agent. Accepts an alias such as `'fable'`, `'opus'`, `'sonnet'`, `'haiku'`, `'inherit'`, or a full model ID. If omitted or `'inherit'`, uses the main model.

Alias verificados: **`fable`, `opus`, `sonnet`, `haiku`, `inherit`**. También acepta el ID completo del modelo. Para la lista de IDs válidos la doc remite a `/docs/en/model-config#available-models` — **NO VERIFICADO**, no descargué esa página, así que no cito IDs concretos de modelo aquí.

Ejemplo real (subagents.md → "Dynamic agent configuration"):

```typescript
import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

function createSecurityAgent(securityLevel: "basic" | "strict"): AgentDefinition {
  const isStrict = securityLevel === "strict";
  return {
    description: "Security code reviewer",
    prompt: `You are a ${isStrict ? "strict" : "balanced"} security reviewer...`,
    tools: ["Read", "Grep", "Glob"],
    // Key insight: use a more capable model for high-stakes reviews
    model: isStrict ? "opus" : "sonnet"
  };
}
```

El modelo principal se fija con `Options.model` (alias o nombre completo) y se puede cambiar en caliente con `query.setModel(model?)` (solo en modo streaming input; `undefined` o `"default"` restablece el modelo por defecto de la sesión).

`AgentDefinition` también acepta `effort` (`'low' | 'medium' | 'high' | 'xhigh' | 'max' | number`) y `maxTurns` por subagente — útil para acotar coste por rol.

---

## 5. Sesiones para un servicio web multi-usuario con reinicios

### 5.1 Dónde guarda el estado por defecto

Cita literal de hosting.md:

| Estado | Ubicación por defecto |
|---|---|
| Transcripts de sesión | `~/.claude/projects/`, o el directorio `projects/` bajo `CLAUDE_CONFIG_DIR` si está definido |
| Ficheros de memoria `CLAUDE.md` | `~/.claude/CLAUDE.md` (nivel usuario) y el working directory de la sesión (nivel proyecto) |
| Artefactos del working directory | El working directory de la sesión |

> "None of them survive a container restart, a scale-down, or a move to a different node."

Además: **el SDK lanza un subproceso `claude` por sesión** y habla con él por stdio. Una sesión activa = un proceso. No es un wrapper stateless de API.

### 5.2 La respuesta correcta para APM: `sessionStore`

Existe una opción `sessionStore` en `Options` que espeja los transcripts a un backend externo (S3, Redis, Postgres o adaptador propio). Interfaz exacta (session-storage.md):

```typescript
// Exported from @anthropic-ai/claude-agent-sdk as
// SessionStore, SessionKey, SessionStoreEntry, SessionSummaryEntry.

type SessionKey = {
  projectKey: string;
  sessionId: string;
  subpath?: string;
};

type SessionStore = {
  // Required
  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
  load(key: SessionKey): Promise<SessionStoreEntry[] | null>;

  // Optional
  listSessions?(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>>;
  listSessionSummaries?(projectKey: string): Promise<SessionSummaryEntry[]>;
  delete?(key: SessionKey): Promise<void>;
  listSubkeys?(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]>;
};
```

Patrón "hybrid sessions" recomendado por Anthropic para exactamente nuestro caso (hosting.md):

```typescript
import { query, type SessionStore } from "@anthropic-ai/claude-agent-sdk";

declare const userInput: string;
declare const sessionId: string;          // looked up from your database by user
declare const sessionStore: SessionStore; // S3, Redis, Postgres, or your own adapter

for await (const message of query({
  prompt: userInput,
  options: { resume: sessionId, sessionStore },
})) {
  // ...
}
```

Comportamiento verificado del `SessionStore`:
- **Solo transcripts.** No espeja `CLAUDE.md` ni artefactos del working directory.
- **Espejo, no reemplazo.** El subproceso escribe primero en disco local; el store recibe una copia. Lo local sigue siendo autoritativo.
- **Fallos:** un batch rechazado se reintenta hasta 3 veces con backoff (un timeout no se reintenta). Si sigue fallando el SDK lo descarta, emite `{ type: "system", subtype: "mirror_error" }` y **continúa** la query. Hay que alertar sobre esos mensajes.
- `listSubkeys` es necesario para restaurar transcripts de subagentes; si no se implementa, solo se restaura el transcript principal.
- `forkSession` no es una copia byte a byte.
- `loadTimeoutMs` (default `60000`) acota cada `load()`/`listSubkeys()` — marcado como *Alpha* en la doc.
- `sessionStoreFlush: 'batched' | 'eager'` (default `'batched'`) — también *Alpha*.

### 5.3 `resume` / `forkSession` / `sessionId`

- El `session_id` se lee del campo `session_id` del mensaje `result` (presente en **todos** los results, éxito o error), y también antes en el `SDKSystemMessage` de init.
- `Options.resume: string` → ID de sesión a reanudar.
- `Options.forkSession: boolean` (default `false`) → al reanudar, bifurca a un ID nuevo en vez de continuar el original.
- `Options.sessionId: string` → **permite fijar tú el UUID de la sesión** en vez de que se autogenere. Muy útil para atarlo a una fila de nuestra BD.
- `Options.persistSession: boolean` (default `true`) → a `false` desactiva la persistencia en disco (la sesión no se puede reanudar).
- `Options.resumeSessionAt: string` → reanudar en un UUID de mensaje concreto.
- `Options.continue: boolean` → continúa la conversación más reciente (requiere `listSessions` en el store si se usa `sessionStore`).

Captura del ID (sessions.md), snippet real:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

let sessionId: string | undefined;

try {
  for await (const message of query({
    prompt: "Analyze the auth module and suggest improvements",
    options: { allowedTools: ["Read", "Glob", "Grep"] }
  })) {
    if (message.type === "result") {
      sessionId = message.session_id;
      if (message.subtype === "success") {
        console.log(message.result);
      }
    }
  }
} catch (error) {
  // A single-shot query() throws after yielding an error result. If the
  // failure was an error result, the loop above already captured sessionId;
  // process failures yield no result message, so sessionId stays undefined.
  console.error(`Session ended with an error: ${error}`);
}
```

⚠️ Nótese el `try/catch`: **una `query()` single-shot lanza excepción después de emitir el result de error**. Hay que envolverla siempre.

### 5.4 Aislamiento multi-tenant (obligatorio en APM)

Snippet literal de hosting.md → "Multi-tenant isolation":

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

declare const prompt: string;
declare const tenantDir: string;
declare const configDir: string;

for await (const message of query({
  prompt,
  options: {
    cwd: tenantDir,
    settingSources: [],
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
  },
})) {
  // ...
}
```

Las cuatro medidas, textuales:
1. `settingSources: []` para que no cargue ninguna configuración del sistema de ficheros.
2. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` — **la "auto memory" de `~/.claude/projects/<project>/memory/` se carga en el system prompt INDEPENDIENTEMENTE de `settingSources`**. Sin este flag, hay fuga de contexto entre tenants.
3. `CLAUDE_CONFIG_DIR` apuntando a un directorio por tenant (si no, comparten `~/.claude.json`).
4. `cwd` por tenant, pasado **explícitamente en cada `query()`**.

Más: reglas de egress por tenant en el proxy (IPs, credenciales, allowlists de dominio distintas).

`SettingSource` verificado:
```typescript
type SettingSource = "user" | "project" | "local";
```
| Valor | Ubicación |
|---|---|
| `'user'` | `~/.claude/settings.json` |
| `'project'` | `.claude/settings.json` |
| `'local'` | `.claude/settings.local.json` |

Si se omite `settingSources`, **carga las tres** (igual que el CLI). Precedencia: local > project > user; las opciones programáticas ganan a las tres; la política gestionada (managed) gana a todo.

### 5.5 Escalado

Fórmula literal de hosting.md:
```text
agents per host = (host RAM - overhead) / (per-session RAM ceiling)
```
Punto de partida recomendado: **1 GiB RAM, 5 GiB disco y 1 CPU por agente**. Para el patrón "long-running sessions", pool de contenedores tras un balanceador con **hashing consistente sobre `sessionId`** para fijar cada sesión a su contenedor.

Limitaciones conocidas declaradas por Anthropic:
- **No hay timeout de sesión de alto nivel.** Una sesión no expira sola; acótala con `maxTurns`.
- Crecimiento de memoria en sesiones largas → reciclar subprocesos.
- Fan-outs grandes de subagentes paralelos pueden chocar con rate limits → batches pequeños.
- **No hay deadline de reloj por subagente**; solo `maxTurns` por `AgentDefinition` y `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` (watchdog de estancamiento, solo para subagentes en background, default `600000` ms).

---

## 6. `canUseTool`: firma exacta y aprobación humana asíncrona

Firma literal (typescript.md):

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
    requestId: string;
  }
) => Promise<PermissionResult | null>;
```

Retorno:

```typescript
type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };
```

Snippet real (user-input.md):

```typescript
canUseTool: async (toolName, input) => {
  // ...
  if (response.toLowerCase() === "y") {
    // Allow: tool executes with the original (or modified) input
    return { behavior: "allow", updatedInput: input };
  } else {
    // Deny: tool doesn't execute, Claude sees the message
    return { behavior: "deny", message: "User denied this action" };
  }
}
```

### ¿Se puede bloquear la promesa? ¿Hay timeout?

Cita textual de user-input.md, párrafo introductorio:

> "The callback can stay pending indefinitely. Execution remains paused until your callback returns, and the SDK only cancels the wait when the query itself is cancelled. If a user might take longer to respond than your process can reasonably stay running, return the [`defer` hook decision], which lets the process exit and resume later from the persisted session."

Y en la referencia de tipos:

> "Returning `null` in any other case leaves the tool call blocked indefinitely, because no `control_response` is ever sent and **permission prompts don't time out**."

**Respuesta directa: sí se puede bloquear la promesa, y NO hay timeout.** Para APM eso significa dos caminos:

**Camino A — mantener la promesa viva** (el usuario aprueba desde la UI en minutos). Funciona mientras el proceso Node y el subproceso `claude` sigan vivos. Frágil ante un `docker compose up --build`.

**Camino B — `defer` (recomendado para APM, sobrevive a reinicios).** Round-trip verificado (code.claude.com/docs/en/hooks.md → "Defer a tool call for later"):

1. Claude llama a la herramienta. Se dispara el hook `PreToolUse`.
2. El hook devuelve `permissionDecision: "defer"`. La herramienta no se ejecuta. El proceso **sale** con `stop_reason: "tool_deferred"` y la llamada pendiente preservada en el transcript.
3. Tu proceso lee `deferred_tool_use` del result del SDK, muestra la petición en tu UI y espera respuesta.
4. Tu proceso reanuda con `resume: <session-id>`. La misma llamada dispara `PreToolUse` otra vez.
5. El hook devuelve `permissionDecision: "allow"` con la respuesta en `updatedInput`. La herramienta se ejecuta y Claude sigue.

Payload real:
```json
{
  "type": "result",
  "subtype": "success",
  "stop_reason": "tool_deferred",
  "session_id": "abc123",
  "deferred_tool_use": {
    "id": "toolu_01abc",
    "name": "AskUserQuestion",
    "input": { "questions": [{ "question": "Which framework?", "header": "Framework", "options": [{"label": "React"}, {"label": "Vue"}], "multiSelect": false }] }
  }
}
```

> "There is no timeout or retry limit. The session remains on disk until you resume it, subject to the `cleanupPeriodDays` retention sweep that deletes session files after 30 days by default."

**Restricción dura de `defer`:** solo funciona si Claude hace **una única** llamada a herramienta en ese turno. Si hace varias a la vez, `defer` se ignora con un warning y la herramienta pasa por el flujo normal de permisos. Además `defer` solo se honra en modo no interactivo (`-p`), que es el caso del SDK.

Si al reanudar la herramienta ya no existe (p. ej. un servidor MCP no conectado), el proceso sale con `stop_reason: "tool_deferred_unavailable"` e `is_error: true`.

### Otras trampas de `canUseTool` verificadas

- **No se invoca para herramientas auto-aprobadas.** El orden de evaluación es: **1) Hooks → 2) reglas deny → 3) reglas ask → 4) permission mode → 5) reglas allow → 6) `canUseTool`**. Si pones `"Bash"` a secas en `allowedTools`, tu callback **nunca** verá una llamada a Bash.
- Para lógica que deba aplicarse a **todas** las llamadas, la doc dice explícitamente: usa un hook `PreToolUse`, no `canUseTool`.
- Desde v2.1.198 el SDK TypeScript emite un `process warning` con código `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` si pasas un `canUseTool` inalcanzable (por `bypassPermissions` o por entradas "pelonas" en `allowedTools`). Conviene escucharlo en desarrollo.
- `AskUserQuestion`, las herramientas MCP marcadas `requiresUserInteraction` y las de conectores que la organización puso en `ask` **siempre** llegan al callback, incluso con regla allow. En modo `dontAsk` se deniegan sin invocarlo.
- Antes de Claude Code v2.1.207, un `allow` sin `updatedInput` se rechazaba con error de validación. Con SDK actual ya no hace falta, pero pasar `updatedInput: input` es lo más seguro.
- `query.reinitialize()` (Claude Code v2.1.195+) reenvía el `initialize` tras un corte de transporte para que las peticiones de permiso pendientes vuelvan a llegar al callback. **Haz el callback idempotente por `requestId`**, porque una petición cuya respuesta se perdió se vuelve a despachar.
- El retorno `null` es para cuando tu app ya envió el `control_response` por su propio canal (p. ej. un POST HTTP firmado) haciendo eco de `requestId`. Requiere Claude Code v2.1.199+.

`PermissionMode` verificado:
```typescript
type PermissionMode =
  | "default"            // Standard permission behavior
  | "acceptEdits"        // Auto-accept file edits
  | "bypassPermissions"  // Bypass permission checks; explicit ask rules still prompt
  | "plan"               // Planning mode - explore without editing
  | "dontAsk"            // Don't prompt for permissions, deny if not pre-approved
  | "auto";              // Model classifier approves or denies permission prompts
```
`bypassPermissions` exige además `allowDangerouslySkipPermissions: true`.

---

## 7. Hooks: eventos, firma y capacidad de denegar

Lista completa y literal (`HookEvent`, typescript.md) — **31 eventos**:

```typescript
type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PostToolBatch"
  | "Notification"
  | "UserPromptSubmit"
  | "UserPromptExpansion"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "StopFailure"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PostCompact"
  | "PermissionRequest"
  | "PermissionDenied"
  | "Setup"
  | "TeammateIdle"
  | "TaskCreated"
  | "TaskCompleted"
  | "Elicitation"
  | "ElicitationResult"
  | "ConfigChange"
  | "DirectoryAdded"
  | "WorktreeCreate"
  | "WorktreeRemove"
  | "InstructionsLoaded"
  | "CwdChanged"
  | "FileChanged"
  | "MessageDisplay";
```

Firma:
```typescript
type HookCallback = (
  input: HookInput,               // Union of all hook input types
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;

interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;               // Timeout in seconds for all hooks in this matcher
}
```

Registro:
```typescript
for await (const message of query({
  prompt: "Your prompt",
  options: {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [myCallback] }]
    }
  }
})) {
  console.log(message);
}
```

### ¿Pueden denegar? Sí.

`SyncHookJSONOutput` (extracto literal, campos relevantes):

```typescript
type SyncHookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: "approve" | "block";
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?:
    | {
        hookEventName: "PreToolUse";
        permissionDecision?: "allow" | "deny" | "ask" | "defer";
        permissionDecisionReason?: string;
        updatedInput?: Record<string, unknown>;
        additionalContext?: string;
      }
    | {
        hookEventName: "PermissionRequest";
        decision:
          | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
          | { behavior: "deny"; message?: string; interrupt?: boolean };
      }
    // ... (resto de eventos)
};
```

Además existe la variante asíncrona:
```typescript
type AsyncHookJSONOutput = {
  async: true;
  asyncTimeout?: number;
};
```

`BaseHookInput` (todos los hooks lo extienden):
```typescript
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt_id?: string;
  permission_mode?: string;
  effort?: { level: string };
  agent_id?: string;
  agent_type?: string;
};
```
`agent_id`/`agent_type` se rellenan cuando el hook dispara **dentro de un subagente** — es el gancho natural para atribuir coste y auditoría por subagente en APM.

Timeouts de hooks verificados: cuando se omite `timeout`, Claude Code aplica el default del evento — **10 minutos** para la mayoría, **30 s** para `UserPromptSubmit`, **10 s** para `MessageDisplay`, presupuesto de **1,5 s** para `SessionEnd`.

Matchers: si contiene solo letras, dígitos, `_`, `-`, espacios, `,` y `|` → comparación exacta con alternativas separadas por `|` o `,`. Cualquier otro carácter → **regex sin anclar**. `*`, cadena vacía u omitirlo → matchea todo. Las herramientas MCP siguen `mcp__<server>__<action>`; `mcp__memory` a secas **no matchea nada**, hay que escribir `mcp__memory__.*`.

Un detalle del orden de evaluación que importa: **un hook que devuelve `allow` NO salta las reglas deny ni ask**; esas se evalúan igualmente.

---

## 8. `createSdkMcpServer` y `tool()`: herramientas custom in-process

Firmas literales (typescript.md):

```typescript
function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations; searchHint?: string; alwaysLoad?: boolean }
): SdkMcpToolDefinition<Schema>;

function createSdkMcpServer(options: {
  name: string;
  version?: string;
  instructions?: string;
  tools?: Array<SdkMcpToolDefinition<any>>;
  alwaysLoad?: boolean;
}): McpSdkServerConfigWithInstance;
```

Snippet real completo (custom-tools.md):

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Define a tool: name, description, input schema, handler
const getTemperature = tool(
  "get_temperature",
  "Get the current temperature at a location",
  {
    latitude: z.number().describe("Latitude coordinate"), // .describe() adds a field description Claude sees
    longitude: z.number().describe("Longitude coordinate")
  },
  async (args) => {
    // args is typed from the schema: { latitude: number; longitude: number }
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m&temperature_unit=fahrenheit`
    );
    const data: any = await response.json();

    // Return a content array - Claude sees this as the tool result
    return {
      content: [{ type: "text", text: `Temperature: ${data.current.temperature_2m}°F` }]
    };
  }
);

// Wrap the tool in an in-process MCP server
const weatherServer = createSdkMcpServer({
  name: "weather",
  version: "1.0.0",
  tools: [getTemperature]
});
```

Notas verificadas:
- El servidor se pasa en `Options.mcpServers`; la **clave** del objeto es el `{server_name}` del nombre cualificado `mcp__{server_name}__{tool_name}`. Hay que listar ese nombre completo en `allowedTools` para que corra sin prompt.
- `inputSchema` acepta **Zod 3 y Zod 4** (peerDependency declarada: `zod: ^4.0.0`).
- Opcionales en TS: `.default()` en el campo Zod.
- `alwaysLoad` (por herramienta o por servidor) mantiene el schema en el prompt inicial en vez de diferirlo detrás de *tool search*.
- Existe `Options.toolAliases`, p. ej. `{ Bash: 'mcp__workspace__bash' }`, para **sustituir una herramienta integrada por tu implementación MCP**. Interesante para APM si queremos un Bash controlado.
- `strictMcpConfig: true` ignora `.mcp.json` del proyecto, settings de usuario, MCP de plugins y conectores de claude.ai. **Recomendado en un servicio multi-tenant.**

---

## 9. Coste y uso por turno

Campos del `SDKResultMessage` (literal, rama de éxito):

```typescript
type SDKResultMessage =
  | {
      type: "result";
      subtype: "success";
      uuid: UUID;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      is_error: boolean;
      api_error_status?: number | null;
      num_turns: number;
      result: string;
      stop_reason: string | null;
      ttft_ms?: number;
      ttft_stream_ms?: number;
      user_message_uuid?: string;
      request_sent_wall_ms?: number;
      total_cost_usd: number;
      usage: NonNullableUsage;
      modelUsage: { [modelName: string]: ModelUsage };
      permission_denials: SDKPermissionDenial[];
      structured_output?: unknown;
      deferred_tool_use?: { id: string; name: string; input: Record<string, unknown> };
      terminal_reason?: TerminalReason;
      fast_mode_state?: FastModeState;
      fast_mode_disabled_reason?: FastModeDisabledReason;
      origin?: SDKMessageOrigin;
    }
  | {
      type: "result";
      subtype:
        | "error_max_turns"
        | "error_during_execution"
        | "error_max_budget_usd"
        | "error_max_structured_output_retries";
      /* ...mismos campos de coste: total_cost_usd, usage, modelUsage... */
      errors: string[];
    };
```

### ⚠️ Hallazgo que cambia el diseño de facturación

Tabla literal de cost-tracking.md:

| Campo | Actividad de subagentes |
|---|---|
| `usage` | **Excluida.** Cuenta solo el bucle del agente principal; los tokens consumidos dentro de subagentes NO se suman |
| `total_cost_usd` | **Incluida.** Cuenta las peticiones de subagentes junto al bucle principal |
| `modelUsage` / `model_usage` | **Incluida.** Desglosada por modelo |

> "Use `modelUsage` for whole-tree token accounting; the `usage` field undercounts as soon as nesting occurs."

En APM, que es un orquestador de subagentes, **usar `usage` para facturar sería subcontar sistemáticamente**. Hay que usar `total_cost_usd` (total) y `modelUsage` (desglose).

Snippet real de desglose por modelo:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

try {
  for await (const message of query({ prompt: "Summarize this project" })) {
    if (message.type !== "result") continue;

    for (const [modelName, usage] of Object.entries(message.modelUsage)) {
      console.log(`${modelName}: $${usage.costUSD.toFixed(4)}`);
      console.log(`  Input tokens: ${usage.inputTokens}`);
      console.log(`  Output tokens: ${usage.outputTokens}`);
      console.log(`  Cache read: ${usage.cacheReadInputTokens}`);
      console.log(`  Cache creation: ${usage.cacheCreationInputTokens}`);
    }
  }
} catch (error) {
  console.error(`Session ended with an error: ${error}`);
}
```

### En streaming (por paso)

Cada mensaje `assistant` lleva un `BetaMessage` anidado en `message.message` con `id` y `usage`. **Las llamadas a herramientas en paralelo producen varios mensajes con el MISMO `id` y el mismo `usage`** → hay que deduplicar por ID o inflas el contador. Snippet real:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const seenIds = new Set<string>();
let totalInputTokens = 0;
let totalOutputTokens = 0;

try {
  for await (const message of query({ prompt: "Summarize this project" })) {
    if (message.type === "assistant") {
      const msgId = message.message.id;

      // Parallel tool calls share the same ID, only count once
      if (!seenIds.has(msgId)) {
        seenIds.add(msgId);
        totalInputTokens += message.message.usage.input_tokens;
        totalOutputTokens += message.message.usage.output_tokens;
      }
    }
  }
} catch (error) {
  console.error(`Session ended with an error: ${error}`);
}
```

Otros datos verificados:
- **No hay total por sesión.** Cada `query()` reporta su propio `total_cost_usd`; acumular es responsabilidad nuestra.
- `Options.maxBudgetUsd` corta la query cuando la estimación de coste **cliente** alcanza ese valor; se compara contra la misma estimación que `total_cost_usd`. El result sale con `subtype: "error_max_budget_usd"` (y **sigue trayendo** los campos de coste).
- `total_cost_usd` es una **estimación del lado cliente**, no una factura. La doc lo llama "client-side cost estimate".
- `permission_denials` en el result permite auditar qué se bloqueó.
- OpenTelemetry: el SDK hereda la configuración del entorno (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_*`). Los prompts y las entradas de herramientas **no** se exportan por defecto.

---

## 10. Autenticación y runtime en servidor (crítico para el Dockerfile)

### ¿Basta `ANTHROPIC_API_KEY`?

**Sí.** hosting.md: *"the subprocess reads `ANTHROPIC_API_KEY` from its environment"*. quickstart.md: *"The SDK reads the key from the environment of the process that runs your agent; it doesn't load `.env` files automatically."* — si guardamos la clave en `.env`, hay que cargarla nosotros (p. ej. `dotenv`) antes de llamar al SDK.

Alternativas de proveedor verificadas: `CLAUDE_CODE_USE_BEDROCK=1`, `CLAUDE_CODE_USE_ANTHROPIC_AWS=1` + `ANTHROPIC_AWS_WORKSPACE_ID`, `CLAUDE_CODE_USE_VERTEX=1`, `CLAUDE_CODE_USE_FOUNDRY=1`. También `ANTHROPIC_BASE_URL` para enrutar por un proxy que inyecte la clave fuera del contenedor.

⚠️ **Restricción legal literal** (overview.md y quickstart.md):
> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

Es decir: **APM no puede dejar que los clientes se autentiquen con su suscripción de claude.ai.** O usamos nuestra API key (y facturamos), o cada tenant trae la suya.

### ¿Hace falta el CLI de Claude Code instalado en el contenedor?

**NO.** Verificado en dos sitios:

> "Both SDK packages bundle a native Claude Code binary for the host platform, so no separate Claude Code or Node.js install is needed for the spawned CLI" (hosting.md)

> "The SDK bundles a native Claude Code binary for your platform as an optional dependency such as `@anthropic-ai/claude-agent-sdk-darwin-arm64`. You don't need to install Claude Code separately. The SDK version tracks the bundled Claude Code version: SDK v0.3.191 bundles Claude Code v2.1.191... If your package manager skips optional dependencies, the SDK throws `Native CLI binary for <platform> not found`; set `pathToClaudeCodeExecutable` to a separately installed `claude` binary instead." (typescript.md)

**Consecuencias directas para nuestro Dockerfile:**
- **NO usar `npm ci --omit=optional` ni `--no-optional`.** Rompería el binario nativo.
- Los paquetes opcionales publicados (verificados en npm) son: `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`. **Hay variantes musl** → una imagen base Alpine sí es viable.
- Si compilamos a binario único con `bun build --compile`, hay que usar `extractFromBunfs()` y `pathToClaudeCodeExecutable`. No aplica si desplegamos con Node normal.
- **La versión del SDK ES la versión del CLI.** Actualizar el SDK es la única forma de actualizar el CLI. Correspondencia por número de parche: SDK v0.3.220 ⇒ Claude Code v2.1.220 (patrón documentado con el ejemplo v0.3.191 ⇒ v2.1.191; la correspondencia exacta de 0.3.220 es una inferencia mía, **NO VERIFICADA** directamente).

### Dependencias de runtime

| Elemento | Valor verificado | Fuente |
|---|---|---|
| Node.js | **>= 18.0.0** (`engines` del package) / "Node.js 18+" | npm registry + quickstart |
| Dependencias directas | **ninguna** (`dependencies: null`) | npm registry |
| peerDependencies | `zod: ^4.0.0`, `@anthropic-ai/sdk: >=0.93.0`, `@modelcontextprotocol/sdk: ^1.29.0` | npm registry |
| Runtime JS soportado | `'bun' \| 'deno' \| 'node'` (opción `executable`, autodetectado) | typescript.md |
| Recursos por agente | 1 GiB RAM, 5 GiB disco, 1 CPU (punto de partida) | hosting.md |
| Red saliente | HTTPS a `api.anthropic.com` (+ endpoints MCP) | hosting.md |
| Red entrante | El subproceso **no escucha en red**; tu app expone el puerto | hosting.md |

⚠️ **NO VERIFICADO:** si el binario nativo requiere `glibc`/`libstdc++` extra en una imagen `node:22-slim` (Debian). La doc no lo dice. Hay que probarlo empíricamente al construir la imagen.

⚠️ **NO VERIFICADO:** si el subproceso necesita `git`, `ripgrep` u otros binarios en el PATH para que las herramientas Grep/Glob/Bash funcionen. La doc dice "the container needs only your SDK's language runtime", pero eso se refiere al SDK, no a lo que las herramientas del agente puedan invocar. Hay que probarlo.

---

## 11. Despliegue seguro: recomendaciones oficiales

Configuración de contenedor endurecido, **copiada literal** de secure-deployment.md:

```bash
docker run \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt seccomp=/path/to/seccomp-profile.json \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --tmpfs /home/agent:rw,noexec,nosuid,size=500m \
  --network none \
  --memory 2g \
  --cpus 2 \
  --pids-limit 100 \
  --user 1000:1000 \
  -v /path/to/code:/workspace:ro \
  -v /var/run/proxy.sock:/var/run/proxy.sock:ro \
  agent-image
```

Aviso explícito de la doc sobre los volúmenes: *"**Avoid mounting sensitive host directories like `~/.ssh`, `~/.aws`, or `~/.config`**"*.

Tabla de tecnologías de aislamiento (literal):

| Tecnología | Fuerza de aislamiento | Overhead | Complejidad |
|---|---|---|---|
| Sandbox runtime | Buena (defaults seguros) | Muy bajo | Baja |
| Contenedores (Docker) | Depende del setup | Bajo | Media |
| gVisor | Excelente (con setup correcto) | Medio/Alto | Media |
| VMs (Firecracker, QEMU) | Excelente (con setup correcto) | Alto | Media/Alta |

Existe `@anthropic-ai/sandbox-runtime` (https://github.com/anthropic-experimental/sandbox-runtime): aislamiento OS-level sin Docker, con `bubblewrap` en Linux, allowlists JSON de dominios y rutas, y proxy incorporado. Limitación admitida: **no hace inspección TLS**, así que el allowlist se basa en el hostname que declara el cliente y es vulnerable a domain fronting.

Principio de credenciales (**el más relevante para APM**):
> "rather than giving an agent direct access to an API key, you could run a proxy outside the agent's environment that injects the key into requests. The agent can make API calls, but it never sees the credential itself. This pattern is useful for multi-tenant deployments."

Otras defensas de serie ya presentes en Claude Code:
- Parseo de comandos bash a AST antes de aplicar reglas de permiso; lo que no parsea limpio requiere aprobación explícita; `eval` siempre requiere aprobación. La doc aclara: *"This is a permission gate, not a sandbox"*.
- Los resultados de búsqueda web se resumen en vez de inyectarse crudos (mitigación de prompt injection).
- `Options.sandbox` (`SandboxSettings`) para configurar el modo sandbox programáticamente.

Auth en hosting (literal):
- **Entrante:** *"put authentication at a gateway in front of the agent container. The agent should receive pre-authenticated requests and should not be the component that validates user tokens."*
- **Salientes de herramientas:** *"keep tool credentials out of the agent environment. Route outbound calls through a proxy that injects API keys after the request leaves the container."*

---

## 12. Lo mejor valorado en GitHub (búsqueda abierta)

Búsqueda hecha con la GitHub Search API el 2026-08-02, ordenada por estrellas, sobre 4 consultas distintas (`ai agent framework language:TypeScript`, `agent sdk typescript stars:>500 pushed:>2026-02-01`, `llm agent orchestration language:TypeScript stars:>1000`, `agents framework language:TypeScript stars:>2000 pushed:>2026-05-01`). Estrellas, licencia y último push verificados uno a uno vía `api.github.com/repos/...`; versiones npm vía `registry.npmjs.org`.

| Repo | ★ | Licencia (GitHub / npm) | Último push | Issues abiertas | Paquete npm (latest, fecha) |
|---|---:|---|---|---:|---|
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra) | 26 826 | Other (npm `@mastra/core`: **Apache-2.0**) | 2026-08-02 | 594 | `@mastra/core` 1.55.0 (2026-07-30), engines **node >= 22.13** |
| [vercel/ai](https://github.com/vercel/ai) (AI SDK) | 25 958 | Other (npm `ai`: **Apache-2.0**) | 2026-08-02 | 1 714 | `ai` 7.0.48 (2026-08-01), engines **node >= 22** |
| [VoltAgent/voltagent](https://github.com/VoltAgent/voltagent) | 10 249 | **MIT** | 2026-07-13 | 79 | `@voltagent/core` 2.9.0 (2026-07-08) |
| [genkit-ai/genkit](https://github.com/genkit-ai/genkit) | 6 309 | **Apache-2.0** | 2026-08-01 | 672 | (no verificado) |
| [openai/openai-agents-js](https://github.com/openai/openai-agents-js) | 3 513 | **MIT** | 2026-08-02 | 33 | `@openai/agents` 0.14.2 (2026-08-01) |
| [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) | 3 167 | **MIT** | 2026-08-01 | 96 | `@langchain/langgraph` 1.4.8 (2026-07-15) |
| **anthropics/claude-agent-sdk-typescript** | **1 668** | **Ninguna OSS — Anthropic Commercial ToS** | 2026-07-25 | 176 | `@anthropic-ai/claude-agent-sdk` **0.3.220** (2026-07-24), engines node >= 18 |
| [inkeep/agents](https://github.com/inkeep/agents) | 1 340 | Other | 2026-07-31 | 37 | (no verificado) |

*(Nota: la búsqueda devolvió también repos con muchas estrellas que NO son frameworks de agentes comparables — `heygen-com/hyperframes`, `langgenius/dify`, `medusajs/medusa`, `elizaOS/eliza`, `humanlayer/12-factor-agents` (sin push desde 2025-09-21, muerto) — los he excluido de la tabla por no ser competencia directa del núcleo de agentes de APM.)*

### ¿Cambia esto nuestra decisión?

**No. Recomiendo seguir con el Claude Agent SDK**, pero conviene ser honesto sobre lo que estamos aceptando y sobre un riesgo real.

**Por qué gana el Claude Agent SDK para APM, pese a tener 15× menos estrellas:**

1. **Es lo único que trae el "harness" completo, no solo el bucle.** Mastra, VoltAgent, OpenAI Agents JS y LangGraph JS te dan orquestación, pero **tú tienes que construir** las herramientas de sistema de ficheros, el ejecutor de bash, el parseo de comandos a AST para permisos, la compactación de contexto, el checkpointing de archivos, los skills, y la persistencia de transcripts. El Agent SDK es literalmente Claude Code como librería: todo eso ya está y está probado a escala.
2. **APM es un "agent command center"**, y todo lo que necesitamos (subagentes con contexto aislado, hooks de 31 eventos, `canUseTool` con aprobación humana, `defer` que sobrevive a reinicios, `SessionStore` externo, `modelUsage` por modelo, aislamiento multi-tenant documentado) está **especificado y soportado**. Ninguno de los otros documenta el patrón "aprobación humana que tarda minutos y el proceso puede morir" con la profundidad de la sección `defer`.
3. **Cadencia de mantenimiento superior**: release npm casi diaria (5 versiones en 5 días). Mastra y Vercel AI también empujan a diario, pero VoltAgent lleva 3 semanas sin push y LangGraph JS publica cada ~2 semanas.
4. Node **>= 18** (los otros grandes, Mastra y Vercel AI, exigen **Node >= 22**). Menos fricción con nuestra base actual.

**Lo que estamos aceptando conscientemente (los contras, sin maquillar):**

1. 🔴 **Licencia. Este es el punto que más debe pesar.** El repo `anthropics/claude-agent-sdk-typescript` **no tiene licencia OSS** (`license: None` en la API de GitHub; npm dice `"SEE LICENSE IN README.md"`). El README remite a los *Anthropic Commercial Terms of Service*, "including when you use it to power products and services that you make available to your own customers and end users". **Mastra, VoltAgent, OpenAI Agents JS, LangGraph JS y Genkit son todos Apache-2.0 o MIT.** Si APM se va a vender como SaaS a terceros, esto hay que leerlo con calma antes de comprometer la arquitectura. Yo no soy abogado y **no he evaluado** si los Commercial ToS permiten nuestro modelo de reventa — lo marco como riesgo abierto, no como bloqueante.
2. 🔴 **Lock-in de proveedor.** El Agent SDK solo corre modelos Claude (directo, Bedrock, Vertex, Foundry). Mastra, Vercel AI SDK y LangGraph JS son multi-modelo. Si APM alguna vez necesita ofrecer GPT o Gemini, hay que reescribir el núcleo. Los demás lo dan gratis.
3. 🟡 **Arquitectura de subproceso.** Un proceso `claude` por sesión, ~1 GiB RAM cada uno. Mastra/VoltAgent/LangGraph corren **in-process**, así que su densidad por VPS es muy superior. En una VPS modesta, esto limita la concurrencia real de APM de forma seria. Es el coste de tener el harness completo.
4. 🟡 **`anthropics/claude-agent-sdk-demos` está desactualizado** (último push 2026-03-13, ~5 meses). No copiar patrones de ahí sin verificarlos contra la doc actual: la API ha cambiado bastante (p. ej. `Task` → `Agent`, subagentes en background por defecto).

**El único caso en que reconsideraría:** si el punto (1) resulta incompatible con vender APM a terceros, o si aparece el requisito de multi-modelo. En ese escenario **Mastra** (26,8 k ★, Apache-2.0, push diario, ecosistema de workflows/memoria/evals) sería el reemplazo más sensato, asumiendo que tendríamos que construir nosotros el harness de herramientas y permisos que hoy nos regala Anthropic. VoltAgent (MIT, 79 issues abiertas, muy limpio) es la alternativa más ligera si nos basta con orquestación.

---

## 13. ⚠️ Correcciones a supuestos previos

Cosas que la investigación previa daba por buenas y **no** lo son:

| Supuesto anterior | Realidad verificada |
|---|---|
| La doc del Agent SDK vive en `platform.claude.com/docs/en/agent-sdk/*` | **Redirige 307 a `code.claude.com/docs/en/agent-sdk/*`.** Hay que actualizar todos los enlaces. |
| `AgentDefinition` tiene campos `instructions` y/o `systemPrompt` | **Falso.** Los campos obligatorios son `description` y `prompt`. No existe `instructions` ni `systemPrompt` en `AgentDefinition`. (Un resumen automático de la página de referencia me devolvió una versión inventada con `instructions`/`systemPrompt`; leyendo el `.md` crudo se ve que no existen. Cuidado: **fetchear estas páginas con un resumidor produce tipos falsos**.) |
| `CanUseTool` recibe un objeto `CanUseToolRequest` con `tool_name`, `tool_use_id`, `raw_input` | **Falso.** La firma real son **3 argumentos posicionales**: `(toolName, input, options)`. |
| `PermissionResult` usa `{ allowed: true }` / `{ ask: true }` | **Falso.** Usa `{ behavior: "allow", updatedInput?, updatedPermissions?, toolUseID? }` o `{ behavior: "deny", message, interrupt?, toolUseID? }`. |
| `SDKResultMessage.usage` sirve para facturar | **Peligrosamente falso en APM.** `usage` **excluye** los tokens de subagentes. Para el árbol completo hay que usar `total_cost_usd` y `modelUsage`. |
| Hay que instalar el CLI de Claude Code en la imagen Docker | **Falso.** El paquete npm trae un binario nativo por plataforma como *optionalDependency*. Instalarlo aparte solo hace falta si se saltan las optional deps. |
| Node 20 o 22 mínimo | **Node >= 18.0.0** según `engines`. |
| La herramienta de subagentes se llama `Task` | Renombrada a **`Agent`** en Claude Code v2.1.63. Pero `Task` **sigue apareciendo** en `system:init.tools` y en `permission_denials[].tool_name` → hay que comprobar ambas. |
| Los subagentes corren en primer plano por defecto | Cambió en v2.1.198: **corren en background por defecto** si el modelo omite `run_in_background`. |
| El aislamiento multi-tenant se logra con `settingSources: []` | **Insuficiente.** La *auto memory* de `~/.claude/projects/<project>/memory/` se carga **ignorando `settingSources`**. Hace falta además `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CONFIG_DIR` por tenant y `cwd` por tenant. |
| `canUseTool` intercepta todas las llamadas a herramientas | **Falso.** Es el paso 6 de 6. Cualquier `allowedTools` "pelón", regla allow o modo `acceptEdits`/`bypassPermissions` lo cortocircuita. Para interceptar TODO hay que usar un hook `PreToolUse`. |
| Existe algún timeout de aprobación | **No existe.** Las promesas de permiso no expiran nunca. Ni en `canUseTool` ni en `defer`. |
| Las sesiones expiran solas | **No.** "No top-level session timeout". Hay que acotar con `maxTurns` y/o `maxBudgetUsd`. |
| El repo `claude-agent-sdk-demos` es una referencia actual | Último push **2026-03-13**, ~5 meses de retraso. Sus patrones pueden estar obsoletos. |
| El Agent SDK es open source | **No.** Sin licencia OSS; gobernado por los *Anthropic Commercial Terms of Service*. |

---

## 14. Riesgos e incógnitas (NO VERIFICADO)

1. **NO VERIFICADO — Licencia comercial y reventa.** No he leído los *Anthropic Commercial Terms of Service* completos. No puedo afirmar si APM puede facturar a terceros por uso del Agent SDK con nuestra API key, ni si cada tenant debe traer la suya. **Esto debe resolverse antes de comprometer la arquitectura.**
2. **NO VERIFICADO — IDs de modelo válidos.** No descargué `/docs/en/model-config#available-models`. Sé que se aceptan los alias `fable`/`opus`/`sonnet`/`haiku`/`inherit` y "un ID completo", pero **no cito ningún ID concreto** para no inventarlo.
3. **NO VERIFICADO — Dependencias de sistema del binario nativo.** Si `node:22-slim` o `node:22-alpine` necesitan paquetes extra (glibc, libstdc++, ca-certificates) para que el binario arranque. Hay que probarlo al construir la imagen.
4. **NO VERIFICADO — Binarios auxiliares en el PATH.** Si las herramientas Grep/Glob/Bash del agente requieren `ripgrep`, `git` u otros instalados en el contenedor.
5. **NO VERIFICADO — Correspondencia SDK 0.3.220 ⇄ Claude Code 2.1.220.** El patrón está documentado con el ejemplo v0.3.191 ⇒ v2.1.191; la extrapolación a 0.3.220 es inferencia mía. Se confirma en runtime leyendo `claude_code_version` del `SDKSystemMessage`.
6. **NO VERIFICADO — Adaptadores `SessionStore` de referencia.** La doc menciona implementaciones de referencia para S3, Redis y Postgres, más una *conformance suite*, en `session-storage#reference-implementations`. No descargué ese apartado ni verifiqué si el código es copiable o solo descriptivo.
7. **NO VERIFICADO — `SessionStore` + `defer` juntos.** No hay confirmación explícita de que una llamada diferida (`tool_deferred`) sobreviva a un reinicio de contenedor cuando el transcript está solo en el store externo y no en disco local. La doc dice que la sesión "remains on disk until you resume it". **Este es el punto de integración que hay que probar primero en un spike**, porque es la base del flujo de aprobación humana de APM.
8. **NO VERIFICADO — Comportamiento de `canUseTool` bajo `reinitialize()` en producción.** La doc advierte que hay que hacerlo idempotente por `requestId`, pero no he probado el escenario de reconexión.
9. **NO VERIFICADO — Consumo real de RAM.** El "1 GiB por agente" es el punto de partida oficial, explícitamente descrito como "a floor, not the ceiling". Hay que medir con nuestra carga real antes de dimensionar la VPS.
10. **NO VERIFICADO — `hosting cookbook`.** `github.com/anthropics/claude-cookbooks/tree/main/claude_agent_sdk/hosting` supuestamente tiene Dockerfiles y manifiestos K8s desplegables. No lo he abierto; puede ahorrarnos trabajo en el Dockerfile.
11. **NO VERIFICADO — Alternativas del punto 12 en profundidad.** Para Mastra, VoltAgent, OpenAI Agents JS y LangGraph JS solo verifiqué estrellas, licencia, último push, issues y versión npm. **No leí su documentación**, así que mis afirmaciones sobre sus capacidades (in-process, multi-modelo, falta de harness de herramientas) son conocimiento general, no verificación de esta sesión.
