FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime

# GID of the host's docker group, so the non-root app user can use the mounted socket.
ARG DOCKER_GID=999

# docker CLI + compose plugin are required to start/stop the managed app stacks.
# postgresql16-client provides pg_dump/pg_restore, matching the postgres:16-alpine database image.
RUN apk add --no-cache docker-cli docker-cli-compose postgresql16-client

RUN set -eux; \
    addgroup -S appgroup; \
    adduser -S appuser -G appgroup; \
    if ! getent group "${DOCKER_GID}" >/dev/null; then addgroup -g "${DOCKER_GID}" docker; fi; \
    addgroup appuser "$(getent group "${DOCKER_GID}" | cut -d: -f1)"

WORKDIR /app

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["node", "dist/index.js"]
