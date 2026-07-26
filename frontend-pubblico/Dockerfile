# Stage 1: Build
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install -g pnpm && pnpm install --ignore-scripts
COPY . .
RUN pnpm build

# Stage 2: Serve via Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
