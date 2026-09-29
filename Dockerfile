# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG APP_BASE_PATH=""
ENV APP_BASE_PATH=${APP_BASE_PATH}
COPY . ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    APP_DATA_DIR=/data \
    SITES_RUNTIME_ROOT=/data/runtime \
    APP_BASE_PATH="" \
    CLOUDFLARE_CF_FETCH_ENABLED=false \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_WRITE_LOGS=false

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts ./scripts

# Docker copies this directory into a new named volume before the process runs,
# so the non-root service account can create the D1 state and backup files.
# The Wrangler path is a mountpoint for an ephemeral tmpfs at runtime.
RUN mkdir -p /data /app/dist/server/.wrangler \
    && touch /data/.volume-initialized \
    && chown -R node:node /data /app/dist/server/.wrangler

USER node
EXPOSE 8787
VOLUME ["/data"]

# The official Node image defines a shell entrypoint. Override it so this
# deployment launches the Node binary directly, which also works on hosts that
# forbid executing image-provided shell entrypoint scripts.
ENTRYPOINT ["/usr/local/bin/node"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/usr/local/bin/node", "-e", "const base=(process.env.APP_BASE_PATH||'').replace(/\\/+$/, ''); fetch('http://127.0.0.1:8787'+base+'/api/auth').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["scripts/docker-entrypoint.mjs"]
