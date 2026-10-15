# Categoría C — UI de chat y Generative UI para APM

**Fecha de investigación:** 2 de agosto de 2026
**Contexto:** dashboard React + backend propio en Node con **Claude Agent SDK**. El agente corre en NUESTRO servidor. La UI solo debe consumir NUESTRO stream.
**Todo lo marcado con ✅ está verificado contra npm registry, GitHub API o la documentación oficial en esta fecha.** Lo marcado con ⚠️ NO VERIFICADO se señala explícitamente.

---

## 0. Recomendación en una línea

> **assistant-ui** (`@assistant-ui/react` + `@assistant-ui/react-ai-sdk`), consumiendo nuestro endpoint SSE mediante `useChatRuntime({ transport: new AssistantChatTransport({ api }) })`, con el protocolo **AI SDK UI Message Stream** emitido a mano desde nuestro backend Node.

Es la única opción que cumple **las tres condiciones no negociables a la vez**: backend propio sin imponer runtime ajeno, generative UI por herramienta, y aprobación human-in-the-loop nativa.

---

## 1. Tabla comparativa (candidatos principales)

| Librería | Licencia | Versión actual | Último commit / publish | ¿Requiere Next.js? | ¿Backend custom? | Generative UI | HITL (aprobación) | Theming | Peso |
|---|---|---|---|---|---|---|---|---|---|
| **assistant-ui** | MIT ✅ | `@assistant-ui/react` **0.15.1** (29-jul-2026) ✅ | commits del **2-ago-2026** ✅ (repo vivo, 11.365 ★) | **No** ✅ (ejemplo oficial `with-react-router` usa Vite 8) — solo el compilador `"use generative"` exige Next | **Sí**, 4 runtimes distintos ✅ | **Sí**, componente React por tool ✅ | **Sí**, nativo (`approval` + `respondToApproval`, o `humanTool()` + `addResult`) ✅ | Excelente: los componentes se **copian a tu repo** vía registry shadcn → eres dueño del TSX ✅ | 547 KB min / **162,7 KB gzip**, 19 deps ✅ |
| **AI Elements + AI SDK (`useChat`)** | Apache-2.0 ✅ | `ai` **7.0.48** (1-ago-2026); `ai-elements` 1.9.0 ✅ | vercel/ai push **2-ago-2026** ✅ | **No** (pero AI Elements exige Tailwind **y** shadcn/ui) ✅ | **Sí** (`DefaultChatTransport`/`ChatTransport`) ✅ | Sí, pero lo cableas tú a mano por `part.type` | **Sí**, protocolo nativo de aprobación ✅ | Bueno (es shadcn puro) | `ai` 84,8 KB gz + `@ai-sdk/react` 63,5 KB gz ✅ |
| **CopilotKit** | MIT ✅ | **1.64.2** (31-jul-2026) ✅ | push **2-ago-2026** ✅ (36.404 ★) | No | Solo si hablas **AG-UI** (protocolo propio) ⚠️ acoplamiento alto | Sí (`useCopilotAction` + render) | Sí (`renderAndWaitForResponse`) ⚠️ nombre no verificado en v1.64 | Mediocre: trae su propio CSS, `lit` + web components | **Muy pesado**: 29 deps directas en `react-core` ✅ (incluye `lit`, `rxjs`, `katex`, `@jetbrains/websandbox`, `@tanstack/react-virtual`) |
| **Tambo** | MIT ✅ | `@tambo-ai/react` 1.3.0 (15-jun-2026) ✅ | push 30-jul-2026 ✅ (11.157 ★) | No | **No** — impone **su** servidor de agente (Tambo Cloud o self-host de Tambo) ✅ | Sí (registro de componentes + Zod) | ⚠️ No documentado | Bueno | n/d |
| **Deep Chat** | MIT ✅ | 2.5.0 (19-jul-2026) ✅ | push 1-ago-2026 ✅ (3.685 ★) | No | Sí (conecta a cualquier API) | **No** (es un web component, no renderiza tus componentes React por tool) | **No** | Custom vía props | n/d |
| **Ant Design X** | MIT ✅ | 2.9.0 (28-jul-2026) ✅ | push 1-ago-2026 ✅ (4.700 ★) | No | Sí | Parcial | **No** | ❌ Arrastra el design system de Ant Design → pelea directa con "Spectra" | pesado (antd) |

---

## 2. Lo mejor valorado en GitHub (búsqueda abierta)

Búsqueda vía GitHub Search API (`topic:generative-ui`, `topic:ai-chatbot`, `topic:chat-ui`, keywords), filtrando por actividad reciente (`pushed:>2026-02-01`) y ordenando por estrellas. Datos del 2-ago-2026 ✅

| ★ | Repo | Licencia | Último push | Tipo | ¿Impone backend? | SSE custom | Tool UI | HITL |
|---|---|---|---|---|---|---|---|---|
| 36.404 | `CopilotKit/CopilotKit` | MIT | 2026-08-02 | Framework completo | Sí, protocolo **AG-UI** | vía AG-UI | Sí | Sí |
| 25.958 | `vercel/ai` (AI SDK) | Apache-2.0 | 2026-08-02 | SDK + hooks (headless) | No | **Sí** | manual | **Sí** |
| 15.099 | `ag-ui-protocol/ag-ui` | MIT | 2026-07-31 | **Protocolo**, no UI | — | — | — | — |
| **11.365** | **`assistant-ui/assistant-ui`** | **MIT** | **2026-08-02** | **Componentes + runtimes (headless + styled)** | **No** | **Sí** | **Sí** | **Sí** |
| 11.157 | `tambo-ai/tambo` | MIT | 2026-07-30 | SDK generative UI | **Sí (servidor Tambo)** | No | Sí | ⚠️ n/d |
| 8.264 | `thesysdev/openui` | MIT | 2026-08-01 | **Spec/DSL** (el modelo *escribe* la UI en "OpenUI Lang") | No | Sí (headless) | Otro paradigma | ⚠️ n/d |
| 4.700 | `ant-design/x` | MIT | 2026-08-01 | Componentes (antd) | No | Sí | Parcial | No |
| 3.685 | `OvidijusParsiunas/deep-chat` | MIT | 2026-08-01 | Web component | No | Sí | No | No |
| 1.474 | `CopilotKit/OpenGenerativeUI` | MIT | 2026-06-10 | Framework | — | — | Sí | ⚠️ n/d |
| 795 | `Blazity/shadcn-chatbot-kit` | MIT | **2026-02-26** (estancado) | Copy-paste shadcn | No | Sí | No | No |

**Conclusiones de la búsqueda abierta:**

1. **Nada nuevo destrona a assistant-ui** para nuestro caso. Los dos repos con más estrellas son CopilotKit (que nos impone AG-UI) y el propio AI SDK (que es el *transporte*, no la UI — y assistant-ui se apoya en él).
2. **`ag-ui` (15k ★) es un protocolo, no una librería de UI.** Merece la pena conocerlo porque assistant-ui *también* tiene un runtime AG-UI, así que si algún día queremos hablar AG-UI, no hay que cambiar de librería de UI.
3. **OpenUI (thesys, 8.2k ★) resuelve otro problema:** que el *modelo* genere la UI mediante un DSL. Nosotros queremos lo contrario — que el agente invoque **nuestros** componentes React tipados. Descartado por paradigma, no por calidad.
4. **`shadcn-chatbot-kit` está efectivamente parado** (último push feb-2026) y no tiene tool UI ni HITL. No es candidato.

---

## 3. Respuestas a las preguntas concretas

### 3.1 ¿Cuál permite streaming desde un endpoint SSE propio con el mínimo acoplamiento?

**assistant-ui**, y tiene **cuatro** adaptadores oficiales (verificado en `assistant-ui.com/docs/runtimes/custom/overview`) ✅:

| API exacta | Cuándo usarla | ¿Soporta HITL? |
|---|---|---|
| `useLocalRuntime(adapter)` con `ChatModelAdapter.run` | Máximo control; tú parseas el SSE | **Sí** ✅ |
| `useChatRuntime({ transport })` + `AssistantChatTransport` | Nuestro backend habla el protocolo AI SDK UI Message Stream | **Sí** ✅ |
| `useDataStreamRuntime({ api })` | Igual pero más simple | **❌ NO** — ver §5 |
| `useAssistantTransportRuntime({...})` | Backend que emite *snapshots* de estado del agente | ⚠️ no verificado |

**El acoplamiento real es una sola línea:**

```ts
const runtime = useChatRuntime({
  transport: new AssistantChatTransport({ api: "/my-custom-api/chat" }),
});
```

(snippet verbatim de la doc oficial `docs/runtimes/ai-sdk/v7` ✅)

Nuestro backend Node solo tiene que emitir SSE con la cabecera `x-vercel-ai-ui-message-stream: v1`. **No** necesitamos `streamText` ni ninguna pieza de Vercel en el servidor — el protocolo está documentado y lo escribimos a mano (ver §4.1).

### 3.2 ¿Cuál soporta generative UI y cómo se registra un componente por tool?

**assistant-ui**, con tipo `ToolCallMessagePartComponent<TArgs, TResult>`. Props completas (verbatim de la doc) ✅:

```ts
type ToolCallMessagePartProps<TArgs, TResult> = {
  args: TArgs;
  argsText: string;
  status: ToolCallMessagePartStatus;
  isError?: boolean;
  result?: TResult;
  toolName: string;
  toolCallId: string;
  addResult: (result: TResult | ToolResponse<TResult>) => void;
  resume: (payload: unknown) => void;
  interrupt?: { type: "human"; payload: unknown };
  artifact?: unknown;
};
```

Fíjate en `args` **durante** `status.type === "running"`: los argumentos llegan en streaming, así que puedes pintar un esqueleto y rellenarlo. Eso es generative UI de verdad, no un spinner.

### 3.3 ¿Cuál permite aprobación human-in-the-loop? (requisito no negociable)

**assistant-ui tiene DOS caminos, ambos verificados** ✅. Recomiendo el **Camino A** para APM:

**Camino A — `humanTool()` / `addResult` (más simple, cero cambios de protocolo).**
El agente llama a una tool; la UI la renderiza con botones; el resultado vuelve como un tool result normal. Nuestro backend no necesita saber nada de "aprobaciones": recibe un tool result con `{approved: true}` y sigue. **Esta es la vía de menor riesgo con Claude Agent SDK.**

**Camino B — protocolo nativo de aprobación (`approval` + `respondToApproval`).**
Más elegante y con estado de tres valores (pendiente / aprobado / denegado), pero exige que nuestro backend emita `tool-approval-request` y sepa reanudar. Verificado que existe en el protocolo (§4.1) y en el renderer de assistant-ui (§4.4).

**AI SDK solo** también lo soporta nativamente (`addToolApprovalResponse`, `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`) ✅ — pero tendrías que construir toda la UI del hilo desde cero.

### 3.4 Peso del bundle y número de dependencias

Medido con la API de bundlephobia el 2-ago-2026 ✅ (son cifras del paquete completo, sin tree-shaking; el consumo real será menor):

| Paquete | minified | **gzip** | deps directas |
|---|---|---|---|
| `@assistant-ui/react` 0.15.1 | 547,0 KB | **162,7 KB** | 19 |
| `@assistant-ui/react-ai-sdk` 1.4.2 | 457,7 KB | 121,3 KB | 7 (solapa con `ai`) |
| `ai` 7.0.48 | 344,3 KB | 84,8 KB | 3 |
| `@ai-sdk/react` 4.0.51 | 244,1 KB | 63,5 KB | 6 |
| `@copilotkit/react-core` 1.64.2 | ❌ bundlephobia **falla al construirlo** | — | **29** |

Las 19 deps de assistant-ui son casi todas primitivas de Radix (que ya usaremos con shadcn) + `zustand` + `zod`. Las 29 de CopilotKit incluyen `lit`, `rxjs`, `katex`, `react-markdown`, `react-syntax-highlighter` y **`@jetbrains/websandbox`** — un sandbox de iframe que no vamos a usar y que no se puede tree-shakear fácilmente.

### 3.5 ¿Cuál se puede tematizar sin luchar?

**assistant-ui, con diferencia.** No instalas componentes visuales: los **copias a tu repo** con el CLI de shadcn (verbatim de `docs/installation`) ✅:

```bash
npx shadcn@latest add @assistant-ui/thread @assistant-ui/thread-list
# o sin configurar registry:
npx shadcn@latest add https://r.assistant-ui.com/base/thread.json
npm install @assistant-ui/react @assistant-ui/react-markdown class-variance-authority remark-gfm tw-shimmer zustand
```

Lo que aterriza en `components/assistant-ui/thread.tsx` es TSX tuyo con clases Tailwind y variables CSS de shadcn (`--background`, `--primary`, `--muted-foreground`…). Para "Spectra" solo redefines esas variables en tu `globals.css` y el toggle claro/oscuro sale gratis con `.dark`. **No hay CSS de la librería que sobreescribir con `!important`.**

Además, la lógica vive en **primitivas headless** (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`), así que si el `thread.tsx` generado no te gusta, lo tiras y montas el tuyo sin perder streaming, branching ni auto-scroll.

Comparativa: CopilotKit inyecta su propio CSS y usa web components (`lit`) — pelea real. Ant Design X te mete el design system de Ant entero — descarte inmediato dado "Spectra".

---

## 4. Snippets reales de la opción recomendada

### 4.1 Backend Node (Claude Agent SDK) → protocolo AI SDK UI Message Stream

Formato verificado en `ai-sdk.dev/docs/ai-sdk-ui/stream-protocol` ✅. Todos los eventos van como `data: {JSON}\n\n` y el stream cierra con `data: [DONE]\n\n`.

```js
// server/routes/chat.js  (Express)
import { query } from "@anthropic-ai/claude-agent-sdk";

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("x-vercel-ai-ui-message-stream", "v1"); // <-- OBLIGATORIA

  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const messageId = "msg_" + Date.now();

  send({ type: "start", messageId });
  send({ type: "start-step" });

  // ---- Puente: eventos del Claude Agent SDK -> eventos del protocolo ----
  for await (const ev of runClaudeAgent({ messages, signal: req.signal })) {
    if (ev.kind === "text_start") {
      send({ type: "text-start", id: ev.id });
    } else if (ev.kind === "text_delta") {
      send({ type: "text-delta", id: ev.id, delta: ev.text });
    } else if (ev.kind === "text_end") {
      send({ type: "text-end", id: ev.id });
    } else if (ev.kind === "thinking_delta") {
      send({ type: "reasoning-delta", id: ev.id, delta: ev.text });
    } else if (ev.kind === "tool_start") {
      send({ type: "tool-input-start", toolCallId: ev.id, toolName: ev.name });
    } else if (ev.kind === "tool_input") {
      // args completos -> aquí es donde se dispara nuestro componente React
      send({ type: "tool-input-available", toolCallId: ev.id, toolName: ev.name, input: ev.input });
    } else if (ev.kind === "tool_result") {
      send({ type: "tool-output-available", toolCallId: ev.id, output: ev.output });
    }
  }

  send({ type: "finish-step" });
  send({ type: "finish" });
  res.write("data: [DONE]\n\n");
  res.end();
});
```

**Catálogo de eventos disponible** (verbatim de la doc) ✅:
`start`, `start-step`, `finish-step`, `finish`, `text-start|delta|end`, `reasoning-start|delta|end`, `source-url`, `source-document`, `file`, `data-*` (custom), `tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-output-available`, `tool-output-denied`, **`tool-approval-request`**, **`tool-approval-response`**, `abort`, `error`.

> ⚠️ **Cuidado con nginx.** Ya nos mordió en tu empresa con las fotos. Para SSE hace falta `proxy_buffering off;` y `proxy_read_timeout` alto en la location del endpoint, o el stream llega a golpes o se corta.

### 4.2 Cliente — conectar el runtime a NUESTRO endpoint

```tsx
"use client";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";

export function ApmChat() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
      headers: () => ({ Authorization: `Bearer ${getToken()}` }), // patrón verificado en la doc de transport
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-dvh"><Thread /></div>
    </AssistantRuntimeProvider>
  );
}
```

### 4.3 Generative UI — un componente React por tool

Código **verbatim del repo oficial** (`examples/with-generative-ui/components/location-tool-ui.tsx`) ✅, recortado:

```tsx
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

type LocationArgs = { name: string; address?: string; lat: number; lng: number };
type LocationResult = { success: boolean };

export const LocationToolUI: ToolCallMessagePartComponent<LocationArgs, LocationResult> =
  function LocationUI({ args, status }) {
    // los args llegan en streaming: pinta un placeholder mientras tanto
    if (status.type === "running" && (args.lat == null || args.lng == null)) {
      return <div className="flex items-center gap-2 rounded-lg border p-4">Cargando…</div>;
    }
    const { name, address, lat, lng } = args;
    if (lat == null || lng == null) return null;
    return (
      <div className="my-2 overflow-hidden rounded-lg border">
        <p className="text-sm font-medium">{name}</p>
        {address && <p className="text-muted-foreground text-xs">{address}</p>}
      </div>
    );
  };
```

Registro (verbatim de `examples/with-generative-ui/app/page.tsx` ✅):

```tsx
import { AssistantRuntimeProvider, Tools, useAui } from "@assistant-ui/react";
import toolkit from "./toolkit";

const aui = useAui({ tools: Tools({ toolkit }) });
```

Y el toolkit (verbatim de `app/toolkit.tsx` ✅):

```tsx
import { defineToolkit, externalTool, humanTool } from "@assistant-ui/react";
import { z } from "zod";

export default defineToolkit({
  // La tool YA existe en nuestro backend: solo registramos cómo se pinta.
  show_location: {
    execute: externalTool(),
    render: LocationToolUI,
  },
  select_date: {
    description: "Ask the user to select a date.",
    parameters: z.object({ prompt: z.string() }),
    execute: humanTool(),
    render: DatePickerToolUI,
  },
});
```

> **`externalTool()` es la clave para APM.** Significa: "esta herramienta ya está definida y se ejecuta en otro sitio (nuestro backend / MCP), aquí solo declaro su render". No duplicamos el schema ni el executor. ✅

### 4.4 Aprobación human-in-the-loop

**Camino A — recomendado para APM (`humanTool()` + `addResult`).** Verbatim de `docs/tools/defining-tools` ✅:

```tsx
import { defineToolkit, humanTool } from "@assistant-ui/react";
import { z } from "zod";

export default defineToolkit({
  confirm_deploy: {
    description: "Ask the operator to approve a deployment before it runs.",
    parameters: z.object({ target: z.string(), summary: z.string() }),
    execute: humanTool(),          // pausa hasta que el usuario responda
    render: ({ args, result, addResult }) => {
      if (result) {
        return <p>{result.approved ? "Aprobado" : `Rechazado: ${result.reason}`}</p>;
      }
      return (
        <div className="rounded-lg border border-[--spectra-accent] p-4">
          <p className="font-medium">¿Desplegar a {args.target}?</p>
          <p className="text-muted-foreground text-sm">{args.summary}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => addResult({ approved: true })}>Aprobar</button>
            <button onClick={() => addResult({ approved: false, reason: "user denied" })}>
              Rechazar
            </button>
          </div>
        </div>
      );
    },
  },
});
```

El contrato: **`render` debe llamar a `addResult` exactamente una vez** ✅. El resultado viaja al backend como un tool result normal — nuestro agente Claude lo lee y decide. Cero cambios de protocolo.

**Camino B — protocolo nativo de aprobación.** Verbatim de `docs/tools/tool-ui` ✅:

```tsx
const toolkit = defineToolkit({
  deploy: {
    type: "backend",
    render: ({ args, approval, respondToApproval, result }) => {
      if (approval?.approved === undefined) {
        return (
          <div>
            <p>Approve deploy to {args.target}?</p>
            <button onClick={() => respondToApproval({ approved: true })}>Approve</button>
            <button onClick={() => respondToApproval({ approved: false, reason: "user denied" })}>
              Deny
            </button>
          </div>
        );
      }
      if (approval?.approved === false) {
        return <p>Denied{approval.reason ? `: ${approval.reason}` : ""}</p>;
      }
      if (result === undefined) return <p>Approved, running…</p>;
      return <p>Deployed</p>;
    },
  },
});
```

Requiere que el backend emita `{"type":"tool-approval-request","toolCallId":"...","approvalId":"..."}` y sepa reanudar al recibir la respuesta. **Solo funciona con runtimes que lo implementen** (AI SDK v6/v7 runtime o LocalRuntime); ver §5.

---

## 5. ⚠️ Correcciones a supuestos del proyecto

**① El AI SDK va por la v7, no la v5.** `ai@latest` = **7.0.48** (1-ago-2026) ✅. Vercel mantiene tags paralelos: `ai-v5` (5.0.225) y `ai-v6` (6.0.240). Cualquier tutorial de "AI SDK 5 / `DefaultChatTransport`" que encuentres puede estar dos majors atrasado. `@assistant-ui/react-ai-sdk@1.4.2` depende de **`ai@^7.0.37`** ✅ — así que si vamos por assistant-ui, entramos directamente en v7.

**② "Usar AI SDK en el cliente" NO implica usarlo como runtime del agente.** Este es el malentendido más caro de deshacer. `ai` + `@ai-sdk/react` en el navegador son **solo un parser de SSE y una máquina de estados de mensajes**. El agente sigue corriendo 100 % en nuestro Node con Claude Agent SDK. Lo único que compartimos con Vercel es un **formato de texto sobre el cable**, que está documentado y que emitimos con `res.write()`. Cero lock-in, cero servicio de pago.

**③ ⚠️ `useDataStreamRuntime` NO soporta human-in-the-loop.** Es el atajo más obvio (`useDataStreamRuntime({ api: "/api/chat" })`) y **es una trampa para nosotros**. La doc lo dice explícitamente: *"Human-in-the-loop tools (`unstable_humanToolNames`, `human()` interrupts) are not supported in the data stream runtime"* ✅. Como HITL es no negociable, **hay que usar `useChatRuntime` (AI SDK v7) o `useLocalRuntime`**. Que quede escrito en el plan de implementación.

**④ El directivo `"use generative"` SÍ requiere Next.js.** Es lo único de assistant-ui que lo requiere. Ese modo mágico (colocar schema + `execute` de servidor + `render` de cliente en un solo archivo) lo implementa el paquete `@assistant-ui/next` con el wrapper `withAui()` ✅. **Pero no lo necesitamos**: nuestras tools se ejecutan en nuestro backend Node, así que usamos la forma cliente de `defineToolkit` con `externalTool()`, que funciona en Vite igual. Verificado: el ejemplo oficial `examples/with-react-router` corre sobre **Vite 8 + React Router 8, sin Next** ✅.

**⑤ CopilotKit no es "una librería de UI con más estrellas".** Sus 36k ★ son de un *framework de agentes* completo. Consumir nuestro backend implica implementar el protocolo **AG-UI**, no un SSE cualquiera. Es exactamente el acoplamiento que el brief pide evitar.

**⑥ Tambo (11k ★) queda fuera por arquitectura, no por calidad.** *"Self-host the backend or use Tambo Cloud"* ✅ — pero ese backend es **el suyo**, con su propio bucle de agente. Tendríamos dos agentes compitiendo. Descartado.

---

## 6. Las 2 razones principales para descartar cada alternativa

**AI Elements + AI SDK a secas** (2º clasificado, y es nuestro Plan B):
1. Es un **kit de piezas, no un hilo de chat**. No trae branching, edición de mensajes, regeneración, lista de hilos ni auto-scroll pegajoso: todo eso lo escribimos y mantenemos nosotros. assistant-ui lo regala.
2. El registro de generative UI es **manual**: un `switch` sobre `part.type` en cada render, sin tipado extremo a extremo por tool. Con 10-15 tools se pudre rápido.

**CopilotKit:**
1. **Impone AG-UI** como protocolo. Nuestro backend tendría que hablarlo, que es justo lo contrario de "que la UI consuma NUESTRO stream".
2. **Peso y contaminación**: 29 dependencias directas incluyendo `lit`, `rxjs`, `katex` y `@jetbrains/websandbox`, más CSS y web components propios que pelean con Spectra.

**Tambo:**
1. **Impone su servidor de agente** — incompatible con Claude Agent SDK en nuestro Node.
2. HITL no documentado ⚠️.

**OpenUI / thesys:**
1. **Paradigma opuesto**: el modelo genera la UI mediante un DSL; nosotros queremos que invoque nuestros componentes React tipados.
2. No aporta el hilo de chat.

**Ant Design X / Deep Chat / shadcn-chatbot-kit:**
1. **Ninguno tiene aprobación HITL** — requisito no negociable. Fin del análisis.
2. Ant Design X además arrastra el design system de Ant (mata Spectra) y shadcn-chatbot-kit lleva parado desde febrero de 2026.

---

## 7. Plan B (si assistant-ui resulta demasiado acoplado)

**La buena noticia: el Plan B no tira nada del backend.**

Como la recomendación es que nuestro Node emita el **protocolo AI SDK UI Message Stream**, y `assistant-ui/react-ai-sdk` es una capa fina *sobre* `@ai-sdk/react`, salirse cuesta poco:

1. **Quitas** `@assistant-ui/react` + `@assistant-ui/react-ai-sdk`.
2. **Te quedas** con `useChat` de `@ai-sdk/react` apuntando al **mismo endpoint sin cambios**.
3. **Instalas AI Elements** (`Conversation`, `Message`, `PromptInput`, `Response`, `Tool`…) que es shadcn puro, así que tus tokens Spectra siguen valiendo.
4. La aprobación HITL sigue disponible de forma nativa: `addToolApprovalResponse({ id: part.approval.id, approved: true })` + `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` ✅.
5. Lo que pierdes y hay que reescribir: branching, edición de mensajes, regeneración, lista de hilos, auto-scroll y los renders por tool.

**Plan C (escotilla de emergencia, coste cero de dependencias):** `useLocalRuntime` con un `ChatModelAdapter.run` declarado como `async *` generator, parseando nuestro SSE con `eventsource-parser` — exactamente lo que hace el ejemplo oficial `with-react-router` ✅ (`eventsource-parser` está en su `package.json`). Con esto el formato del cable pasa a ser **nuestro**, sin ninguna convención de Vercel. Regla del adaptador: **hay que hacer `yield` del estado acumulado completo, no de deltas** ✅.

---

## 8. Decisión Vite vs Next.js (lo que exige cada librería)

| | Vite SPA | Next.js |
|---|---|---|
| assistant-ui (forma cliente + `externalTool()`) | ✅ Funciona (ejemplo oficial con Vite 8) | ✅ |
| assistant-ui con `"use generative"` | ❌ Requiere `@assistant-ui/next` | ✅ |
| AI SDK `useChat` + transport | ✅ | ✅ |
| AI Elements | ✅ (necesita Tailwind + shadcn) | ✅ |

**Recomendación: Vite SPA.** Como el backend es Node propio y separado, las API routes de Next no aportan nada, y `"use generative"` es azúcar que no necesitamos (nuestras tools ya viven en el backend). Vite da builds más rápidos y un despliegue estático trivial detrás del nginx que ya tenemos. Si más adelante hiciera falta SSR/SEO, migrar el chat es un copy-paste — es un componente cliente en ambos casos.

---

## 9. Qué queda sin verificar

- El nombre exacto de la API de HITL en CopilotKit v1.64 (`renderAndWaitForResponse`) — no confirmado contra la doc de esa versión.
- Soporte de aprobaciones en `useAssistantTransportRuntime`.
- Qué campos extra mete `AssistantChatTransport` en el body respecto a `DefaultChatTransport` (presumiblemente definiciones de frontend tools y el system prompt) — **conviene loguear un request real antes de fijar el contrato del backend**.
- Capacidades de HITL en Tambo y OpenUI.
- Los pesos de bundlephobia son del paquete entero sin tree-shaking; el coste real en producción será menor.

---

## Fuentes

- [assistant-ui — Custom Runtime overview](https://www.assistant-ui.com/docs/runtimes/custom/overview)
- [assistant-ui — Data Stream Protocol](https://www.assistant-ui.com/docs/runtimes/custom/data-stream)
- [assistant-ui — Assistant Transport](https://www.assistant-ui.com/docs/runtimes/custom/assistant-transport)
- [assistant-ui — AI SDK v7 runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v7)
- [assistant-ui — Tool UI](https://www.assistant-ui.com/docs/tools/tool-ui) · [Defining Tools](https://www.assistant-ui.com/docs/tools/defining-tools) · [Installation](https://www.assistant-ui.com/docs/installation)
- [assistant-ui en GitHub](https://github.com/assistant-ui/assistant-ui) (ejemplos `with-generative-ui`, `with-ai-sdk-v7`, `with-react-router`)
- [AI SDK — UI Message Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) · [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) · [Tool Approvals](https://ai-sdk.dev/docs/agents/tool-approvals)
- [AI Elements](https://elements.ai-sdk.dev/overview)
- [CopilotKit docs](https://docs.copilotkit.ai/) · [CopilotKit en GitHub](https://github.com/CopilotKit/CopilotKit)
- [Tambo docs](https://docs.tambo.co/) · [OpenUI](https://github.com/thesysdev/openui) · [Deep Chat](https://deepchat.dev/docs/introduction) · [AG-UI](https://github.com/ag-ui-protocol/ag-ui)
- npm registry API y GitHub API (versiones, licencias, fechas, estrellas) — consultadas el 2-ago-2026
