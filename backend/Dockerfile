FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime

# GID of the host's docker group, so the non-root app user can use the mounted socket.
ARG DOCKER_GID=999

# docker CLI + compose plugin are required to start/stop the managed app stacks.
RUN apk add --no-cache docker-cli docker-cli-compose

RUN set -eux; \
    addgroup -S appgroup; \
    adduser -S appuser -G appgroup; \
    if ! getent group "${DOCKER_GID}" >/dev/null; then addgroup -g "${DOCKER_GID}" docker; fi; \
    addgroup appuser "$(getent group "${DOCKER_GID}" | cut -d: -f1)"

WORKDIR /app

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY src ./src
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["node", "src/index.js"]
