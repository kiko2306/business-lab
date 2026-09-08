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

# GID of the host's docker group, so the non-root app user can read/write
# the apps/ directory (bind-mounted with that group ownership) to manage
# each app's compose files and .env config. Docker API access itself goes
# through docker-socket-proxy over TCP, not a mounted socket.
ARG DOCKER_GID=999

# docker CLI is required to start/stop the managed app stacks.
# postgresql16-client provides pg_dump/pg_restore, matching the postgres:16-alpine database image.
# su-exec lets the entrypoint fix volume ownership as root, then drop to appuser.
# openssl generates the self-signed cert gRPC exposures upload to NPM — see
# ensureGrpcCertificate in npmClient.ts.
# git is required by the self-update panel (§131.4) to `git pull` the
# mounted REPO_ROOT checkout.
RUN apk add --no-cache docker-cli postgresql16-client su-exec openssl git

# The compose *plugin* is installed separately, pinned to a specific release,
# rather than via Alpine's own docker-cli-compose package. Alpine 3.23's
# community repo caps that package at v2.40.3, while a deployment host's own
# Compose (from Docker's apt repo / get.docker.com) is typically much newer —
# v5.5.1 confirmed on tx-home-utils.com. That gap matters: `docker compose
# config` resolves a bind mount's config differently across it (2.40.3 adds
# `create_host_path: true`, 5.5.1 doesn't), which changes the computed
# `com.docker.compose.config-hash` for any bind-mounted service — and made
# Compose think untouched services (database, docker-socket-proxy) had
# drifted and needed recreating mid self-update, severing the backend's own
# Docker control channel when the socket proxy was one of them (plan.md
# §291/§292). Pinned to the exact version confirmed live to resolve
# identically to the host; bump this alongside whatever the host installs.
ARG COMPOSE_VERSION=v5.5.1
RUN set -eux; \
    apk add --no-cache curl; \
    case "$(uname -m)" in \
      x86_64) COMPOSE_ARCH=x86_64 ;; \
      aarch64) COMPOSE_ARCH=aarch64 ;; \
      armv7l) COMPOSE_ARCH=armv7 ;; \
      *) echo "unsupported arch for docker compose: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    asset="docker-compose-linux-${COMPOSE_ARCH}"; \
    curl -fsSLO "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/${asset}"; \
    curl -fsSLO "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/${asset}.sha256"; \
    sha256sum -c "${asset}.sha256"; \
    mkdir -p /usr/libexec/docker/cli-plugins; \
    mv "$asset" /usr/libexec/docker/cli-plugins/docker-compose; \
    chmod +x /usr/libexec/docker/cli-plugins/docker-compose; \
    rm -f "${asset}.sha256"; \
    apk del curl

RUN set -eux; \
    addgroup -S appgroup; \
    adduser -S appuser -G appgroup; \
    if ! getent group "${DOCKER_GID}" >/dev/null; then addgroup -g "${DOCKER_GID}" docker; fi; \
    addgroup appuser "$(getent group "${DOCKER_GID}" | cut -d: -f1)"

WORKDIR /app

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chown -R appuser:appgroup /app && chmod +x /usr/local/bin/docker-entrypoint.sh

# Stays root here: the entrypoint fixes up the backups-data volume's
# ownership (which Docker creates as root) before dropping to appuser.
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
