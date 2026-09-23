# Sits at apps/tally/ rather than inside api/ so it can reach both source
# trees: the Angular bundle in web/ is built here and served by the API
# process, so tally is one image on one port behind one hostname (§628, §632).
# A build context of ./api could not see a sibling web/.

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
EXPOSE 3000
CMD ["node", "dist/index.js"]
