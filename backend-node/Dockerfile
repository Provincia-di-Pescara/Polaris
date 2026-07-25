# syntax=docker/dockerfile:1
# Niente stage di build che compila TS->JS: Node 24 esegue .ts nativamente
# (vedi CLAUDE.md), qui serve solo installare le dipendenze di runtime.
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts --prod

FROM node:24-alpine
RUN apk add --no-cache tzdata
ENV TZ=Europe/Rome NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/index.ts"]
