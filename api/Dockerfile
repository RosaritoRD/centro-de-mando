# Acme — apm-api (Node 22, minimal image)
#
# Same pattern as dashboard-api: alpine with a pinned digest, npm ci without dev,
# a non-root user and a HEALTHCHECK that queries the API itself.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# ⚠️ NO --omit=optional, unlike dashboard-api. The Claude Agent SDK ships its
# CLI binary as an OPTIONAL per-platform dependency
# (claude-agent-sdk-linux-x64-musl for alpine). Omitting them leaves the
# package installed but without its executable, and the failure doesn't show on
# startup: the API answers /api/health just fine and only blows up when the
# first agent launches, with "Native CLI binary for linux-x64 not found".
RUN npm ci --omit=dev --no-audit --no-fund

COPY *.js ./
# Lead sources (Phase 3). No tests or fixtures in the image.
COPY sources/*.js ./sources/
RUN rm -f ./*.test.js ./sources/*.test.js

# ⚠️ /workspace is the agents' cwd, and it's a DEPLOYMENT CONSTANT, not just any
# path: the Agent SDK derives from it the projectKey used to store and resume
# transcripts. Changing it invalidates every pending approval
# (docs/SPIKE-02-container.md). Owned by `node` because the process doesn't run
# as root and the agent writes there.
RUN mkdir -p /workspace && chown node:node /workspace

USER node
EXPOSE 3000

# /api/health returns 503 if Postgres doesn't respond, so the container is
# marked unhealthy when the DB goes down, not only when the process dies.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
