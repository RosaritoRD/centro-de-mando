# 💸 Savings and tips

## Spend less

1. **One model per job.** The orchestrator uses the most capable model, because a bad decision costs more than the tokens. Volume sweeps (leads, summaries) use a mid-tier model, and the "is this urgent, yes or no?" triage uses the cheapest one.
2. **Prompt caching.** It's the biggest cost lever and the most ignored one. Watch out: below the minimum cacheable token count it **doesn't cache and doesn't warn you**. Check `cache_creation_input_tokens`.
3. **Count with `total_cost_usd`, not `usage`.** `usage` leaves out subagent tokens, and a multi-agent system can spend about 15× more than a single agent.
4. **A daily dollar cap** (`DAILY_BUDGET_USD`). Once it's hit, the orchestrator refuses to start new runs. The code enforces it.
5. **Prices in the database, not in the code.** Promotions expire, and if the price is hard-coded, the cost dashboard silently starts lying that day.
6. **Reuse what you already have:** the database lives inside an existing Postgres (separate database, separate role) and login reuses Firebase. Zero new servers.
7. **Static dashboard.** React is compiled when the image is built and nginx serves files: zero Node RAM for the UI.
8. **A cap on concurrent agents** (`MAX_CONCURRENT_RUNS`). Each one uses ~1 GB, so the cap saves you from paying for a bigger server.

## Do it better

1. **Approval lives on the server.** Never trust the model to "remember" to ask for permission.
2. **Append-only events.** If something crashes halfway, you rebuild by replaying, and nothing is left half-done without you knowing.
3. **An allow-list of users, not "I just won't share the link".** Having a valid account isn't enough to get in.
4. **Research before you code.** The 8 reports in `docs/research/` avoided throwing away whole pieces late (and surfaced legal limits like CAN-SPAM before building any sending).
5. **Test the risky part with a *spike*.** `spike/` proves a deferred approval survives a restart before anything is built on top of it.
6. **Ideas to extend it:** a read-only email subagent, phone alerts when something is waiting for your approval, or a weekly cost-per-task report.
