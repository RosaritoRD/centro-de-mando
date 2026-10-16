#!/bin/sh
# SPIKE 02 — a deferred approval across container recreation.
#
# Runs the two phases in DIFFERENT throwaway containers. Each `docker run --rm`
# creates a new one and destroys it on exit, so container 1's ~/.claude doesn't
# exist for container 2. That's the whole test: if resuming works, it came
# from Postgres.
#
#   ./tools/spike-02.sh
set -eu

REPO=/opt/centro-de-mando
IMG=centro-de-mando-api
NET=n8n_n8n_internal

cd "$REPO"

# Only the two variables needed. --env-file is NOT used: the .env holds a
# multi-line FIREBASE_PRIVATE_KEY and docker's parser doesn't support it.
APM_DB_URL=$(sed -n 's/^APM_DB_URL=//p' .env)
ANTHROPIC_API_KEY=$(sed -n 's/^ANTHROPIC_API_KEY=//p' .env)
[ -n "$APM_DB_URL" ] || { echo "APM_DB_URL missing from .env"; exit 1; }
[ -n "$ANTHROPIC_API_KEY" ] || { echo "ANTHROPIC_API_KEY missing from .env"; exit 1; }

fase() {
  docker run --rm \
    --network "$NET" \
    -e APM_DB_URL="$APM_DB_URL" \
    -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    -v "$REPO":/app \
    -w /app/spike/session-store-pg \
    "$IMG" node run.mjs "$@"
}

echo "=== Container 1 (phase A) ==="
SALIDA_A=$(fase a | tee /dev/stderr)
SESSION_ID=$(printf '%s\n' "$SALIDA_A" | sed -n 's/^SESSION_ID=//p')
[ -n "$SESSION_ID" ] || { echo "phase A returned no session_id"; exit 1; }

# The session_id travels via argv, just as in APM it travels on the `approval`
# row. What this spike tests is the TRANSCRIPT, not the id.
echo
echo "=== Container 2 (phase B) — another container, clean disk ==="
fase b "$SESSION_ID"
