# Sits at apps/hotel/ rather than inside api/ so it can reach the frontend
# trees as they land — check-in, pulse and the admin shell are served from
# this same image (plan.md §632's arrangement, applied to hotel).
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
EXPOSE 3000
CMD ["node", "dist/index.js"]
