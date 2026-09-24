# Sits at apps/tally/app/ rather than inside api/ so it can reach all three
# source trees: the Angular bundle in web/ is built here and served by the API
# process, so tally is one image on one port behind one hostname (§628, §632),
# and the shop agent in agent/ is published into it (§670). A build context of
# ./api could not see the siblings. The context is app/, not apps/tally/, so
# it never includes data/ (§674).

FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS api-build
WORKDIR /api
COPY api/package*.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

# The Windows shop agent as ONE self-contained setup exe, built here so the file
# on the Tally page is always the agent source in this same commit (plan.md
# §670). The version is agent/VERSION plus a hash of every agent source file, so
# it changes on any rebuild that changed the agent and only then.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS agent-build
WORKDIR /src
COPY agent/ ./
RUN set -e; \
    HASH=$(find . -type f | sort | xargs sha256sum | sha256sum | cut -c1-8); \
    VERSION=$(tr -d '[:space:]' < VERSION); \
    FULL="$VERSION-$HASH"; \
    dotnet publish -c Release -r win-x64 --self-contained true \
      -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true \
      -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:Version="$VERSION" -p:InformationalVersion="$FULL" -o /out; \
    mkdir /agent; \
    cp /out/Wintouch.Tally.Agent.exe "/agent/Wintouch.Tally.Agent-Setup-$FULL.exe"; \
    printf '{"version":"%s","file":"Wintouch.Tally.Agent-Setup-%s.exe"}' "$FULL" "$FULL" > /agent/agent.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY --from=api-build /api/dist ./dist
# The schema is applied at boot by migrate.ts, which reads these .sql files at
# runtime — tsc does not copy them.
COPY api/src/migrations ./dist/migrations
# Where app.ts looks for the bundle by default.
COPY --from=web-build /web/dist/tally-web/browser ./dist/web
# Where app.ts looks for the agent setup exe by default.
COPY --from=agent-build /agent ./dist/agent
EXPOSE 3000
CMD ["node", "dist/index.js"]
