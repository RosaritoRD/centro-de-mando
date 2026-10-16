# Category C — Chat UI and Generative UI for APM

**Research date:** August 2, 2026
**Context:** a React dashboard + our own Node backend with the **Claude Agent SDK**. The agent runs on OUR server. The UI must only consume OUR stream.
**Everything marked ✅ is verified against the npm registry, the GitHub API or the official documentation on this date.** Anything ⚠️ NOT VERIFIED is flagged explicitly.

> Postscript: in the end the panel was built with plain React + EventSource (see
> `web/src/Chat.jsx`), because the backend's SSE contract stayed simple (one named event per
> type) and the approval flow lives in the server. This report is kept as the research that
> led there.

---

## 0. One-line recommendation

> **assistant-ui** (`@assistant-ui/react` + `@assistant-ui/react-ai-sdk`), consuming our SSE endpoint via `useChatRuntime({ transport: new AssistantChatTransport({ api }) })`, with the **AI SDK UI Message Stream** protocol emitted by hand from our Node backend.

It's the only option that meets **all three non-negotiable conditions at once**: our own backend without imposing someone else's runtime, per-tool generative UI, and native human-in-the-loop approval.

---

## 1. Comparison table (main candidates)

| Library | License | Current version | Last commit / publish | Requires Next.js? | Custom backend? | Generative UI | HITL (approval) | Theming | Weight |
|---|---|---|---|---|---|---|---|---|---|
| **assistant-ui** | MIT ✅ | `@assistant-ui/react` **0.15.1** (29-Jul-2026) ✅ | commits on **2-Aug-2026** ✅ (live repo, 11,365 ★) | **No** ✅ (the official `with-react-router` example uses Vite 8) — only the `"use generative"` compiler needs Next | **Yes**, 4 different runtimes ✅ | **Yes**, a React component per tool ✅ | **Yes**, native (`approval` + `respondToApproval`, or `humanTool()` + `addResult`) ✅ | Excellent: components are **copied into your repo** via the shadcn registry → you own the TSX ✅ | 547 KB min / **162.7 KB gzip**, 19 deps ✅ |
| **AI Elements + AI SDK (`useChat`)** | Apache-2.0 ✅ | `ai` **7.0.48** (1-Aug-2026); `ai-elements` 1.9.0 ✅ | vercel/ai push **2-Aug-2026** ✅ | **No** (but AI Elements requires Tailwind **and** shadcn/ui) ✅ | **Yes** (`DefaultChatTransport`/`ChatTransport`) ✅ | Yes, but you wire it by hand per `part.type` | **Yes**, a native approval protocol ✅ | Good (pure shadcn) | `ai` 84.8 KB gz + `@ai-sdk/react` 63.5 KB gz ✅ |
| **CopilotKit** | MIT ✅ | **1.64.2** (31-Jul-2026) ✅ | push **2-Aug-2026** ✅ (36,404 ★) | No | Only if you speak **AG-UI** (its own protocol) ⚠️ high coupling | Yes (`useCopilotAction` + render) | Yes (`renderAndWaitForResponse`) ⚠️ name not verified in v1.64 | Mediocre: brings its own CSS, `lit` + web components | **Very heavy**: 29 direct deps in `react-core` ✅ (incl. `lit`, `rxjs`, `katex`, `@jetbrains/websandbox`, `@tanstack/react-virtual`) |
| **Tambo** | MIT ✅ | `@tambo-ai/react` 1.3.0 (15-Jun-2026) ✅ | push 30-Jul-2026 ✅ (11,157 ★) | No | **No** — imposes **its** agent server (Tambo Cloud or a Tambo self-host) ✅ | Yes (component registry + Zod) | ⚠️ Not documented | Good | n/a |
| **Deep Chat** | MIT ✅ | 2.5.0 (19-Jul-2026) ✅ | push 1-Aug-2026 ✅ (3,685 ★) | No | Yes (connects to any API) | **No** (a web component; doesn't render your React components per tool) | **No** | Custom via props | n/a |
| **Ant Design X** | MIT ✅ | 2.9.0 (28-Jul-2026) ✅ | push 1-Aug-2026 ✅ (4,700 ★) | No | Yes | Partial | **No** | ❌ Drags in the Ant Design system → a head-on fight with "Spectra" | heavy (antd) |

---

## 2. The best rated on GitHub (open search)

Search via the GitHub Search API (`topic:generative-ui`, `topic:ai-chatbot`, `topic:chat-ui`, keywords), filtered by recent activity (`pushed:>2026-02-01`) and sorted by stars. Data from 2-Aug-2026 ✅

| ★ | Repo | License | Last push | Type | Imposes a backend? | Custom SSE | Tool UI | HITL |
|---|---|---|---|---|---|---|---|---|
| 36,404 | `CopilotKit/CopilotKit` | MIT | 2026-08-02 | Full framework | Yes, the **AG-UI** protocol | via AG-UI | Yes | Yes |
| 25,958 | `vercel/ai` (AI SDK) | Apache-2.0 | 2026-08-02 | SDK + hooks (headless) | No | **Yes** | manual | **Yes** |
| 15,099 | `ag-ui-protocol/ag-ui` | MIT | 2026-07-31 | **Protocol**, not UI | — | — | — | — |
| **11,365** | **`assistant-ui/assistant-ui`** | **MIT** | **2026-08-02** | **Components + runtimes (headless + styled)** | **No** | **Yes** | **Yes** | **Yes** |
| 11,157 | `tambo-ai/tambo` | MIT | 2026-07-30 | Generative UI SDK | **Yes (Tambo server)** | No | Yes | ⚠️ n/a |
| 8,264 | `thesysdev/openui` | MIT | 2026-08-01 | **Spec/DSL** (the model *writes* the UI in "OpenUI Lang") | No | Yes (headless) | Another paradigm | ⚠️ n/a |
| 4,700 | `ant-design/x` | MIT | 2026-08-01 | Components (antd) | No | Yes | Partial | No |
| 3,685 | `OvidijusParsiunas/deep-chat` | MIT | 2026-08-01 | Web component | No | Yes | No | No |
| 1,474 | `CopilotKit/OpenGenerativeUI` | MIT | 2026-06-10 | Framework | — | — | Yes | ⚠️ n/a |
| 795 | `Blazity/shadcn-chatbot-kit` | MIT | **2026-02-26** (stalled) | shadcn copy-paste | No | Yes | No | No |

**Conclusions from the open search:**

1. **Nothing new dethrones assistant-ui** for our case. The two repos with the most stars are CopilotKit (which imposes AG-UI on us) and the AI SDK itself (which is the *transport*, not the UI — and assistant-ui builds on it).
2. **`ag-ui` (15k ★) is a protocol, not a UI library.** Worth knowing because assistant-ui *also* has an AG-UI runtime, so if we ever want to speak AG-UI, we don't have to change UI libraries.
3. **OpenUI (thesys, 8.2k ★) solves a different problem:** having the *model* generate the UI through a DSL. We want the opposite — the agent invoking **our** typed React components. Ruled out by paradigm, not by quality.
4. **`shadcn-chatbot-kit` has effectively stopped** (last push Feb-2026) and has no tool UI or HITL. Not a candidate.

---

## 3. Answers to the specific questions

### 3.1 Which allows streaming from our own SSE endpoint with minimal coupling?

**assistant-ui**, and it has **four** official adapters (verified at `assistant-ui.com/docs/runtimes/custom/overview`) ✅:

| Exact API | When to use it | Supports HITL? |
|---|---|---|
| `useLocalRuntime(adapter)` with `ChatModelAdapter.run` | Maximum control; you parse the SSE | **Yes** ✅ |
| `useChatRuntime({ transport })` + `AssistantChatTransport` | Our backend speaks the AI SDK UI Message Stream protocol | **Yes** ✅ |
| `useDataStreamRuntime({ api })` | Same but simpler | **❌ NO** — see §5 |
| `useAssistantTransportRuntime({...})` | A backend that emits agent-state *snapshots* | ⚠️ not verified |

**The real coupling is a single line:**

```ts
const runtime = useChatRuntime({
  transport: new AssistantChatTransport({ api: "/my-custom-api/chat" }),
});
```

(snippet verbatim from the official docs `docs/runtimes/ai-sdk/v7` ✅)

Our Node backend only has to emit SSE with the `x-vercel-ai-ui-message-stream: v1` header. We **don't** need `streamText` or any Vercel piece on the server — the protocol is documented and we write it by hand (see §4.1).

### 3.2 Which supports generative UI, and how is a component registered per tool?

**assistant-ui**, with the type `ToolCallMessagePartComponent<TArgs, TResult>`. Full props (verbatim from the docs) ✅:

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

Note `args` **during** `status.type === "running"`: arguments arrive streaming, so you can draw a skeleton and fill it in. That's real generative UI, not a spinner.

### 3.3 Which allows human-in-the-loop approval? (non-negotiable requirement)

**assistant-ui has TWO paths, both verified** ✅. I recommend **Path A** for APM:

**Path A — `humanTool()` / `addResult` (simpler, zero protocol changes).**
The agent calls a tool; the UI renders it with buttons; the result comes back as a normal tool result. Our backend needn't know anything about "approvals": it receives a tool result with `{approved: true}` and continues. **This is the lowest-risk route with the Claude Agent SDK.**

**Path B — the native approval protocol (`approval` + `respondToApproval`).**
More elegant and with three-valued state (pending / approved / denied), but it requires our backend to emit `tool-approval-request` and know how to resume. Verified that it exists in the protocol (§4.1) and in assistant-ui's renderer (§4.4).

**The AI SDK alone** also supports it natively (`addToolApprovalResponse`, `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`) ✅ — but you'd have to build the whole thread UI from scratch.

### 3.4 Bundle weight and number of dependencies

Measured with the bundlephobia API on 2-Aug-2026 ✅ (whole-package figures, no tree-shaking; real usage will be lower):

| Package | minified | **gzip** | direct deps |
|---|---|---|---|
| `@assistant-ui/react` 0.15.1 | 547.0 KB | **162.7 KB** | 19 |
| `@assistant-ui/react-ai-sdk` 1.4.2 | 457.7 KB | 121.3 KB | 7 (overlaps with `ai`) |
| `ai` 7.0.48 | 344.3 KB | 84.8 KB | 3 |
| `@ai-sdk/react` 4.0.51 | 244.1 KB | 63.5 KB | 6 |
| `@copilotkit/react-core` 1.64.2 | ❌ bundlephobia **fails to build it** | — | **29** |

assistant-ui's 19 deps are almost all Radix primitives (which we'd use with shadcn anyway) + `zustand` + `zod`. CopilotKit's 29 include `lit`, `rxjs`, `katex`, `react-markdown`, `react-syntax-highlighter` and **`@jetbrains/websandbox`** — an iframe sandbox we won't use and that can't easily be tree-shaken.

### 3.5 Which can be themed without a fight?

**assistant-ui, by far.** You don't install visual components: you **copy them into your repo** with the shadcn CLI (verbatim from `docs/installation`) ✅:

```bash
npx shadcn@latest add @assistant-ui/thread @assistant-ui/thread-list
# or without configuring a registry:
npx shadcn@latest add https://r.assistant-ui.com/base/thread.json
npm install @assistant-ui/react @assistant-ui/react-markdown class-variance-authority remark-gfm tw-shimmer zustand
```

What lands in `components/assistant-ui/thread.tsx` is your own TSX with Tailwind classes and shadcn CSS variables (`--background`, `--primary`, `--muted-foreground`…). For "Spectra" you just redefine those variables in your `globals.css`, and the light/dark toggle comes free with `.dark`. **No library CSS to override with `!important`.**

Also, the logic lives in **headless primitives** (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`), so if you don't like the generated `thread.tsx`, you throw it away and build your own without losing streaming, branching or auto-scroll.

By comparison: CopilotKit injects its own CSS and uses web components (`lit`) — a real fight. Ant Design X brings in the whole Ant design system — ruled out immediately given "Spectra".

---

## 4. Real snippets from the recommended option

### 4.1 Node backend (Claude Agent SDK) → AI SDK UI Message Stream protocol

Format verified at `ai-sdk.dev/docs/ai-sdk-ui/stream-protocol` ✅. Every event goes as `data: {JSON}\n\n` and the stream closes with `data: [DONE]\n\n`.

```js
// server/routes/chat.js  (Express)
import { query } from "@anthropic-ai/claude-agent-sdk";

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("x-vercel-ai-ui-message-stream", "v1"); // <-- REQUIRED

  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const messageId = "msg_" + Date.now();

  send({ type: "start", messageId });
  send({ type: "start-step" });

  // ---- Bridge: Claude Agent SDK events -> protocol events ----
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
      // full args -> this is where our React component gets triggered
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

**Available event catalog** (verbatim from the docs) ✅:
`start`, `start-step`, `finish-step`, `finish`, `text-start|delta|end`, `reasoning-start|delta|end`, `source-url`, `source-document`, `file`, `data-*` (custom), `tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-output-available`, `tool-output-denied`, **`tool-approval-request`**, **`tool-approval-response`**, `abort`, `error`.

> ⚠️ **Watch out for nginx.** It already bit us with photo uploads on the main website. SSE needs `proxy_buffering off;` and a high `proxy_read_timeout` on the endpoint's location, or the stream arrives in bursts or gets cut.

### 4.2 Client — connect the runtime to OUR endpoint

```tsx
"use client";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";

export function ApmChat() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
      headers: () => ({ Authorization: `Bearer ${getToken()}` }), // pattern verified in the transport docs
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-dvh"><Thread /></div>
    </AssistantRuntimeProvider>
  );
}
```

### 4.3 Generative UI — one React component per tool

Code **verbatim from the official repo** (`examples/with-generative-ui/components/location-tool-ui.tsx`) ✅, trimmed:

```tsx
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

type LocationArgs = { name: string; address?: string; lat: number; lng: number };
type LocationResult = { success: boolean };

export const LocationToolUI: ToolCallMessagePartComponent<LocationArgs, LocationResult> =
  function LocationUI({ args, status }) {
    // args arrive streaming: draw a placeholder in the meantime
    if (status.type === "running" && (args.lat == null || args.lng == null)) {
      return <div className="flex items-center gap-2 rounded-lg border p-4">Loading…</div>;
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

Registration (verbatim from `examples/with-generative-ui/app/page.tsx` ✅):

```tsx
import { AssistantRuntimeProvider, Tools, useAui } from "@assistant-ui/react";
import toolkit from "./toolkit";

const aui = useAui({ tools: Tools({ toolkit }) });
```

And the toolkit (verbatim from `app/toolkit.tsx` ✅):

```tsx
import { defineToolkit, externalTool, humanTool } from "@assistant-ui/react";
import { z } from "zod";

export default defineToolkit({
  // The tool ALREADY exists in our backend: we only register how it's drawn.
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

> **`externalTool()` is the key for APM.** It means: "this tool is already defined and runs elsewhere (our backend / MCP); here I only declare its render". We don't duplicate the schema or the executor. ✅

### 4.4 Human-in-the-loop approval

**Path A — recommended for APM (`humanTool()` + `addResult`).** Verbatim from `docs/tools/defining-tools` ✅:

```tsx
import { defineToolkit, humanTool } from "@assistant-ui/react";
import { z } from "zod";

export default defineToolkit({
  confirm_deploy: {
    description: "Ask the operator to approve a deployment before it runs.",
    parameters: z.object({ target: z.string(), summary: z.string() }),
    execute: humanTool(),          // pauses until the user responds
    render: ({ args, result, addResult }) => {
      if (result) {
        return <p>{result.approved ? "Approved" : `Rejected: ${result.reason}`}</p>;
      }
      return (
        <div className="rounded-lg border border-[--spectra-accent] p-4">
          <p className="font-medium">Deploy to {args.target}?</p>
          <p className="text-muted-foreground text-sm">{args.summary}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => addResult({ approved: true })}>Approve</button>
            <button onClick={() => addResult({ approved: false, reason: "user denied" })}>
              Reject
            </button>
          </div>
        </div>
      );
    },
  },
});
```

The contract: **`render` must call `addResult` exactly once** ✅. The result travels to the backend as a normal tool result — our Claude agent reads it and decides. Zero protocol changes.

**Path B — the native approval protocol.** Verbatim from `docs/tools/tool-ui` ✅:

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

It requires the backend to emit `{"type":"tool-approval-request","toolCallId":"...","approvalId":"..."}` and know how to resume when the answer arrives. **It only works with runtimes that implement it** (the AI SDK v6/v7 runtime or LocalRuntime); see §5.

---

## 5. ⚠️ Corrections to project assumptions

**① The AI SDK is on v7, not v5.** `ai@latest` = **7.0.48** (1-Aug-2026) ✅. Vercel keeps parallel tags: `ai-v5` (5.0.225) and `ai-v6` (6.0.240). Any "AI SDK 5 / `DefaultChatTransport`" tutorial you find may be two majors behind. `@assistant-ui/react-ai-sdk@1.4.2` depends on **`ai@^7.0.37`** ✅ — so going with assistant-ui means going straight to v7.

**② "Using the AI SDK on the client" does NOT mean using it as the agent runtime.** This is the most expensive misunderstanding to undo. `ai` + `@ai-sdk/react` in the browser are **just an SSE parser and a message state machine**. The agent still runs 100% in our Node with the Claude Agent SDK. All we share with Vercel is a **text format on the wire**, which is documented and which we emit with `res.write()`. Zero lock-in, zero paid service.

**③ ⚠️ `useDataStreamRuntime` does NOT support human-in-the-loop.** It's the most obvious shortcut (`useDataStreamRuntime({ api: "/api/chat" })`) and **it's a trap for us**. The docs say so explicitly: *"Human-in-the-loop tools (`unstable_humanToolNames`, `human()` interrupts) are not supported in the data stream runtime"* ✅. Since HITL is non-negotiable, **you must use `useChatRuntime` (AI SDK v7) or `useLocalRuntime`**. That has to be written into the implementation plan.

**④ The `"use generative"` directive DOES require Next.js.** It's the only part of assistant-ui that does. That magic mode (colocating schema + server `execute` + client `render` in one file) is implemented by the `@assistant-ui/next` package with the `withAui()` wrapper ✅. **But we don't need it**: our tools run in our Node backend, so we use the client form of `defineToolkit` with `externalTool()`, which works the same in Vite. Verified: the official `examples/with-react-router` example runs on **Vite 8 + React Router 8, no Next** ✅.

**⑤ CopilotKit isn't "a UI library with more stars".** Its 36k ★ are for a full *agent framework*. Consuming our backend means implementing the **AG-UI** protocol, not just any SSE. It's exactly the coupling the brief asks to avoid.

**⑥ Tambo (11k ★) is out because of its architecture, not its quality.** *"Self-host the backend or use Tambo Cloud"* ✅ — but that backend is **theirs**, with its own agent loop. We'd have two agents competing. Ruled out.

---

## 6. The 2 main reasons to rule out each alternative

**AI Elements + plain AI SDK** (runner-up, and our Plan B):
1. It's a **kit of pieces, not a chat thread**. No branching, message editing, regeneration, thread list or sticky auto-scroll: we'd write and maintain all of that. assistant-ui gives it for free.
2. Generative UI registration is **manual**: a `switch` on `part.type` in every render, with no end-to-end typing per tool. With 10-15 tools it rots fast.

**CopilotKit:**
1. **It imposes AG-UI** as the protocol. Our backend would have to speak it, which is exactly the opposite of "the UI consumes OUR stream".
2. **Weight and pollution**: 29 direct dependencies including `lit`, `rxjs`, `katex` and `@jetbrains/websandbox`, plus its own CSS and web components that fight with Spectra.

**Tambo:**
1. **It imposes its agent server** — incompatible with the Claude Agent SDK in our Node.
2. HITL not documented ⚠️.

**OpenUI / thesys:**
1. **The opposite paradigm**: the model generates the UI through a DSL; we want it to invoke our typed React components.
2. It doesn't provide the chat thread.

**Ant Design X / Deep Chat / shadcn-chatbot-kit:**
1. **None has HITL approval** — a non-negotiable requirement. End of analysis.
2. Ant Design X also drags in Ant's design system (kills Spectra), and shadcn-chatbot-kit has been stalled since February 2026.

---

## 7. Plan B (if assistant-ui turns out too coupled)

**The good news: Plan B throws away nothing in the backend.**

Since the recommendation is for our Node to emit the **AI SDK UI Message Stream protocol**, and `assistant-ui/react-ai-sdk` is a thin layer *over* `@ai-sdk/react`, getting out is cheap:

1. **Remove** `@assistant-ui/react` + `@assistant-ui/react-ai-sdk`.
2. **Keep** `useChat` from `@ai-sdk/react` pointing at the **same endpoint, unchanged**.
3. **Install AI Elements** (`Conversation`, `Message`, `PromptInput`, `Response`, `Tool`…), which is pure shadcn, so your Spectra tokens still apply.
4. HITL approval stays natively available: `addToolApprovalResponse({ id: part.approval.id, approved: true })` + `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` ✅.
5. What you lose and have to rewrite: branching, message editing, regeneration, thread list, auto-scroll and the per-tool renders.

**Plan C (emergency hatch, zero dependency cost):** `useLocalRuntime` with a `ChatModelAdapter.run` declared as an `async *` generator, parsing our SSE with `eventsource-parser` — exactly what the official `with-react-router` example does ✅ (`eventsource-parser` is in its `package.json`). With this the wire format becomes **ours**, with no Vercel convention at all. The adapter's rule: **you must `yield` the full accumulated state, not deltas** ✅.

---

## 8. Vite vs Next.js decision (what each library requires)

| | Vite SPA | Next.js |
|---|---|---|
| assistant-ui (client form + `externalTool()`) | ✅ Works (official example with Vite 8) | ✅ |
| assistant-ui with `"use generative"` | ❌ Requires `@assistant-ui/next` | ✅ |
| AI SDK `useChat` + transport | ✅ | ✅ |
| AI Elements | ✅ (needs Tailwind + shadcn) | ✅ |

**Recommendation: Vite SPA.** Since the backend is our own, separate Node, Next's API routes add nothing, and `"use generative"` is sugar we don't need (our tools already live in the backend). Vite gives faster builds and a trivial static deployment behind the nginx we already have. If SSR/SEO were ever needed, moving the chat is a copy-paste — it's a client component either way.

---

## 9. What remains unverified

- The exact name of CopilotKit v1.64's HITL API (`renderAndWaitForResponse`) — not confirmed against that version's docs.
- Approval support in `useAssistantTransportRuntime`.
- Which extra fields `AssistantChatTransport` puts in the body compared to `DefaultChatTransport` (presumably frontend tool definitions and the system prompt) — **log a real request before fixing the backend contract**.
- HITL capabilities in Tambo and OpenUI.
- Bundlephobia weights are for the whole package without tree-shaking; the real production cost will be lower.

---

## Sources

- [assistant-ui — Custom Runtime overview](https://www.assistant-ui.com/docs/runtimes/custom/overview)
- [assistant-ui — Data Stream Protocol](https://www.assistant-ui.com/docs/runtimes/custom/data-stream)
- [assistant-ui — Assistant Transport](https://www.assistant-ui.com/docs/runtimes/custom/assistant-transport)
- [assistant-ui — AI SDK v7 runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v7)
- [assistant-ui — Tool UI](https://www.assistant-ui.com/docs/tools/tool-ui) · [Defining Tools](https://www.assistant-ui.com/docs/tools/defining-tools) · [Installation](https://www.assistant-ui.com/docs/installation)
- [assistant-ui on GitHub](https://github.com/assistant-ui/assistant-ui) (examples `with-generative-ui`, `with-ai-sdk-v7`, `with-react-router`)
- [AI SDK — UI Message Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) · [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) · [Tool Approvals](https://ai-sdk.dev/docs/agents/tool-approvals)
- [AI Elements](https://elements.ai-sdk.dev/overview)
- [CopilotKit docs](https://docs.copilotkit.ai/) · [CopilotKit on GitHub](https://github.com/CopilotKit/CopilotKit)
- [Tambo docs](https://docs.tambo.co/) · [OpenUI](https://github.com/thesysdev/openui) · [Deep Chat](https://deepchat.dev/docs/introduction) · [AG-UI](https://github.com/ag-ui-protocol/ag-ui)
- npm registry API and GitHub API (versions, licenses, dates, stars) — checked on 2-Aug-2026
