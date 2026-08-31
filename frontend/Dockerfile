# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Puppeteer (a devDependency, used only by `ng test`) downloads a Chrome
# build in its postinstall. @puppeteer/browsers maps every Linux host to the
# x86_64 build regardless of CPU, so on arm64 (Raspberry Pi) it pulls ~170MB
# of a binary that can never run. The image build doesn't need a browser at
# all, so skip the download everywhere.
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Install dependencies first (cached layer).
# npm ci, not npm install: ci installs exactly what package-lock.json pins and
# fails if the lockfile is out of sync, so an image built today matches one
# built next month. npm install is free to resolve newer semver-compatible
# versions and silently rewrite the lockfile inside the build, which makes
# builds unreproducible and lets a dependency change ship without a commit.
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
ARG API_URL
RUN node -e "const fs = require('fs'); const apiUrl = process.env.API_URL || ''; fs.writeFileSync('src/environments/environment.production.ts', 'export const environment = ' + JSON.stringify({ apiUrl }) + ' as const;\n');"
RUN npm run build -- --configuration production --base-href /

# ---- Runtime stage ----
FROM nginx:1.27-alpine AS runtime

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/homelab-frontend/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
