# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install

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
