# tu empresa — apm-api (Node 22, imagen mínima)
#
# Mismo patrón que dashboard-api: alpine con digest fijado, npm ci sin dev,
# usuario no-root y un HEALTHCHECK que consulta la propia API.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# ⚠️ SIN --omit=optional, al contrario que dashboard-api. El Claude Agent SDK
# distribuye su binario de CLI como dependencia OPCIONAL por plataforma
# (claude-agent-sdk-linux-x64-musl para alpine). Omitirlas deja el paquete
# instalado pero sin ejecutable, y el fallo no aparece al arrancar: la API
# responde /api/health perfectamente y solo revienta al lanzar el primer
# agente, con "Native CLI binary for linux-x64 not found".
RUN npm ci --omit=dev --no-audit --no-fund

COPY *.js ./
# Fuentes de leads (Fase 3). Sin tests ni fixtures en la imagen.
COPY sources/*.js ./sources/
RUN rm -f ./*.test.js ./sources/*.test.js

# ⚠️ /workspace es el cwd de los agentes, y es CONSTANTE DEL DESPLIEGUE, no una
# ruta cualquiera: el Agent SDK deriva de ella el projectKey con el que guarda
# y reanuda los transcripts. Cambiarla invalida todas las aprobaciones
# pendientes (docs/SPIKE-02-container.md). Dueño `node` porque el proceso no
# corre como root y el agente escribe ahí.
RUN mkdir -p /workspace && chown node:node /workspace

USER node
EXPOSE 3000

# /api/health devuelve 503 si Postgres no responde, así que el contenedor se
# marca unhealthy cuando la BD se cae y no solo cuando el proceso muere.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
