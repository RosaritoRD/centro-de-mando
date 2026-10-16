# Category F — Automations and the n8n bridge

**Researched:** 2026-08-02
**Context:** APM will run at `apm.your-domain.com` (Claude Agent SDK), behind Nginx Proxy Manager (NPM),
with self-hosted n8n in Docker (6 workflows in production) and its own Postgres shared with n8n.

Everything marked ✅ is verified against a primary source (docs.n8n.io, the GitHub API, repos).
Anything marked ⚠️ NOT VERIFIED must not be taken as fact without checking it on the VPS.

---

## 1. Executive summary (the 3 decisions)

| Decision | Recommendation | Why, in one line |
|---|---|---|
| How does APM trigger n8n? | **n8n webhooks** (trigger) + **REST API** (reading/monitoring) | The REST API **has no endpoint to run workflows** — the webhook is the only real way to trigger. |
| MCP Server Trigger? | **Not for the main bridge.** Optional in phase 2 | It adds SSE, buffering, long sessions and one more failure point behind NPM, in exchange for nothing webhook+API don't give. |
| Scheduler? | **pg-boss** inside APM | The Postgres you already have, no new Redis, native cron, excellent maintenance (release 2026-08-01). |

(Note: in the end APM only uses the REST API, read-only, to monitor — see `api/n8n.js`.)

---

## 2. Comparison table of integration options

| Option | Direction | Transport | Auth | Triggers? | Monitors? | Risk with NPM | Verdict |
|---|---|---|---|---|---|---|---|
| **n8n webhook** | APM → n8n | Plain HTTP POST | Basic / Header / JWT ✅ | ✅ Yes | Partial (synchronous response) | **None** | ✅ **Chosen for triggering** |
| **Public REST API** (`/api/v1`) | APM → n8n | Plain HTTP | `X-N8N-API-KEY` ✅ | ❌ **No run/execute endpoint exists** | ✅ Complete (executions) | **None** | ✅ **Chosen for monitoring** |
| **MCP Server Trigger** | APM → n8n | SSE / Streamable HTTP | Bearer / Header ✅ | ✅ Yes (as a "tool") | ❌ No history | **HIGH** (buffering) | ⚠️ Phase 2, optional |
| **MCP Client Tool** | n8n → APM | SSE | Bearer/Header/OAuth2 ✅ | The **opposite** direction | — | Medium | ❌ Not useful for this case |
| **czlonkowski/n8n-mcp** | Claude → n8n (authoring) | stdio / HTTP | `N8N_API_KEY` | Yes (creates/edits workflows) | Yes | Low | ⚠️ Only for **building** workflows, never pointed at production |
| **n8n Schedule Trigger** | n8n → APM | Plain HTTP | APM's webhook auth | ✅ | ❌ | None | ⚠️ Only for tasks that already "belong" to n8n |

---

## 3. Critical finding: the n8n REST API does NOT run workflows

✅ **VERIFIED** — `https://docs.n8n.io/connect/n8n-api/workflow`

The real endpoints of the Workflow resource:

```
GET    /api/v1/workflows
POST   /api/v1/workflows
GET    /api/v1/workflows/{id}
PUT    /api/v1/workflows/{id}
DELETE /api/v1/workflows/{id}
GET    /api/v1/workflows/{id}/history
GET    /api/v1/workflows/{id}/{versionId}
POST   /api/v1/workflows/{id}/activate     # DEPRECATED
POST   /api/v1/workflows/{id}/deactivate   # DEPRECATED
POST   /api/v1/workflows/{id}/publish      # current
POST   /api/v1/workflows/{id}/unpublish    # current
```

There is **no** `POST /workflows/{id}/run` or `/execute`. That's what forces the architecture:
**to trigger, you have to use a webhook.** There's no API alternative.

⚠️ Watch `activate`/`deactivate`: they're **deprecated** in favor of `publish`/`unpublish`.
If you copy code from a 2025 tutorial it'll use the old ones. Check which your n8n version accepts before wiring it.

### The Execution resource (this DOES give us complete monitoring)

✅ **VERIFIED** — `https://docs.n8n.io/connect/n8n-api/execution`

```
GET    /api/v1/executions
GET    /api/v1/executions/{id}
DELETE /api/v1/executions/{id}
POST   /api/v1/executions/{id}/retry
POST   /api/v1/executions/{id}/stop
POST   /api/v1/executions/stop
GET    /api/v1/executions/{id}/tags
PUT    /api/v1/executions/{id}/tags
```

Query params for `GET /api/v1/executions` (all verified):

| Param | Type | Note |
|---|---|---|
| `includeData` | boolean | Includes the execution's detailed data |
| `redactExecutionData` | boolean | Redacts the output |
| `status` | string | `canceled`, `crashed`, `error`, `new`, `running`, `success`, `unknown`, `waiting` |
| `workflowId` | string | Filter by workflow |
| `projectId` | string | Filter by project |
| `limit` | number | Default **100**, max **250** |
| `cursor` | string | Pagination: use the previous response's `nextCursor` |
| `ignoreDataSizeLimit` | boolean | Returns data exceeding the size limit |

`POST /executions/{id}/retry` is a gem for APM: if a daily scrape fails, APM can retry it
without rebuilding the payload.

### Authentication

✅ **VERIFIED** — `https://docs.n8n.io/connect/n8n-api/authentication`

- Header: **`X-N8N-API-KEY`** (verbatim: *"Send the API key in your API call as a header named `X-N8N-API-KEY`"*)
- Self-hosted base URL: **`https://<your-instance-url>/api/v1`**
- Created under **Settings → n8n API → Create an API key**, with a **label and an expiration date**
- ⚠️ **Scopes are Enterprise-only.** On a normal self-hosted instance **the API key has full account access.**
  Treat it like a root credential: it goes in APM's `.env`, never in git, never in the browser.
- ⚠️ **Set a reminder for the expiration.** You picked a date when creating it; the day it expires, APM silently
  stops seeing executions. Exactly the kind of failure that takes 3 hours to find.

⚠️ **NOT VERIFIED / to check on your VPS:** the docs say *"The n8n API isn't available during the free trial"*.
That applies to n8n Cloud. On self-hosted (your case) the public API is available, but **confirm it**
by going to Settings → n8n API before designing on top of it.

---

## 4. n8n webhooks as the trigger mechanism

✅ **VERIFIED** — Webhook node, docs.n8n.io

URL format:

```
Production:  https://<your-n8n>/webhook/<path>
Test:        https://<your-n8n>/webhook-test/<path>
```

- The production URL is registered **when the workflow is published**; the test one only lasts **120 seconds**
  after pressing "Listen for Test Event".
- The production URL is built from the `WEBHOOK_URL` environment variable; the test one from
  `N8N_EDITOR_BASE_URL`. If your n8n is behind NPM and the URLs come out with `localhost:5678`,
  `WEBHOOK_URL` is missing from the docker-compose.

**Webhook node authentication** (✅ verified): `Basic auth`, `Header auth`, `JWT auth`, `None`.
→ Use **Header auth** with a long secret per workflow. Never leave `None` on an internet-reachable webhook.

**Response modes** (✅ verified): `Immediately` (returns "Workflow got started"),
`When Last Node Finishes`, `Using 'Respond to Webhook' Node`, and **`Streaming response`**.

Recommended pattern for APM:

```
APM  --POST--> https://n8n.your-domain.com/webhook/apm-<task>
                Header: X-APM-Secret: <per-workflow secret>
                Body:   { runId, tenantId, params }
     <--202--   Immediately response (don't block the agent)

APM  --GET-->  /api/v1/executions?workflowId=<id>&status=running|success|error
                Header: X-N8N-API-KEY: <key>
```

That is: **trigger via webhook, monitor via API, correlate by `workflowId` + your own `runId`**.

⚠️ **Correlation gotcha:** the webhook **doesn't return the `executionId`** in `Immediately` mode.
Two ways out: (a) use `Using 'Respond to Webhook' Node` mode and return `{{ $execution.id }}` explicitly,
or (b) have the workflow call back into APM when it finishes. Option (b) is more robust and also saves you
polling. ⚠️ NOT VERIFIED that `$execution.id` is available in your version — test it before relying on it.

---

## 5. n8n's MCP Server Trigger

✅ **VERIFIED** — `https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/`

- Exposes n8n workflows as **MCP tools**. Tools are attached to the trigger through
  the **Custom n8n Workflow Tool** node.
- **Transports:** SSE and **Streamable HTTP**. The docs **don't mark SSE as deprecated**; they say explicitly
  that it *"currently doesn't support standard input/output (stdio) transport"*.
  ⚠️ Across the wider MCP ecosystem SSE is being phased out in favor of Streamable HTTP, but **that isn't
  written in n8n's docs**. Don't state it as fact.
- **Auth:** Bearer auth or Header auth.
- **URLs:** it generates a test one and a production one. The **Path** field defaults to
  *"a randomly generated MCP URL path, to avoid conflicts with other MCP Server Trigger nodes"*, and it's editable.
- ⚠️ **NOT 100% VERIFIED:** the exact prefix. Secondary sources agree on `/mcp/<path>`
  (production) and `/mcp-test/<path>` (test), and n8n's own docs use `location /mcp/` in their nginx example,
  which strongly supports it. But **the docs don't publish the literal template**.
  → **Read it from the node's panel**, don't build it by hand.

### MCP Client Tool — the opposite direction

✅ **VERIFIED** — the `toolmcp` node. It's for **n8n to consume external MCPs**, not to expose n8n.
It supports Bearer, a generic header, multiple headers, OAuth2 and no auth.

**Is it useful to us?** For the APM→n8n bridge, **no**. But it has a real future use: if APM ever exposes
its own tools as MCP, n8n workflows could consume them with this node.
It's the piece for the reverse bridge, not this one.

---

## 6. ⭐ NPM/nginx config for SSE — READY TO PASTE

This is the gotcha that already bit us. Root cause: **nginx buffers the response by default**.
With SSE the server never "finishes" the response, so nginx keeps accumulating bytes it never
sends, and the client sees a *hang* or a timeout — with no error in the logs.

### 6.1 Primary source: n8n's own docs

✅ **VERIFIED — verbatim block from docs.n8n.io** (MCP Server Trigger node):

> *"When running n8n behind a reverse proxy like nginx, you may experience problems if the MCP endpoint
> isn't configured for SSE or streamable HTTP."*

```nginx
location /mcp/ {
    proxy_http_version          1.1;
    proxy_buffering             off;
    gzip                        off;
    chunked_transfer_encoding   off;

    proxy_set_header            Connection '';

    # The rest of your proxy headers and settings
    # . . .
}
```

### 6.2 Block for the **Nginx Proxy Manager Advanced tab** — n8n MCP

NPM doesn't let you edit the root `location`, but the Proxy Host's **Advanced tab** accepts full
`location` blocks that get injected inside the `server {}`. Paste this as-is into your n8n's Proxy Host
(e.g. `n8n.your-domain.com`), **Advanced** tab:

```nginx
# ── n8n MCP / SSE ── Proxy Host: n8n.your-domain.com → Advanced tab ──
# Only affects the MCP routes. The rest of the site keeps NPM's normal proxy.

location ^~ /mcp/ {
    # NOTE: adjust to the real name/port of your n8n container on the Docker network.
    proxy_pass http://n8n:5678;

    # HTTP/1.1 is mandatory: with 1.0 nginx closes the connection after each response
    # and the SSE stream dies at the first event.
    proxy_http_version 1.1;

    # THE key directive. Without it nginx accumulates the stream in memory and
    # forwards nothing: the client sees a silent hang, no error in the logs.
    proxy_buffering off;

    # Don't cache a dynamic stream (nginx could serve a dead response).
    proxy_cache off;

    # gzip over SSE delays events until the compression buffer fills.
    gzip off;

    # SSE already has its own framing (event:/data:). Letting nginx apply
    # its own on top breaks parsing on the client.
    chunked_transfer_encoding off;

    # Empty Connection: avoids inheriting 'close' (or 'upgrade' from a neighboring
    # WebSocket block) from elsewhere in the config. This is NOT WebSocket proxying.
    proxy_set_header Connection '';

    # Long timeouts: nginx's default (60s) kills the MCP session halfway.
    proxy_read_timeout  86400s;
    proxy_send_timeout  86400s;

    # Belt and braces: if an intermediate proxy or an updated NPM ever
    # reintroduces buffering, this response header disables it anyway.
    proxy_set_header X-Accel-Buffering no;

    # Standard headers (NPM sets them in its block, not yours: repeat them).
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Same treatment for the test endpoint (it lasts 120s, but if you don't
# configure it you'll think your MCP is broken when only the test is).
location ^~ /mcp-test/ {
    proxy_pass http://n8n:5678;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    chunked_transfer_encoding off;
    proxy_set_header Connection '';
    proxy_read_timeout  86400s;
    proxy_send_timeout  86400s;
    proxy_set_header X-Accel-Buffering no;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Usage notes for NPM:**

- `^~` makes this `location` win over NPM's generic prefixes. Without it, NPM's block
  can capture the route first and your config is never applied. This is mistake #1.
- ⚠️ **Don't enable NPM's "Websockets Support" toggle** for this. SSE is **not** WebSocket:
  that toggle injects `Connection: upgrade`, exactly the opposite of `Connection: ''`.
- ⚠️ **`proxy_pass` with the container name** only works if NPM and n8n share a Docker network.
  If not, use the host IP and the published port. **Check with `docker network inspect` before pasting.**
- After saving, NPM reloads on its own. If the Proxy Host turns red, there's a syntax error:
  check with `docker logs <npm-container>`.
- ⚠️ **With several n8n replicas**, all `/mcp*` requests must go **to the same replica**
  (the MCP session is stateful). You have a single instance, so it doesn't apply today — but note it.

**How to check it works** (the test that doesn't lie):

```bash
curl -N -i https://n8n.your-domain.com/mcp/<your-path> \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <token>"
```

`-N` turns off **curl's** buffering, so you don't mistake a failure of yours for nginx's.
If you see events arriving bit by bit → good. If it goes silent and then cuts → there's still buffering.

⚠️ **A verified symptom that's very misleading:** if you get
`Error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, **it's not buffering**.
It's the missing `Accept: application/json, text/event-stream` header on the request.
n8n rejects MCP requests that don't accept both types and returns HTML.

### 6.3 The same problem on OUR APM SSE endpoint

`apm.your-domain.com` streams the agent chat. **It suffers exactly the same.**
Block for the APM Proxy Host's Advanced tab:

```nginx
# ── APM chat streaming ── Proxy Host: apm.your-domain.com → Advanced tab ──
location ^~ /api/chat/stream {
    proxy_pass http://apm-web:80;   # adjust container:port

    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    chunked_transfer_encoding off;
    proxy_set_header Connection '';

    # A long conversation with the Agent SDK can think for minutes between tokens.
    # 3600s is a sensible middle ground; 86400s if you'll have very long sessions.
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;

    proxy_set_header X-Accel-Buffering no;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

✅ **The most robust defense goes in APM's code, not in nginx.** Emit these **response** headers
from the endpoint itself. `X-Accel-Buffering: no` is a header nginx honors specifically,
so streaming keeps working even if someone touches the NPM config in the future:

```js
res.writeHead(200, {
  'Content-Type':      'text/event-stream',
  'Cache-Control':     'no-cache, no-transform', // no-transform stops intermediate proxies
  'Connection':        'keep-alive',
  'X-Accel-Buffering': 'no',                     // nginx: don't buffer this response
});
```

Extra trick: send an SSE keepalive comment (`res.write(': ping\n\n')`) every ~25 s.
It keeps the connection alive against intermediate timeouts and detects dead clients.
(Both are what `api/runs.js` does.)

---

## 7. czlonkowski/n8n-mcp — verification

✅ **VERIFIED** (GitHub API + README, 2026-08-02)

| Fact | Value |
|---|---|
| Repo | `czlonkowski/n8n-mcp` |
| Stars | **22,470** |
| License | **MIT** |
| Last push | **2026-07-30** (active) |
| Archived | No |

**What it does:** an MCP server that gives Claude structured knowledge of n8n's nodes
(~2,285 nodes, 828 core + 1,457 community, and ~2,352 templates) so it can **build and validate workflows**.
There are 7 documentation/validation tools + **16 opt-in management tools** that require
`N8N_API_URL` and `N8N_API_KEY`: workflow CRUD, executions, credentials, data tables and security auditing.

**Is it safe to point at PRODUCTION?** ✅ The README itself answers, in capitals:

> *"NEVER edit your production workflows directly with AI!"* — and adds that you should copy the workflow,
> test in development and validate before deploying, because *"AI results can be unpredictable. Protect your work!"*

**Concrete recommendation:**

- **Do use it** on your laptop / Claude Code session to **write** new workflows. It's excellent at that.
- **Don't** connect it to your production n8n with a write API key. There are 6 workflows in production
  (including the content factory) and a scope-less API key = full access.
- If you connect it anyway, use **`DISABLED_TOOLS`** to turn off the write operations (verified it exists).
- The management tools **are disabled by default** if you don't set the env vars — i.e.
  safe mode is the default. Well designed.
- ⚠️ **NOT VERIFIED:** the README says "current support: n8n 2.31.6+". Check your version (`docker exec ... n8n --version`)
  before assuming compatibility.

---

## 8. The best rated on GitHub (open search)

Search via the GitHub Search API sorted by stars, with last-push date. Data from **2026-08-02**.

### 8.1 n8n + MCP / agents

| # | Repo | ★ | License | Last push | Does it add anything over using the n8n REST API? |
|---|---|---|---|---|---|
| 1 | `n8n-io/n8n` | **199,048** | Other (fair-code) | 2026-08-02 | The source of truth. ⚠️ **Not OSI-open**: "Sustainable Use" license |
| 2 | `czlonkowski/n8n-mcp` | **22,470** | MIT | 2026-07-30 | Yes — wraps the API in 16 opt-in tools. A reference for how NOT to expose it |
| 3 | `nerding-io/n8n-nodes-mcp` | 3,028 | MIT | **2026-01-02** ⚠️ | A pre-official community node. **7 months without a push** — obsolete: n8n ships native MCP now |
| 4 | `leonardsellem/n8n-mcp-server` | 1,633 | MIT | **2025-07-09** ⚠️ | *"MCP server for interacting with n8n API"*. **13 months without a push: ruled out** |
| 5 | `bytechefhq/bytechef` | 937 | Other | 2026-07-31 | An n8n competitor, not an integration. Informative |
| 6 | `freddy-schuetz/n8n-claw` | 542 | **None** ⚠️ | 2026-07-31 | An autonomous agent in n8n. **No license = not legally reusable** |
| 7 | `makafeli/n8n-workflow-builder` | 532 | MIT | 2026-03-19 | Overlaps n8n-mcp, less maintained |
| 8 | `CoreWorxLab/CAAL` | 432 | MIT | 2026-05-25 | **Interesting as a pattern:** auto-discovers n8n workflows and exposes them as MCP tools |
| 9 | `salacoste/mcp-n8n-workflow-builder` | 230 | MIT | 2026-04-12 | Another lower-traction clone |

**Conclusion of this search:** there's **a single clear winner** (`czlonkowski/n8n-mcp`, 22k★ and active)
and a long tail of abandoned projects. None of it is a REST API client worth adopting.

### 8.2 TypeScript clients for the n8n REST API

Search `n8n api client typescript` sorted by stars — the result is **crushing**:
the best-rated repo has **10 stars** (`yoanhuke/laravel-n8n`, PHP), and the only TypeScript client
(`egose/n8n-toolkit`, Apache-2.0) has **1 star**.

✅ **Conclusion backed by hard data: there's no n8n API client worth using.**
→ **Use native `fetch`.** The API is ~15 REST endpoints with one header. A 1-star dependency for that
is pure supply-chain risk. Write 80 lines of your own and you have full control.

### 8.3 Job schedulers / queues for Node

| # | Repo | ★ | License | Last push | Last release | Open issues |
|---|---|---|---|---|---|---|
| 1 | `taskforcesh/bullmq` | **9,232** | MIT | 2026-08-02 | **v6.0.5 (2026-08-01)** | **378** |
| 2 | `timgit/pg-boss` | **3,818** | MIT | 2026-08-01 | **12.26.4 (2026-08-01)** | **25** |
| 3 | `graphile/worker` | 2,351 | MIT | 2026-07-08 | — | 43 |
| 4 | `sidequestjs/sidequest` | 1,009 | **LGPL-3.0** ⚠️ | 2026-07-22 | — | — |

⚠️ **On LGPL-3.0 in `sidequest`:** for a network-served SaaS the LGPL is manageable, but it brings
relinking obligations MIT doesn't have. **Ruled out by license, not quality.**

**The top three are alive and MIT.** There's no winner by abandonment: the decision is architectural.

⚠️ **NOT VERIFIED — a fact you should check:** BullMQ's GitHub description literally says
*"based on Redis **or PostgreSQL**"*, and v6 introduced "pluggable queue backends".
**But bullmq.io's news page still describes it as "Redis-backed" and doesn't confirm
a Postgres backend.** Don't assume BullMQ works on Postgres without checking its official docs.
If it turned out to be mature, the analysis below would change.

---

## 9. Recommendation: MCP Server Trigger vs REST API + webhooks

### 🏆 **REST API + webhooks. No doubt about it, for v1.**

**Pros of REST API + webhooks:**

- ✅ Plain HTTP: **zero problems with NPM.** No SSE, no buffering, no long timeouts.
- ✅ Monitoring is *better*: `GET /executions` gives status, history, data and errors.
  MCP doesn't expose execution history **at all**.
- ✅ `POST /executions/{id}/retry` and `/stop` give real operational control.
- ✅ Debuggable with `curl`. When it fails at 2 AM, you fix it.
- ✅ No stateful sessions: if APM restarts halfway, nothing is lost.
- ✅ Auth is a header. You already know how to manage that.

**Cons:**

- ❌ Two mechanisms instead of one (webhook to trigger, API to read).
- ❌ You need polling or a callback to know when it finished. A bit of code.
- ❌ A new webhook for each new task (though you can make a generic one with a router).

**Pros of the MCP Server Trigger:**

- ✅ Claude *discovers* the tools on its own. Elegant for open-ended cases where you don't know in advance what it will call.
- ✅ A single conceptual integration.

**Cons (the ones that weigh):**

- ❌ **It requires SSE/streaming behind NPM — the failure we already suffered.** And not just once: every
  NPM update can reintroduce it.
- ❌ **It gives no execution history.** You'd need the REST API anyway → you save nothing.
- ❌ Stateful sessions: restarts of APM, n8n or NPM break them.
- ❌ A bigger failure surface to debug (SSE + auth + session + buffering).
- ❌ ⚠️ The exact URL prefix isn't even published in the docs.

**The decisive argument:** MCP **doesn't eliminate** the REST API — you need it anyway to monitor.
So MCP isn't "one option instead of the other", it's **an extra layer on top of the one you'll build anyway**,
and the extra layer is precisely the one that breaks behind your proxy.

**When to reconsider (phase 2):** when you have 20+ workflows and want the agent to choose
dynamically which one to use without you wiring it. Then MCP truly wins. With 6 workflows, no.

---

## 10. Scheduler recommendation: pg-boss

### 🏆 **pg-boss inside APM.**

**Hard data first** (not opinion):

| Criterion | pg-boss | BullMQ | graphile-worker | n8n Schedule Trigger |
|---|---|---|---|---|
| Stars | 3,818 | **9,232** | 2,351 | (part of n8n) |
| License | **MIT** ✅ | **MIT** ✅ | **MIT** ✅ | Fair-code ⚠️ |
| Last release | **2026-08-01** ✅ | **2026-08-01** ✅ | 2026-07-08 | — |
| Open issues | **25** ✅ | 378 | 43 | — |
| New infra | **None** ✅ | Redis | None | None |
| Recurring cron | ✅ native | ✅ repeatable jobs | ✅ | ✅ |
| Transactional with your data | ✅ **same Postgres** | ❌ | ✅ | ❌ |

**Why pg-boss and not BullMQ, even though BullMQ has 2.4× the stars:**

1. **Transactional atomicity.** This is the real argument. APM stores state in Postgres.
   With pg-boss you can `INSERT` your data **and** enqueue the job **in the same transaction**.
   If the commit fails, no orphan job is left pointing at a nonexistent row.
   With BullMQ + Redis that's impossible: they're two systems, and you'll get "the job exists but the data doesn't" bugs.
   With 6 workflows and daily scrapes, that bug **will happen**.
2. **Yes, there's already a Redis — but it belongs to someone else.** The server's Redis serves other things.
   Putting APM's queue in it couples two systems: a `FLUSHALL` or a maintenance restart
   wipes out your scheduled jobs. Postgres is already treated as sacred data (encrypted,
   verified backups in cron). **APM's jobs deserve that level of care; the cache doesn't get it.**
3. **Durability.** Redis isn't durable by default. Postgres is, and it's already backed up.
4. **Maintenance signal in pg-boss's favor:** 25 open issues vs BullMQ's 378.
   With an issues/stars ratio of 0.7% vs 4.1%, pg-boss is clearly better tended in proportion.
   Both shipped a release on 2026-08-01, so activity is tied; the difference is the debt.
5. **Fewer pieces.** One less service to monitor, back up and restart on the VPS.

**When BullMQ would be better:** tens of thousands of jobs per minute, or a need for complex
flows/children. Nowhere near our case: we're talking daily scrapes and weekly reports.

**graphile-worker:** technically excellent and also Postgres-native. It loses to pg-boss on
traction (2,351 vs 3,818 ★) and an API less geared to declarative scheduling. It's the second valid choice.

### What about scheduling inside n8n with the Schedule Trigger?

**Recommendation: hybrid, with a clear rule about who's in charge.**

| The job is… | Schedule it in | Why |
|---|---|---|
| An n8n workflow from start to finish (scrape → transform → store) | **n8n (Schedule Trigger)** | Don't put APM in the middle without reason. Fewer hops, fewer failures |
| Agent logic (reason, summarize, decide, call the Agent SDK) | **APM (pg-boss)** | Retries, state and logs in your domain, not in n8n's UI |
| Mixed: n8n collects and the agent reasons | **APM (pg-boss)** triggers the n8n webhook | Whoever orchestrates must be whoever holds the state |

**The rule:** *whoever needs to know whether it worked is the one who schedules it.*
If APM must react to the result, APM schedules. If it's fire-and-forget data, n8n schedules.

⚠️ **A warning about putting everything in n8n:** you'd lose history in APM's database and depend
on n8n's execution retention (which gets purged). For weekly reports you'll want to audit months
later, **pg-boss + your own table** is the defensible option.

---

## 11. Recommended architecture (visual summary)

```
                        ┌──────────────────────────────┐
   Browser ────SSE──────│  apm.your-domain.com  (APM)  │
   (chat streaming)     │  Claude Agent SDK            │
   ▲ needs §6.3         │  pg-boss (own Postgres)      │
                        └───────┬──────────────▲───────┘
                                │              │
             POST /webhook/… ───┘              └─── GET /api/v1/executions
             Header auth                            X-N8N-API-KEY
                                │              │
                        ┌───────▼──────────────┴───────┐
                        │  n8n.your-domain.com         │
                        │  6 workflows + content factory│
                        └──────────────────────────────┘
                     (both behind Nginx Proxy Manager)
```

**Only the browser↔APM link needs the anti-buffering config.** Both APM↔n8n links are
plain HTTP. That's exactly the reason to choose REST+webhooks over MCP.

---

## 12. Implementation plan

1. Create an API key in n8n (Settings → n8n API). **Put the expiration date in the calendar.**
2. Store `N8N_API_URL=https://n8n.your-domain.com/api/v1` and `N8N_API_KEY` in APM's `.env`. **Never in git.**
   ⚠️ Check the `.gitignore` first — a `.env` leaking into git has happened before on this server.
3. Write our own client with `fetch` (~80 lines): `listWorkflows()`, `getExecutions()`,
   `getExecution(id)`, `retryExecution(id)`. **No dependencies** (§8.2).
4. Add a Webhook node with **Header auth** to each workflow APM must trigger.
5. Paste the §6.3 block into APM's Advanced tab **and** emit `X-Accel-Buffering: no`
   from the code. Test with `curl -N`.
6. Install pg-boss pointing at the existing Postgres, **in its own schema** (`pgboss`) so it doesn't mix
   with n8n's tables or yours.
7. Migrate the recurring jobs according to the table in §10.
8. (Optional, later) Evaluate the MCP Server Trigger with the §6.2 block already tested.

---

## ⚠️ Corrections

Mistakes and false assumptions detected during this research. Read this before anything else:

1. **"The n8n REST API can run workflows"** — ❌ **FALSE.** There's no `POST /workflows/{id}/run`
   or equivalent. **Verified** against the official Workflow resource reference. Triggering is **only**
   possible via webhook (or Schedule/another trigger). This assumption, widespread on blogs, would have
   invalidated the whole design. **It's this document's most important finding.**

2. **"SSE is deprecated in n8n's MCP Server Trigger"** — ⚠️ **NOT VERIFIED.** n8n's docs list
   SSE and Streamable HTTP **without marking either as deprecated**. The only thing they say explicitly is that
   it does *not* support stdio. SSE's deprecation is a trend in the wider MCP ecosystem, **not a fact
   documented by n8n**. Don't repeat it as true.

3. **"Enabling 'Websockets Support' in NPM fixes SSE"** — ❌ **FALSE and counterproductive.** That toggle
   injects `Connection: upgrade`, while SSE requires `Connection: ''` (emptied). They're different
   mechanisms. Enabling it makes the problem worse.

4. **"With `proxy_buffering off` it's solved"** — ⚠️ **INCOMPLETE.** At least five more directives are
   needed: `proxy_http_version 1.1`, `proxy_set_header Connection ''`, `gzip off`,
   `chunked_transfer_encoding off` and long timeouts. The default timeouts (60 s) kill the connection
   anyway even with buffering off — and the symptom is identical, which is extremely misleading.

5. **`Unexpected token '<', "<!DOCTYPE "...` is NOT a buffering problem** — it's the missing
   `Accept: application/json, text/event-stream` header. Chasing the nginx config for this error is a
   guaranteed waste of hours.

6. **"BullMQ already supports PostgreSQL"** — ⚠️ **NOT VERIFIED / CONTRADICTORY.** The repo's GitHub
   description says *"based on Redis or PostgreSQL"*, but bullmq.io's official news page still
   describes it as Redis-backed and **doesn't confirm** that backend. Check its documentation before
   basing any decision on it.

7. **"More stars = better choice"** — ❌ BullMQ has 2.4× pg-boss's stars and still **isn't**
   the recommendation. The deciding criterion is transactional atomicity with the Postgres APM already uses,
   not popularity. (Honesty note: the open-issues ratio also favors pg-boss,
   but a bigger project naturally accumulates more issues — don't read it as BullMQ being abandoned;
   it shipped a release the same day.)

8. **`POST /workflows/{id}/activate` is DEPRECATED** — use `publish`/`unpublish`. Almost every 2025
   tutorial uses the old ones. ⚠️ Check which your version accepts before wiring them.

9. **A self-hosted n8n API key has NO scopes** — scopes are Enterprise-only. Your key will have
   **full access**. Hence the recommendation not to point AI tools with write access at production.

10. **⚠️ NOT VERIFIED — the `/mcp/` and `/mcp-test/` prefix.** Secondary sources agree and n8n's own
    nginx example uses `location /mcp/`, but **the docs don't publish the literal URL template**.
    Read it from the node's panel. Don't build it by hand.

11. **⚠️ NOT VERIFIED — `proxy_pass http://n8n:5678`.** It only works if NPM and n8n share a Docker network.
    Check with `docker network inspect` and adjust before pasting the block.

12. **n8n's license isn't OSI open source** — the GitHub API reports it as "Other"
    (Sustainable Use License). Irrelevant for internal use, but **relevant if you ever resell
    the automation as part of a product.** Keep it in mind given a multi-tenant SaaS plan.

---

## Sources

- [MCP Server Trigger — n8n Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger) (official nginx block)
- [MCP Client Tool — n8n Docs](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/)
- [n8n API — Docs](https://docs.n8n.io/connect/n8n-api) · [Authentication](https://docs.n8n.io/connect/n8n-api/authentication) · [Endpoint reference](https://docs.n8n.io/connect/n8n-api/api-reference) · [Execution](https://docs.n8n.io/connect/n8n-api/execution) · [Workflow](https://docs.n8n.io/connect/n8n-api/workflow)
- [Webhook node — n8n Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook)
- [Configuring Nginx for n8n MCP Servers with Claude Code — blog.thalheim.io](https://blog.thalheim.io/2025/11/12/configuring-nginx-for-n8n-mcp-servers-with-claude-code/)
- [Expose MCP in Nginx Proxy Manager — techstuff.leighonline.net](https://techstuff.leighonline.net/2026/05/16/expose-mcp-in-nginx-proxy-manager/)
- [Surviving SSE Behind Nginx Proxy Manager — Medium](https://medium.com/@dsherwin/surviving-sse-behind-nginx-proxy-manager-npm-a-real-world-deep-dive-69c5a6e8b8e5)
- [czlonkowski/n8n-mcp](https://github.com/czlonkowski/n8n-mcp) · [timgit/pg-boss](https://github.com/timgit/pg-boss) · [taskforcesh/bullmq](https://github.com/taskforcesh/bullmq) · [graphile/worker](https://github.com/graphile/worker)
- [BullMQ News](https://bullmq.io/news/)
- Star/license/push data: GitHub Search & Repos API, checked 2026-08-02
