# Category A — Agent core: Claude Agent SDK (TypeScript)

**Research verified on 2026-08-02.** Everything here was checked by downloading the official documentation directly (raw `.md`, not a summary) and the GitHub and npm APIs. Anything I couldn't verify is explicitly marked **NOT VERIFIED**.

> ⚠️ **Important domain change:** `https://platform.claude.com/docs/en/agent-sdk/*` answers **307 Temporary Redirect** to `https://code.claude.com/docs/en/agent-sdk/*`. The Agent SDK docs **no longer** live on `platform.claude.com`. Any link saved with the old domain needs updating.

---

## 1. Sources

| Source | URL | Date / version verified | What it confirms |
|---|---|---|---|
| Agent SDK overview | https://code.claude.com/docs/en/agent-sdk/overview | checked 2026-08-02 | What the SDK is, the commercial license, the ban on claude.ai login for third parties |
| TypeScript reference | https://code.claude.com/docs/en/agent-sdk/typescript.md | checked 2026-08-02 (265 KB of markdown) | Exact types: `Options`, `AgentDefinition`, `CanUseTool`, `PermissionResult`, `SDKResultMessage`, `HookEvent`, `createSdkMcpServer`, `tool()` |
| Subagents in the SDK | https://code.claude.com/docs/en/agent-sdk/subagents.md | checked 2026-08-02 | Context isolation, what a subagent inherits, per-subagent model, resuming subagents |
| Configure permissions | https://code.claude.com/docs/en/agent-sdk/permissions.md | checked 2026-08-02 | Permission evaluation order (6 steps), modes |
| Handle approvals and user input | https://code.claude.com/docs/en/agent-sdk/user-input.md | checked 2026-08-02 | `canUseTool` can stay pending **indefinitely**; the `defer` alternative |
| Hooks (SDK) | https://code.claude.com/docs/en/agent-sdk/hooks.md | checked 2026-08-02 | Table of 31 events, matchers, per-event timeouts |
| Hooks (Claude Code, defer section) | https://code.claude.com/docs/en/hooks.md | checked 2026-08-02 | The full `permissionDecision: "defer"` round-trip |
| Work with sessions | https://code.claude.com/docs/en/agent-sdk/sessions.md | checked 2026-08-02 | Capturing `session_id`, `resume`, `forkSession` |
| Persist sessions to external storage | https://code.claude.com/docs/en/agent-sdk/session-storage.md | checked 2026-08-02 | The `SessionStore` interface (S3/Redis/Postgres) — **key for multi-user** |
| Hosting the Agent SDK | https://code.claude.com/docs/en/agent-sdk/hosting.md | checked 2026-08-02 | Subprocess model, Dockerfile, RAM/CPU, multi-tenant isolation |
| Securely deploying AI agents | https://code.claude.com/docs/en/agent-sdk/secure-deployment.md | checked 2026-08-02 | Hardened `docker run` flags, credential-proxy pattern |
| Track cost and usage | https://code.claude.com/docs/en/agent-sdk/cost-tracking.md | checked 2026-08-02 | `total_cost_usd`, `usage`, `modelUsage`, dedup by `message.id` |
| Give Claude custom tools | https://code.claude.com/docs/en/agent-sdk/custom-tools.md | checked 2026-08-02 | In-process `tool()` + `createSdkMcpServer()` |
| Quickstart (auth) | https://code.claude.com/docs/en/agent-sdk/quickstart.md | checked 2026-08-02 | Node 18+, `ANTHROPIC_API_KEY`, bundled CLI binary |
| npm registry | https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk | **v0.3.220**, published **2026-07-24T23:11:19Z** | Version, engines, peerDeps, optional per-platform binaries |
| GitHub API — TS SDK | https://api.github.com/repos/anthropics/claude-agent-sdk-typescript | push **2026-07-25**, 1,668 ★, 176 open issues, not archived | Actively maintained (near-daily releases) |
| GitHub API — demos | https://api.github.com/repos/anthropics/claude-agent-sdk-demos | push **2026-03-13**, 2,698 ★, 33 issues, not archived | **Demos ~5 months behind** the SDK |
| TS repo README | https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/README.md | checked 2026-08-02 | License = Anthropic Commercial ToS, **not OSS** |

**Verified npm publishing cadence** (last 5): 0.3.216 (2026-07-20), 0.3.217 (07-21), 0.3.218 (07-22), 0.3.219 (07-24), 0.3.220 (07-24). That is, **near-daily releases**. The repo's latest commits are all `chore: Update CHANGELOG.md` — the real source code is **not** in that repo (`language: Shell`); it's a distribution/changelog/issues repo.

---

## 2. `AgentDefinition`: exact fields

Copied verbatim from https://code.claude.com/docs/en/agent-sdk/typescript.md (section `### AgentDefinition`):

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

Only **`description` and `prompt` are required**. There's no `systemPrompt` or `instructions` field inside `AgentDefinition` (the subagent's system prompt **is** the `prompt` field).

A real usage snippet, copied from https://code.claude.com/docs/en/agent-sdk/subagents.md:

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

**Critical operational detail:** you must include **`"Agent"`** in `allowedTools`, or subagent invocations fall into `canUseTool` (or get denied in `dontAsk` mode). Documented in "Troubleshooting → Claude not delegating to subagents". (In APM's code the tool is *declared* as `Task` — see the comment in `api/agent.js`.)

Subagents can also be defined as markdown files in `.claude/agents/`. Programmatically defined ones **take precedence** over on-disk ones with the same name.

---

## 3. Per-subagent context isolation

Verbatim quote (subagents.md → "Context isolation"):

> Each subagent runs in its own fresh conversation. Intermediate tool calls and results stay inside the subagent; only its final message returns to the parent.

And the exact table of what it inherits (subagents.md → "What subagents inherit"):

| The subagent **gets** | The subagent does **NOT** get |
|---|---|
| Its own system prompt (`AgentDefinition.prompt`) and the `Agent` tool's prompt | The parent's conversation history or tool results |
| The project's CLAUDE.md (loaded via `settingSources`) | Preloaded skill content, unless listed in `AgentDefinition.skills` |
| Tool definitions (inherited from the parent or the `tools` subset) | The parent's system prompt |

> "A subagent's context window starts fresh, with no parent conversation, but isn't empty. The only content you pass from parent to subagent is the Agent tool's prompt string, so include any file paths, error messages, or decisions the subagent needs directly in that prompt."

**Direct answer:** it does NOT share history with the orchestrator. The only parent→child channel is the `Agent` call's prompt string; the only child→parent channel is the subagent's final message (which the parent can summarize).

Verified consequences that affect APM's design:

- **Subagents run in the background by default** since Claude Code v2.1.198. If the orchestrator omits `run_in_background`, the call is non-blocking. `background: true` in the `AgentDefinition` always forces background.
- **Nesting:** by default a subagent can launch subagents up to **3 layers** below the main conversation (v2.1.219+). Controlled with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; setting it to `1` disables nesting.
- **The tool is called `Agent`, not `Task`.** Renamed in Claude Code v2.1.63. Current versions emit `"Agent"` in `tool_use` blocks but **still use `"Task"`** in the `system:init` tool list and in `result.permission_denials[].tool_name`. Check both values.
- **Subagent output scanning** (v2.1.210+): before the parent reads the final message, Claude Code neutralizes instruction-shaped patterns (`<system-reminder>`, `Human:`/`Assistant:`, mentions of permission settings) and prepends a `[harness: ...]` line. It never deletes or rewrites text. It's a built-in agent-to-agent prompt-injection mitigation.
- Subagent transcripts **persist separately** from the main one and survive compaction of the main thread. They can be resumed by `agentId` (shown as `agentId: <id>` text in the `Agent` tool result) by resuming the **same session**. The built-in `Explore` and `Plan` agents are one-shot and **don't** return an `agentId`.

---

## 4. A different model per subagent

**Yes.** The `model` field in `AgentDefinition`. Accepted values, verbatim from the TypeScript reference table:

> `model` — Model override for this agent. Accepts an alias such as `'fable'`, `'opus'`, `'sonnet'`, `'haiku'`, `'inherit'`, or a full model ID. If omitted or `'inherit'`, uses the main model.

Verified aliases: **`fable`, `opus`, `sonnet`, `haiku`, `inherit`**. It also accepts the full model ID. For the list of valid IDs the docs point to `/docs/en/model-config#available-models` — **NOT VERIFIED**, I didn't download that page, so I don't cite specific model IDs here.

A real example (subagents.md → "Dynamic agent configuration"):

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

The main model is set with `Options.model` (alias or full name) and can be changed on the fly with `query.setModel(model?)` (streaming input mode only; `undefined` or `"default"` restores the session's default model).

`AgentDefinition` also accepts `effort` (`'low' | 'medium' | 'high' | 'xhigh' | 'max' | number`) and `maxTurns` per subagent — useful to bound cost per role.

---

## 5. Sessions for a multi-user web service with restarts

### 5.1 Where state is stored by default

Verbatim from hosting.md:

| State | Default location |
|---|---|
| Session transcripts | `~/.claude/projects/`, or the `projects/` directory under `CLAUDE_CONFIG_DIR` if set |
| `CLAUDE.md` memory files | `~/.claude/CLAUDE.md` (user level) and the session's working directory (project level) |
| Working directory artifacts | The session's working directory |

> "None of them survive a container restart, a scale-down, or a move to a different node."

Also: **the SDK launches one `claude` subprocess per session** and talks to it over stdio. One active session = one process. It's not a stateless API wrapper.

### 5.2 The right answer for APM: `sessionStore`

There's a `sessionStore` option in `Options` that mirrors transcripts to an external backend (S3, Redis, Postgres or your own adapter). The exact interface (session-storage.md):

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

The "hybrid sessions" pattern Anthropic recommends for exactly our case (hosting.md):

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

Verified `SessionStore` behavior:
- **Transcripts only.** It doesn't mirror `CLAUDE.md` or working-directory artifacts.
- **A mirror, not a replacement.** The subprocess writes to local disk first; the store gets a copy. Local stays authoritative.
- **Failures:** a rejected batch is retried up to 3 times with backoff (a timeout isn't retried). If it keeps failing the SDK drops it, emits `{ type: "system", subtype: "mirror_error" }` and **carries on** with the query. You need to alert on those messages.
- `listSubkeys` is needed to restore subagent transcripts; if not implemented, only the main transcript is restored.
- `forkSession` isn't a byte-for-byte copy.
- `loadTimeoutMs` (default `60000`) bounds each `load()`/`listSubkeys()` — marked *Alpha* in the docs.
- `sessionStoreFlush: 'batched' | 'eager'` (default `'batched'`) — also *Alpha*.

### 5.3 `resume` / `forkSession` / `sessionId`

- The `session_id` is read from the `session_id` field of the `result` message (present in **every** result, success or error), and earlier in the init `SDKSystemMessage`.
- `Options.resume: string` → the session ID to resume.
- `Options.forkSession: boolean` (default `false`) → when resuming, forks to a new ID instead of continuing the original.
- `Options.sessionId: string` → **lets you set the session UUID yourself** instead of auto-generating it. Very useful to tie it to a row in our DB.
- `Options.persistSession: boolean` (default `true`) → `false` disables disk persistence (the session can't be resumed).
- `Options.resumeSessionAt: string` → resume at a specific message UUID.
- `Options.continue: boolean` → continues the most recent conversation (requires `listSessions` in the store if `sessionStore` is used).

Capturing the ID (sessions.md), a real snippet:

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

⚠️ Note the `try/catch`: **a single-shot `query()` throws after emitting the error result**. Always wrap it.

### 5.4 Multi-tenant isolation (mandatory if APM is ever sold)

Verbatim snippet from hosting.md → "Multi-tenant isolation":

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

The four measures, verbatim:
1. `settingSources: []` so no configuration is loaded from the file system.
2. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` — **the "auto memory" in `~/.claude/projects/<project>/memory/` is loaded into the system prompt REGARDLESS of `settingSources`**. Without this flag, context leaks between tenants.
3. `CLAUDE_CONFIG_DIR` pointing at a per-tenant directory (otherwise they share `~/.claude.json`).
4. A per-tenant `cwd`, passed **explicitly on every `query()`**.

Plus: per-tenant egress rules in the proxy (different IPs, credentials, domain allowlists).

Verified `SettingSource`:
```typescript
type SettingSource = "user" | "project" | "local";
```
| Value | Location |
|---|---|
| `'user'` | `~/.claude/settings.json` |
| `'project'` | `.claude/settings.json` |
| `'local'` | `.claude/settings.local.json` |

If `settingSources` is omitted, **it loads all three** (like the CLI). Precedence: local > project > user; programmatic options beat all three; managed policy beats everything.

### 5.5 Scaling

Verbatim formula from hosting.md:
```text
agents per host = (host RAM - overhead) / (per-session RAM ceiling)
```
Recommended starting point: **1 GiB RAM, 5 GiB disk and 1 CPU per agent**. For the "long-running sessions" pattern, a pool of containers behind a load balancer with **consistent hashing on `sessionId`** to pin each session to its container.

Known limitations declared by Anthropic:
- **There's no high-level session timeout.** A session doesn't expire on its own; bound it with `maxTurns`.
- Memory growth in long sessions → recycle subprocesses.
- Large fan-outs of parallel subagents can hit rate limits → small batches.
- **There's no per-subagent wall-clock deadline**; only `maxTurns` per `AgentDefinition` and `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` (a stall watchdog, background subagents only, default `600000` ms).

---

## 6. `canUseTool`: exact signature and asynchronous human approval

Verbatim signature (typescript.md):

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

Return value:

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

A real snippet (user-input.md):

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

### Can the promise be held open? Is there a timeout?

Verbatim quote from user-input.md, introductory paragraph:

> "The callback can stay pending indefinitely. Execution remains paused until your callback returns, and the SDK only cancels the wait when the query itself is cancelled. If a user might take longer to respond than your process can reasonably stay running, return the [`defer` hook decision], which lets the process exit and resume later from the persisted session."

And in the type reference:

> "Returning `null` in any other case leaves the tool call blocked indefinitely, because no `control_response` is ever sent and **permission prompts don't time out**."

**Direct answer: yes, the promise can be held open, and there is NO timeout.** For APM that means two paths:

**Path A — keep the promise alive** (the user approves from the UI within minutes). It works as long as the Node process and the `claude` subprocess stay alive. Fragile against a `docker compose up --build`.

**Path B — `defer` (recommended for APM, survives restarts).** A verified round-trip (code.claude.com/docs/en/hooks.md → "Defer a tool call for later"):

1. Claude calls the tool. The `PreToolUse` hook fires.
2. The hook returns `permissionDecision: "defer"`. The tool doesn't run. The process **exits** with `stop_reason: "tool_deferred"` and the pending call preserved in the transcript.
3. Your process reads `deferred_tool_use` from the SDK result, shows the request in your UI and waits for an answer.
4. Your process resumes with `resume: <session-id>`. The same call fires `PreToolUse` again.
5. The hook returns `permissionDecision: "allow"` with the answer in `updatedInput`. The tool runs and Claude continues.

A real payload:
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

**Hard constraint on `defer`:** it only works if Claude makes a **single** tool call in that turn. If it makes several at once, `defer` is ignored with a warning and the tool goes through the normal permission flow. Also, `defer` is only honored in non-interactive mode (`-p`), which is the SDK's case.

If the tool no longer exists on resume (e.g. an MCP server that didn't connect), the process exits with `stop_reason: "tool_deferred_unavailable"` and `is_error: true`. (SPIKE-01 found that for in-process MCP servers this is NOT what happens in practice — see `SPIKE-01-defer.md`.)

### Other verified `canUseTool` traps

- **It isn't called for auto-approved tools.** The evaluation order is: **1) Hooks → 2) deny rules → 3) ask rules → 4) permission mode → 5) allow rules → 6) `canUseTool`**. If you put a bare `"Bash"` in `allowedTools`, your callback will **never** see a Bash call.
- For logic that must apply to **every** call, the docs say explicitly: use a `PreToolUse` hook, not `canUseTool`.
- Since v2.1.198 the TypeScript SDK emits a `process warning` with code `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` if you pass an unreachable `canUseTool` (because of `bypassPermissions` or bare entries in `allowedTools`). Worth listening for in development.
- `AskUserQuestion`, MCP tools marked `requiresUserInteraction`, and connector tools the organization set to `ask` **always** reach the callback, even with an allow rule. In `dontAsk` mode they're denied without calling it.
- Before Claude Code v2.1.207, an `allow` without `updatedInput` was rejected with a validation error. With the current SDK it's no longer needed, but passing `updatedInput: input` is the safest.
- `query.reinitialize()` (Claude Code v2.1.195+) resends `initialize` after a transport drop so pending permission requests reach the callback again. **Make the callback idempotent by `requestId`**, because a request whose answer was lost gets dispatched again.
- Returning `null` is for when your app already sent the `control_response` through its own channel (e.g. a signed HTTP POST) echoing the `requestId`. Requires Claude Code v2.1.199+.

Verified `PermissionMode`:
```typescript
type PermissionMode =
  | "default"            // Standard permission behavior
  | "acceptEdits"        // Auto-accept file edits
  | "bypassPermissions"  // Bypass permission checks; explicit ask rules still prompt
  | "plan"               // Planning mode - explore without editing
  | "dontAsk"            // Don't prompt for permissions, deny if not pre-approved
  | "auto";              // Model classifier approves or denies permission prompts
```
`bypassPermissions` also requires `allowDangerouslySkipPermissions: true`.

---

## 7. Hooks: events, signature and the ability to deny

The full verbatim list (`HookEvent`, typescript.md) — **31 events**:

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

Signature:
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

Registration:
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

### Can they deny? Yes.

`SyncHookJSONOutput` (verbatim excerpt, relevant fields):

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

There's also the asynchronous variant:
```typescript
type AsyncHookJSONOutput = {
  async: true;
  asyncTimeout?: number;
};
```

`BaseHookInput` (every hook extends it):
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
`agent_id`/`agent_type` are filled in when the hook fires **inside a subagent** — the natural hook to attribute cost and auditing per subagent in APM.

Verified hook timeouts: when `timeout` is omitted, Claude Code applies the event's default — **10 minutes** for most, **30 s** for `UserPromptSubmit`, **10 s** for `MessageDisplay`, a **1.5 s** budget for `SessionEnd`.

Matchers: if it only contains letters, digits, `_`, `-`, spaces, `,` and `|` → exact match with alternatives separated by `|` or `,`. Any other character → an **unanchored regex**. `*`, an empty string or omitting it → matches everything. MCP tools follow `mcp__<server>__<action>`; a bare `mcp__memory` **matches nothing**, you have to write `mcp__memory__.*`.

An evaluation-order detail that matters: **a hook that returns `allow` does NOT skip deny or ask rules**; those are evaluated anyway.

---

## 8. `createSdkMcpServer` and `tool()`: in-process custom tools

Verbatim signatures (typescript.md):

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

A complete real snippet (custom-tools.md):

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

Verified notes:
- The server goes in `Options.mcpServers`; the object's **key** is the `{server_name}` in the qualified name `mcp__{server_name}__{tool_name}`. That full name must be listed in `allowedTools` for it to run without a prompt.
- `inputSchema` accepts **Zod 3 and Zod 4** (declared peerDependency: `zod: ^4.0.0`).
- Optional fields in TS: `.default()` on the Zod field.
- `alwaysLoad` (per tool or per server) keeps the schema in the initial prompt instead of deferring it behind *tool search*.
- There's `Options.toolAliases`, e.g. `{ Bash: 'mcp__workspace__bash' }`, to **replace a built-in tool with your MCP implementation**. Interesting for APM if we want a controlled Bash.
- `strictMcpConfig: true` ignores the project's `.mcp.json`, user settings, plugin MCPs and claude.ai connectors. **Recommended in a multi-tenant service.**

---

## 9. Cost and usage per turn

`SDKResultMessage` fields (verbatim, success branch):

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
      /* ...the same cost fields: total_cost_usd, usage, modelUsage... */
      errors: string[];
    };
```

### ⚠️ A finding that changes the billing design

Verbatim table from cost-tracking.md:

| Field | Subagent activity |
|---|---|
| `usage` | **Excluded.** Counts only the main agent loop; tokens consumed inside subagents are NOT added |
| `total_cost_usd` | **Included.** Counts subagent requests along with the main loop |
| `modelUsage` / `model_usage` | **Included.** Broken down by model |

> "Use `modelUsage` for whole-tree token accounting; the `usage` field undercounts as soon as nesting occurs."

In APM, which is a subagent orchestrator, **using `usage` for billing would systematically undercount**. Use `total_cost_usd` (total) and `modelUsage` (breakdown).

A real per-model breakdown snippet:

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

### In streaming (per step)

Each `assistant` message carries a `BetaMessage` nested in `message.message` with `id` and `usage`. **Parallel tool calls produce several messages with the SAME `id` and the same `usage`** → you must dedupe by ID or you inflate the counter. A real snippet:

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

Other verified facts:
- **There's no per-session total.** Each `query()` reports its own `total_cost_usd`; accumulating is our job.
- `Options.maxBudgetUsd` cuts the query when the **client-side** cost estimate reaches that value; it's compared against the same estimate as `total_cost_usd`. The result comes out with `subtype: "error_max_budget_usd"` (and **still carries** the cost fields).
- `total_cost_usd` is a **client-side estimate**, not an invoice. The docs call it a "client-side cost estimate".
- `permission_denials` in the result lets you audit what was blocked.
- OpenTelemetry: the SDK inherits the environment's configuration (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_*`). Prompts and tool inputs are **not** exported by default.

---

## 10. Authentication and server runtime (critical for the Dockerfile)

### Is `ANTHROPIC_API_KEY` enough?

**Yes.** hosting.md: *"the subprocess reads `ANTHROPIC_API_KEY` from its environment"*. quickstart.md: *"The SDK reads the key from the environment of the process that runs your agent; it doesn't load `.env` files automatically."* — if the key is stored in `.env`, we have to load it ourselves (e.g. `dotenv`, or the container's `env_file`) before calling the SDK.

Verified provider alternatives: `CLAUDE_CODE_USE_BEDROCK=1`, `CLAUDE_CODE_USE_ANTHROPIC_AWS=1` + `ANTHROPIC_AWS_WORKSPACE_ID`, `CLAUDE_CODE_USE_VERTEX=1`, `CLAUDE_CODE_USE_FOUNDRY=1`. Also `ANTHROPIC_BASE_URL` to route through a proxy that injects the key outside the container.

⚠️ **A verbatim legal restriction** (overview.md and quickstart.md):
> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

That is: **APM can't let customers authenticate with their claude.ai subscription.** Either we use our API key (and bill), or each tenant brings their own.

### Does the Claude Code CLI need to be installed in the container?

**NO.** Verified in two places:

> "Both SDK packages bundle a native Claude Code binary for the host platform, so no separate Claude Code or Node.js install is needed for the spawned CLI" (hosting.md)

> "The SDK bundles a native Claude Code binary for your platform as an optional dependency such as `@anthropic-ai/claude-agent-sdk-darwin-arm64`. You don't need to install Claude Code separately. The SDK version tracks the bundled Claude Code version: SDK v0.3.191 bundles Claude Code v2.1.191... If your package manager skips optional dependencies, the SDK throws `Native CLI binary for <platform> not found`; set `pathToClaudeCodeExecutable` to a separately installed `claude` binary instead." (typescript.md)

**Direct consequences for our Dockerfile:**
- **DON'T use `npm ci --omit=optional` or `--no-optional`.** It would break the native binary. (See the comment in `api/Dockerfile`.)
- The published optional packages (verified on npm) are: `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`. **There are musl variants** → an Alpine base image is viable.
- If we compile to a single binary with `bun build --compile`, use `extractFromBunfs()` and `pathToClaudeCodeExecutable`. Not applicable if we deploy with plain Node.
- **The SDK version IS the CLI version.** Upgrading the SDK is the only way to upgrade the CLI. Patch-number correspondence: SDK v0.3.220 ⇒ Claude Code v2.1.220 (pattern documented with the example v0.3.191 ⇒ v2.1.191; the exact correspondence for 0.3.220 is my inference, **NOT VERIFIED** directly).

### Runtime dependencies

| Item | Verified value | Source |
|---|---|---|
| Node.js | **>= 18.0.0** (package `engines`) / "Node.js 18+" | npm registry + quickstart |
| Direct dependencies | **none** (`dependencies: null`) | npm registry |
| peerDependencies | `zod: ^4.0.0`, `@anthropic-ai/sdk: >=0.93.0`, `@modelcontextprotocol/sdk: ^1.29.0` | npm registry |
| Supported JS runtime | `'bun' \| 'deno' \| 'node'` (`executable` option, auto-detected) | typescript.md |
| Resources per agent | 1 GiB RAM, 5 GiB disk, 1 CPU (starting point) | hosting.md |
| Outbound network | HTTPS to `api.anthropic.com` (+ MCP endpoints) | hosting.md |
| Inbound network | The subprocess **doesn't listen on the network**; your app exposes the port | hosting.md |

⚠️ **NOT VERIFIED:** whether the native binary needs extra `glibc`/`libstdc++` in a `node:22-slim` (Debian) image. The docs don't say. It has to be tested empirically when building the image.

⚠️ **NOT VERIFIED:** whether the subprocess needs `git`, `ripgrep` or other binaries on the PATH for the Grep/Glob/Bash tools to work. The docs say "the container needs only your SDK's language runtime", but that refers to the SDK, not to what the agent's tools may invoke. It has to be tested.

---

## 11. Secure deployment: official recommendations

A hardened container configuration, **copied verbatim** from secure-deployment.md:

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

The docs' explicit warning about volumes: *"**Avoid mounting sensitive host directories like `~/.ssh`, `~/.aws`, or `~/.config`**"*.

Isolation technology table (verbatim):

| Technology | Isolation strength | Overhead | Complexity |
|---|---|---|---|
| Sandbox runtime | Good (secure defaults) | Very low | Low |
| Containers (Docker) | Depends on setup | Low | Medium |
| gVisor | Excellent (with correct setup) | Medium/High | Medium |
| VMs (Firecracker, QEMU) | Excellent (with correct setup) | High | Medium/High |

There's `@anthropic-ai/sandbox-runtime` (https://github.com/anthropic-experimental/sandbox-runtime): OS-level isolation without Docker, using `bubblewrap` on Linux, JSON allowlists for domains and paths, and a built-in proxy. Admitted limitation: **it doesn't do TLS inspection**, so the allowlist relies on the hostname the client declares and is vulnerable to domain fronting.

The credentials principle (**the most relevant for APM**):
> "rather than giving an agent direct access to an API key, you could run a proxy outside the agent's environment that injects the key into requests. The agent can make API calls, but it never sees the credential itself. This pattern is useful for multi-tenant deployments."

Other defenses already built into Claude Code:
- Bash commands are parsed into an AST before permission rules apply; anything that doesn't parse cleanly requires explicit approval; `eval` always requires approval. The docs clarify: *"This is a permission gate, not a sandbox"*.
- Web search results are summarized instead of injected raw (a prompt-injection mitigation).
- `Options.sandbox` (`SandboxSettings`) to configure sandbox mode programmatically.

Auth when hosting (verbatim):
- **Inbound:** *"put authentication at a gateway in front of the agent container. The agent should receive pre-authenticated requests and should not be the component that validates user tokens."*
- **Outbound tool calls:** *"keep tool credentials out of the agent environment. Route outbound calls through a proxy that injects API keys after the request leaves the container."*

---

## 12. The best rated on GitHub (open search)

Search done with the GitHub Search API on 2026-08-02, sorted by stars, over 4 different queries (`ai agent framework language:TypeScript`, `agent sdk typescript stars:>500 pushed:>2026-02-01`, `llm agent orchestration language:TypeScript stars:>1000`, `agents framework language:TypeScript stars:>2000 pushed:>2026-05-01`). Stars, license and last push verified one by one via `api.github.com/repos/...`; npm versions via `registry.npmjs.org`.

| Repo | ★ | License (GitHub / npm) | Last push | Open issues | npm package (latest, date) |
|---|---:|---|---|---:|---|
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra) | 26,826 | Other (npm `@mastra/core`: **Apache-2.0**) | 2026-08-02 | 594 | `@mastra/core` 1.55.0 (2026-07-30), engines **node >= 22.13** |
| [vercel/ai](https://github.com/vercel/ai) (AI SDK) | 25,958 | Other (npm `ai`: **Apache-2.0**) | 2026-08-02 | 1,714 | `ai` 7.0.48 (2026-08-01), engines **node >= 22** |
| [VoltAgent/voltagent](https://github.com/VoltAgent/voltagent) | 10,249 | **MIT** | 2026-07-13 | 79 | `@voltagent/core` 2.9.0 (2026-07-08) |
| [genkit-ai/genkit](https://github.com/genkit-ai/genkit) | 6,309 | **Apache-2.0** | 2026-08-01 | 672 | (not verified) |
| [openai/openai-agents-js](https://github.com/openai/openai-agents-js) | 3,513 | **MIT** | 2026-08-02 | 33 | `@openai/agents` 0.14.2 (2026-08-01) |
| [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) | 3,167 | **MIT** | 2026-08-01 | 96 | `@langchain/langgraph` 1.4.8 (2026-07-15) |
| **anthropics/claude-agent-sdk-typescript** | **1,668** | **No OSS license — Anthropic Commercial ToS** | 2026-07-25 | 176 | `@anthropic-ai/claude-agent-sdk` **0.3.220** (2026-07-24), engines node >= 18 |
| [inkeep/agents](https://github.com/inkeep/agents) | 1,340 | Other | 2026-07-31 | 37 | (not verified) |

*(Note: the search also returned high-star repos that are NOT comparable agent frameworks — `heygen-com/hyperframes`, `langgenius/dify`, `medusajs/medusa`, `elizaOS/eliza`, `humanlayer/12-factor-agents` (no push since 2025-09-21, dead) — I left them out of the table as they're not direct competitors for APM's agent core.)*

### Does this change our decision?

**No. I recommend staying with the Claude Agent SDK**, but it's worth being honest about what we're accepting and about one real risk.

**Why the Claude Agent SDK wins for APM despite having 15× fewer stars:**

1. **It's the only one that ships the complete "harness", not just the loop.** Mastra, VoltAgent, OpenAI Agents JS and LangGraph JS give you orchestration, but **you have to build** the file-system tools, the bash executor, command parsing into an AST for permissions, context compaction, file checkpointing, skills and transcript persistence. The Agent SDK is literally Claude Code as a library: all of that is already there and tested at scale.
2. **APM is an "agent command center"**, and everything we need (subagents with isolated context, hooks for 31 events, `canUseTool` with human approval, `defer` that survives restarts, an external `SessionStore`, per-model `modelUsage`, documented multi-tenant isolation) is **specified and supported**. None of the others documents the "human approval that takes minutes and the process may die" pattern as deeply as the `defer` section.
3. **Superior maintenance cadence**: near-daily npm releases (5 versions in 5 days). Mastra and Vercel AI also push daily, but VoltAgent hasn't pushed in 3 weeks and LangGraph JS publishes every ~2 weeks.
4. Node **>= 18** (the other big ones, Mastra and Vercel AI, require **Node >= 22**). Less friction with our current base.

**What we're consciously accepting (the cons, unvarnished):**

1. 🔴 **License. This is the point that should weigh the most.** The `anthropics/claude-agent-sdk-typescript` repo **has no OSS license** (`license: None` in the GitHub API; npm says `"SEE LICENSE IN README.md"`). The README points to the *Anthropic Commercial Terms of Service*, "including when you use it to power products and services that you make available to your own customers and end users". **Mastra, VoltAgent, OpenAI Agents JS, LangGraph JS and Genkit are all Apache-2.0 or MIT.** If APM is going to be sold as SaaS to third parties, this needs a careful read before committing the architecture. I'm not a lawyer and **I haven't assessed** whether the Commercial ToS allow our resale model — I mark it as an open risk, not a blocker.
2. 🔴 **Vendor lock-in.** The Agent SDK only runs Claude models (direct, Bedrock, Vertex, Foundry). Mastra, the Vercel AI SDK and LangGraph JS are multi-model. If APM ever needs to offer GPT or Gemini, the core has to be rewritten. The others give it for free.
3. 🟡 **Subprocess architecture.** One `claude` process per session, ~1 GiB RAM each. Mastra/VoltAgent/LangGraph run **in-process**, so their density per VPS is much higher. On a modest VPS this seriously limits APM's real concurrency. It's the cost of having the complete harness.
4. 🟡 **`anthropics/claude-agent-sdk-demos` is out of date** (last push 2026-03-13, ~5 months). Don't copy patterns from there without checking them against the current docs: the API has changed quite a bit (e.g. `Task` → `Agent`, subagents in the background by default).

**The only case in which I'd reconsider:** if point (1) turns out incompatible with selling APM to third parties, or a multi-model requirement appears. In that scenario **Mastra** (26.8k ★, Apache-2.0, daily pushes, an ecosystem of workflows/memory/evals) would be the most sensible replacement, accepting that we'd have to build the tools-and-permissions harness Anthropic gives us today. VoltAgent (MIT, 79 open issues, very clean) is the lightest alternative if orchestration is enough.

---

## 13. ⚠️ Corrections to earlier assumptions

Things the earlier research took as given that **aren't** true:

| Earlier assumption | Verified reality |
|---|---|
| The Agent SDK docs live at `platform.claude.com/docs/en/agent-sdk/*` | **It 307-redirects to `code.claude.com/docs/en/agent-sdk/*`.** Every link needs updating. |
| `AgentDefinition` has `instructions` and/or `systemPrompt` fields | **False.** The required fields are `description` and `prompt`. There's no `instructions` or `systemPrompt` in `AgentDefinition`. (An automatic summary of the reference page returned an invented version with `instructions`/`systemPrompt`; reading the raw `.md` shows they don't exist. Careful: **fetching these pages through a summarizer produces fake types**.) |
| `CanUseTool` receives a `CanUseToolRequest` object with `tool_name`, `tool_use_id`, `raw_input` | **False.** The real signature is **3 positional arguments**: `(toolName, input, options)`. |
| `PermissionResult` uses `{ allowed: true }` / `{ ask: true }` | **False.** It uses `{ behavior: "allow", updatedInput?, updatedPermissions?, toolUseID? }` or `{ behavior: "deny", message, interrupt?, toolUseID? }`. |
| `SDKResultMessage.usage` is fine for billing | **Dangerously false in APM.** `usage` **excludes** subagent tokens. For the whole tree, use `total_cost_usd` and `modelUsage`. |
| The Claude Code CLI must be installed in the Docker image | **False.** The npm package ships a native per-platform binary as an *optionalDependency*. A separate install is only needed if optional deps are skipped. |
| Node 20 or 22 minimum | **Node >= 18.0.0** according to `engines`. |
| The subagent tool is called `Task` | Renamed to **`Agent`** in Claude Code v2.1.63. But `Task` **still shows up** in `system:init.tools` and in `permission_denials[].tool_name` → check both. |
| Subagents run in the foreground by default | Changed in v2.1.198: **they run in the background by default** if the model omits `run_in_background`. |
| Multi-tenant isolation is achieved with `settingSources: []` | **Insufficient.** The *auto memory* in `~/.claude/projects/<project>/memory/` is loaded **ignoring `settingSources`**. You also need `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-tenant `CLAUDE_CONFIG_DIR` and a per-tenant `cwd`. |
| `canUseTool` intercepts every tool call | **False.** It's step 6 of 6. Any bare `allowedTools` entry, allow rule or `acceptEdits`/`bypassPermissions` mode short-circuits it. To intercept EVERYTHING, use a `PreToolUse` hook. |
| There's some approval timeout | **There isn't.** Permission promises never expire. Neither in `canUseTool` nor in `defer`. |
| Sessions expire on their own | **No.** "No top-level session timeout". Bound them with `maxTurns` and/or `maxBudgetUsd`. |
| The `claude-agent-sdk-demos` repo is a current reference | Last push **2026-03-13**, ~5 months behind. Its patterns may be obsolete. |
| The Agent SDK is open source | **No.** No OSS license; governed by the *Anthropic Commercial Terms of Service*. |

---

## 14. Risks and unknowns (NOT VERIFIED)

1. **NOT VERIFIED — Commercial license and resale.** I haven't read the full *Anthropic Commercial Terms of Service*. I can't say whether APM may bill third parties for Agent SDK usage with our API key, or whether each tenant must bring their own. **This must be resolved before committing the architecture.**
2. **NOT VERIFIED — Valid model IDs.** I didn't download `/docs/en/model-config#available-models`. I know the aliases `fable`/`opus`/`sonnet`/`haiku`/`inherit` and "a full ID" are accepted, but **I don't cite any specific ID** so as not to invent it.
3. **NOT VERIFIED — The native binary's system dependencies.** Whether `node:22-slim` or `node:22-alpine` need extra packages (glibc, libstdc++, ca-certificates) for the binary to start. To be tested when building the image. (In practice `node:22-alpine` works — see `api/Dockerfile`.)
4. **NOT VERIFIED — Auxiliary binaries on the PATH.** Whether the agent's Grep/Glob/Bash tools require `ripgrep`, `git` or others installed in the container.
5. **NOT VERIFIED — SDK 0.3.220 ⇄ Claude Code 2.1.220 correspondence.** The pattern is documented with the example v0.3.191 ⇒ v2.1.191; extrapolating to 0.3.220 is my inference. It's confirmed at runtime by reading `claude_code_version` from the `SDKSystemMessage`.
6. **NOT VERIFIED — Reference `SessionStore` adapters.** The docs mention reference implementations for S3, Redis and Postgres, plus a *conformance suite*, in `session-storage#reference-implementations`. I didn't download that section or check whether the code is copyable or only descriptive.
7. **NOT VERIFIED — `SessionStore` + `defer` together.** There's no explicit confirmation that a deferred call (`tool_deferred`) survives a container restart when the transcript is only in the external store and not on local disk. The docs say the session "remains on disk until you resume it". **This is the integration point to test first in a spike**, because it's the basis of APM's human-approval flow. (Resolved: SPIKE-02 — it survives.)
8. **NOT VERIFIED — `canUseTool` behavior under `reinitialize()` in production.** The docs warn it must be idempotent by `requestId`, but I haven't tested the reconnection scenario.
9. **NOT VERIFIED — Real RAM usage.** The "1 GiB per agent" is the official starting point, explicitly described as "a floor, not the ceiling". Measure with our real load before sizing the VPS.
10. **NOT VERIFIED — the hosting cookbook.** `github.com/anthropics/claude-cookbooks/tree/main/claude_agent_sdk/hosting` reportedly has deployable Dockerfiles and K8s manifests. I haven't opened it; it might save work on the Dockerfile.
11. **NOT VERIFIED — The point-12 alternatives in depth.** For Mastra, VoltAgent, OpenAI Agents JS and LangGraph JS I only verified stars, license, last push, issues and npm version. **I didn't read their docs**, so my claims about their capabilities (in-process, multi-model, lack of a tool harness) are general knowledge, not verification from this session.
