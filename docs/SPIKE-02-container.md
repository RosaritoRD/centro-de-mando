# SPIKE 02 — does a deferred approval survive container recreation?

**Date:** 2026-08-03 · Closes the gap left open by `SPIKE-01-defer.md` · **Cost:** ~$0.35
**Code:** `spike/session-store-pg/` · **Run with:** `./tools/spike-02.sh`

---

## Verdict

> **YES.** With a `SessionStore` on Postgres, one container defers the tool and
> **a different container, with a clean disk**, resumes by `session_id`,
> approves, and **the tool really runs**.

With this, the project's #1 risk (`RESEARCH.md` §7) is fully closed: SPIKE 01
proved it survives the death of the **process**; this one proves it survives the
death of the **container**, which is what happens on every
`docker compose up -d --build`.

```
Container 1 (phase A)   defers the Write   → file does NOT exist · 14 entries in Postgres
                        [container destroyed]
Container 2 (phase B)   no transcript on disk ✓ · resumes from Postgres · approves
                        → file exists · "expense 12.50 coffee"
```

---

## Why the test is valid

Two things make it honest, and they cost more than the rest:

1. **They really are different containers.** Each phase is an independent
   `docker run --rm`. The first one's `~/.claude/` doesn't exist for the second.
2. **Phase B refuses to run if it finds the transcript on disk.** Without that
   guard, the test would pass anyway by resuming from the local file and prove
   nothing about Postgres. It's SPIKE 01's lesson: the verdict is the
   **observable effect** (a file with the right content), never what the model
   says or the `terminal_reason`.

It uses the **built-in `Write`** tool, not in-process MCP, because SPIKE 01
already showed that an `sdk` server doesn't reconnect on resume.

---

## The trap it found: the `projectKey` comes from the `cwd`

The SDK exposes no option to set the `projectKey`: it **derives it from the
sanitized `cwd`**. If the container's `WORKDIR` changes between deploys, the key
changes, `load()` finds nothing and the session doesn't resume.

Tested on purpose — same session, different `cwd`:

```
Error: Claude Code returned an error result:
No conversation found with session ID: 0c84131b-…
```

**The good news is how it fails: loudly**, with an exception and exit 1. It's
the opposite of the in-process MCP failure, which ended `completed` with no
error while the agent apologized. APM can detect and report this one.

**Consequence for APM:** the agent container's `WORKDIR` becomes part of the
data contract, not a packaging decision. Changing it invalidates every pending
approval.

---

## A suspicion that turned out false

The spike was written with `sessionStoreFlush: 'eager'`, assuming the default
`'batched'` would leave the last batch unwritten when the process died right on
the defer.

**False, and measured:** the full cycle passes just the same with `'batched'`. A
defer emits a `result` message, and the SDK flushes the mirror buffer on every
`result` — the defer **already is** a flush point. The default stays; `'eager'`
costs one `append()` per frame and buys nothing. `SPIKE_FLUSH` reproduces both.

---

## What the adapter implementation must respect

From the SDK contract (`sdk.d.ts`), not from intuition:

| Rule | Why |
|---|---|
| `uuid` is an **idempotency** key | The SDK retries `append()` 3 times and `importSessionToStore()` replays entries. Without `ON CONFLICT DO NOTHING` the transcript gets duplicated and the resumed session sees the turn twice |
| Some entries have **no `uuid`** | Titles, tags, mode markers. The contract says to append them without dedup → the unique index is **partial** (`WHERE entry_uuid IS NOT NULL`) |
| The order **is** the data | `load()` must return the same thing in the same order. That's why the PK is `BIGSERIAL` and not a UUID: a random UUID doesn't sort |
| `entry` is an **opaque blob** | The SDK documents its shape as CLI-internal; the only guarantee is the `JSON.stringify`/`parse` round-trip. JSONB may reorder keys and that's fine: the SDK never compares bytes |
| `delete()` is **optional** | Its absence is a valid no-op for append-only backends. It fits the project's policy: `apm_app` isn't granted DELETE |
| `listSubkeys()` is not optional *in practice* | Without it, resuming only materializes the main transcript and **the subagents' transcripts are lost** |

Also: `sessionStore` **can't be used with `persistSession: false`**. The mirror
fires after the local write, so the SDK keeps writing to disk. Postgres is the
copy that survives, not a replacement.

---

## What was left of Phase 2

The foundation is in place. What's left goes on top: Agent SDK in the backend,
orchestrator + 1 real subagent, streaming chat UI, per-run cost logging, and
human approval wired with `canUseTool` + hooks.

The rule that came out of SPIKE 01 still stands: **never accept an approval
based on `terminal_reason`.** APM verifies the effect. If the `approval` row
says `allow` but the tool left no trace, the run is `failed`, not `done`.

---

## How to reproduce it

```bash
cd /opt/centro-de-mando
docker exec -i n8n_postgres psql -U n8n -d apm < db/migrations/002_session_store.sql
./tools/spike-02.sh
```

`claude-haiku-4-5` on purpose: this tests plumbing, not intelligence.
