# SPIKE 01 — does a deferred approval survive a process restart?

**Date:** 2026-08-03 · **The project's #1 risk** (`RESEARCH.md` §7) · **Cost:** ~$0.15
**Code:** `spike/defer-survives/` — can be re-run.

---

## Verdict

> **YES, it survives.** One process defers the tool, dies, and **a different
> process** resumes by `session_id`, approves, and **the tool really runs**. The
> approval architecture in `ARCHITECTURE.md` §2 holds.

**But with a condition that wasn't in the design, and it changes things:**

> ⚠️ **APM's tools CANNOT be an in-process `createSdkMcpServer` if they go
> through approval.** On resume, `sdk`-type MCP servers **don't reconnect**, the
> tool disappears from the prompt, and the deferred run **is silently lost**.

---

## What exactly was tested

Two genuinely separate processes (`node a.mjs`, the process dies, `node b.mjs`),
not two calls inside the same one. The observable effect is a **file on disk**,
not what the model says it did: if the model answers "done, logged" and the file
is empty, the answer is NO.

| Test | Tool | A defers | B resumes and approves | Did it run? |
|---|---|---|---|---|
| 1 | In-process MCP (`createSdkMcpServer`) | ✅ `tool_deferred` | resumes | ❌ **No** |
| 2 | same + `alwaysLoad: true` | ✅ | resumes | ❌ No |
| 3 | same + `forkSession: true` | ✅ | resumes | ❌ No |
| 4 | same, empty prompt vs `"Continue."` | ✅ | resumes | ❌ No in either |
| **5** | **Built-in (`Write`)** | ✅ `tool_deferred` | resumes | ✅ **Yes** |

Test 5 settles it: **the `defer`/`resume` mechanism works**.

---

## The cause, measured rather than deduced

Same code, same options. The **only** difference is passing `resume`:

| | `init.mcp_servers` | sees the tool? |
|---|---|---|
| Process A (new session) | `[{"name":"spike","status":"connected"}]` | ✅ `mcp__spike__registrar_gasto` |
| Process B (`resume`) | `[]` | ❌ empty list |

The explanation is in the SDK's own types:

```ts
/**
 * MCP SDK server config with an actual McpServer instance.
 * Not serializable - contains a live McpServer object.
 */
export declare type McpSdkServerConfigWithInstance = McpSdkServerConfig & {
    instance: McpServer;
};
```

An in-process server is **a live object**. The resumed session is rebuilt from
disk, and a live object doesn't fit there. Even if it's passed again in
`options` — which is what the spike does — it doesn't reconnect.

### The worst part isn't that it fails: it's HOW it fails

The docs promise that if the deferred tool is no longer available, the process
exits with `stop_reason: "tool_deferred_unavailable"` and `is_error: true`.

**That's not what happens.** What arrives is:

```
terminal_reason: completed
assistant: "It seems I don't have access to that specific tool..."
```

A **successful** turn, with no error, where the agent apologizes. For APM that
means an approval tapped on a phone could be marked as completed without the
action ever happening. It's exactly the kind of failure this product can't
afford: the user believes they approved a send and the send never went out.

---

## What changes in the architecture

1. **Tools that go through approval are not in-process.** Either they're
   built-in, or they live in an MCP server rebuilt from serializable config
   (stdio or HTTP). Which one to use on the VPS is still to be measured — stdio
   costs a subprocess, HTTP requires TLS with a CA according to the SDK docs.

2. **⚠️ Correction to report E.** It recommended the email connector as an
   in-process `createSdkMcpServer`, and the security argument is still good
   (secrets never leave the process). But **sending an email is exactly what
   requires human approval**, so that connector can't be in-process for the
   sending part. Reading can stay in-process: nobody approves a `list_recent`.

3. **Never accept an approval based on `terminal_reason`.** APM must verify the
   **effect**, not the turn's status. If the `approval` row says `allow` but the
   tool left no trace, the run is `failed`, not `done`.

---

## What this spike did NOT test

Being honest about the edge: it tested a **process restart**, not a **container
recreation**. The session lives on disk under `~/.claude/projects/…`, which
disappears in a recreated container.

For APM's real case, a `sessionStore` (the SDK exposes the option, plus a
reference `InMemorySessionStore` and `importSessionToStore`) on Postgres still
had to be wired, or a volume mounted. **It's a smaller, already-scoped problem**:
the mechanism works, it just needs somewhere to keep the transcript.
(Done in SPIKE 02.)

---

## How to reproduce it

```bash
cd /opt/centro-de-mando/spike/defer-survives
set -a && . /opt/centro-de-mando/.env && set +a

node c-builtin.mjs a     # defers; the file does NOT exist
node c-builtin.mjs b     # new process: resumes, approves, the file appears

node a-difiere.mjs        # the in-process MCP case
node b2-aprueba-vacio.mjs # …which does not run, and says why
```

It uses `claude-haiku-4-5` on purpose: the spike tests plumbing, not
intelligence.
