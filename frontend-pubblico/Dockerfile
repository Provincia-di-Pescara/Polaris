# Stage 1: Build
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install -g pnpm && pnpm install --ignore-scripts
COPY . .
RUN pnpm build

# Stage 2: Serve via Nginx
FROM nginx:alpine
# Identità di build reale (tag git o dev-<sha>, decisa da release.yml) -- vedi
# commento gemello in engine-go/Dockerfile. Letta da docker-entrypoint.sh.
ARG BUILD_VERSION=sconosciuta
RUN echo "$BUILD_VERSION" > /etc/polaris-build-version
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
