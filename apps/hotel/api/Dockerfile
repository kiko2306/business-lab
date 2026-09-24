# The context is api/ (compose: `build: ./api`), not apps/hotel/: the hotel-db
# data directory under apps/hotel/data is mode 0700 for postgres, and the classic
# builder the dashboard uses (§290) refuses a context it cannot read whatever
# .dockerignore says (§674). The frontends are their own images, each with its
# own context, so this one only ever needed api/.

FROM node:22-alpine AS api-build
WORKDIR /api
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=api-build /api/dist ./dist
# The schema is applied at boot by migrate.ts, which reads these .sql files at
# runtime — tsc does not copy them.
COPY src/migrations ./dist/migrations
EXPOSE 3000
CMD ["node", "dist/index.js"]
