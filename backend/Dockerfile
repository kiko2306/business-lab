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

# docker CLI + compose plugin are required to start/stop the managed app stacks.
# postgresql16-client provides pg_dump/pg_restore, matching the postgres:16-alpine database image.
# su-exec lets the entrypoint fix volume ownership as root, then drop to appuser.
# openssl generates the self-signed cert gRPC exposures upload to NPM — see
# ensureGrpcCertificate in npmClient.ts.
# git is required by the self-update panel (§131.4) to `git pull` the
# mounted REPO_ROOT checkout.
RUN apk add --no-cache docker-cli docker-cli-compose postgresql16-client su-exec openssl git

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
