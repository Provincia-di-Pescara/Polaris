# syntax=docker/dockerfile:1
# Contesto di build = RADICE del repo (non backend-node/): serve db/migrations/
# insieme al sorgente del backend — vedi il .dockerignore in radice.
#
# Niente stage di build che compila TS->JS: Node 24 esegue .ts nativamente
# (vedi CLAUDE.md), qui serve solo installare le dipendenze di runtime.
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY backend-node/package.json backend-node/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts --prod

FROM node:24-alpine
RUN apk add --no-cache tzdata
ENV TZ=Europe/Rome NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend-node/package.json ./
COPY backend-node/src ./src
# Binario statico, nessuna dipendenza runtime aggiuntiva — copiato dall'immagine
# ufficiale invece di installarlo via package manager (stessa versione già usata
# altrove nel progetto, vedi CLAUDE.md).
COPY --from=migrate/migrate:v4.18.1 /usr/local/bin/migrate /usr/local/bin/migrate
COPY db/migrations /migrations
COPY backend-node/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.ts"]
