# syntax=docker/dockerfile:1
#
# Production image of the Usina do Seguro back office.
#
# Node runs the TypeScript in src/ directly: there is no build output. The
# first stage installs everything and type-checks, so an image is only built
# from code that passes `tsc`; the final stage carries the runtime
# dependencies and src/ only — no tests, no docs, no .env, no data.
#
# Base pinned to the version the test suite runs on.

FROM node:24.11.1-bookworm-slim AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --noEmit -p tsconfig.json

FROM node:24.11.1-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PERSISTENCE_DRIVER=sqlite \
    SQLITE_FILE=/data/usina.sqlite \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=verify /app/src ./src

# The database (and its -wal/-shm files and backups) lives in a volume, owned
# by the unprivileged user the process runs as.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# node directly, not npm: SIGTERM reaches the process, which closes the HTTP
# server and then the database (src/main.ts).
CMD ["node", "src/main.ts"]
