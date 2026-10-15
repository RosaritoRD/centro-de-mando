#!/bin/sh
# SPIKE 02 — aprobación diferida a través de la recreación del contenedor.
#
# Lanza las dos fases en contenedores efímeros DISTINTOS. Cada `docker run
# --rm` crea uno nuevo y lo destruye al salir, así que el ~/.claude del
# contenedor 1 no existe para el contenedor 2. Esa es toda la prueba: si la
# reanudación funciona, viene de Postgres.
#
#   ./tools/spike-02.sh
set -eu

REPO=/opt/centro-de-mando
IMG=centro-de-mando-api
NET=n8n_n8n_internal

cd "$REPO"

# Solo las dos variables que hacen falta. NO se usa --env-file: el .env lleva
# FIREBASE_PRIVATE_KEY multilínea y el parser de docker no lo soporta.
APM_DB_URL=$(sed -n 's/^APM_DB_URL=//p' .env)
ANTHROPIC_API_KEY=$(sed -n 's/^ANTHROPIC_API_KEY=//p' .env)
[ -n "$APM_DB_URL" ] || { echo "falta APM_DB_URL en .env"; exit 1; }
[ -n "$ANTHROPIC_API_KEY" ] || { echo "falta ANTHROPIC_API_KEY en .env"; exit 1; }

fase() {
  docker run --rm \
    --network "$NET" \
    -e APM_DB_URL="$APM_DB_URL" \
    -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    -v "$REPO":/app \
    -w /app/spike/session-store-pg \
    "$IMG" node run.mjs "$@"
}

echo "=== Contenedor 1 (fase A) ==="
SALIDA_A=$(fase a | tee /dev/stderr)
SESSION_ID=$(printf '%s\n' "$SALIDA_A" | sed -n 's/^SESSION_ID=//p')
[ -n "$SESSION_ID" ] || { echo "la fase A no devolvió session_id"; exit 1; }

# El session_id viaja por argv, igual que en APM viajará en la fila de
# `approval`. Lo que este spike prueba es el TRANSCRIPT, no el id.
echo
echo "=== Contenedor 2 (fase B) — otro contenedor, disco limpio ==="
fase b "$SESSION_ID"
