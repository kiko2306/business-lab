/**
 * Service registry and configuration
 * Defines all available services that can be managed by the system.
 * Only services in this allowlist can be controlled via the API.
 */

import fs from 'fs';
import path from 'path';
import { ResolvedComposeFile, ServiceDefinition } from '../types';
import { parseEnvFile } from '../utils/envFile';

// Compose files are named inconsistently across upstream projects, so each
// app directory is probed for any of the filenames Docker Compose accepts.
const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

export const SERVICES: Record<string, ServiceDefinition> = {
  'nginx-proxy-manager': {
    name: 'nginx-proxy-manager',
    label: 'Nginx Proxy Manager',
    description: 'Reverse proxy and certificate management',
    icon: 'nginx',
    category: 'Networking & Security',
    composePath: 'apps/nginx-proxy-manager/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:81/health',
      interval: 30000, // 30 seconds
      timeout: 5000,
    },
    // The compose file publishes the proxy listeners (:80, :443) before the
    // admin UI (:81) — "first port in the file" would point exposure at :80,
    // whose default vhost is NPM's "Congratulations" placeholder, not the
    // admin panel. Pin the upstream to the admin port so the dashboard link
    // (and the tunnel route) land on the actual UI.
    exposurePortEnvVar: 'NPM_ADMIN_PORT',
    // Credentials for NPM's own bundled MariaDB. Nothing outside the compose
    // project ever uses them, so they are generated rather than asked for.
    hiddenGeneratedSecrets: ['NPM_DB_PASSWORD', 'NPM_DB_ROOT_PASSWORD'],
  },
  'netbird-vpn': {
    name: 'netbird-vpn',
    label: 'Netbird VPN',
    description: 'Zero-trust VPN and network access',
    icon: 'vpn',
    category: 'Networking & Security',
    composePath: 'apps/netbird-vpn/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // Its dashboard/management containers authenticate against Authelia's
    // OIDC provider — starting before Authelia is up just crash-loops.
    dependsOn: ['authelia'],
    // The dashboard is a static SPA with no server-side proxy for /api —
    // the browser calls the management API directly, so it needs its own
    // reachable hostname (<name>-api.<base-domain>) rather than the
    // internal container address. See NETBIRD_MGMT_API_ENDPOINT in
    // apps/netbird-vpn/docker-compose.yml.
    // grpc: true — native clients (mobile/desktop/CLI) call this endpoint
    // over real gRPC, not just REST/grpc-web like the browser dashboard.
    // That needs HTTP/2 end-to-end through the proxy, or their very first
    // call (fetching the management server's public key) fails with
    // "failed to check SSO support: failed getting management service
    // public key". Plain proxy_pass (the default) is HTTP/1.1-only.
    // The primary hostname must serve the DASHBOARD. Without this it would
    // fall back to "first published port in the compose file", which is the
    // signal container's — signal is declared first, and gained a published
    // port when it was exposed for remote peers. That silently pointed
    // netbird-vpn.<domain> at a gRPC service, which answers any browser GET
    // with `invalid gRPC request method "GET"`.
    exposurePortEnvVar: 'NETBIRD_DASHBOARD_PORT',
    // relay is the WebSocket fallback data path (see the netbird-relay service
    // in the compose file). grpc: false on purpose — it is plain WebSocket
    // over HTTPS, so it wants NPM's websocket-upgrade support, not grpc_pass.
    //
    // NOTE: signal is deliberately NOT exposed here, though it used to be.
    // Signal registers a peer by replying with response HEADERS on a gRPC
    // stream that then stays open, and Cloudflare never flushes headers while
    // a stream is open — measured on both http2 and quic transports, so no
    // connector setting fixes it (plan.md §52). Signal is published through
    // Tailscale Funnel instead; its hostname lives in NETBIRD_SIGNAL_HOSTNAME
    // (apps/netbird-vpn/.env) and is written into Signal.URI in
    // data/management.json by start.sh. Do not re-add it here — the exposure
    // would provision cleanly and still not work.
    additionalExposures: [
      { suffix: 'api', label: 'Management API', portEnvVar: 'NETBIRD_MGMT_PORT', grpc: true },
      { suffix: 'relay', label: 'Relay', portEnvVar: 'NETBIRD_RELAY_PORT', grpc: false },
    ],
  },
  'wetty': {
    name: 'wetty',
    label: 'Web Terminal',
    description: 'Browser SSH terminal for this host',
    icon: 'terminal',
    category: 'Networking & Security',
    composePath: 'apps/wetty/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // Published as ssh.<base-domain>, not wetty.<base-domain>: "wetty" is the
    // implementation, "ssh" is what someone reaching for a terminal actually
    // looks for. It also keeps the address stable if the implementation is
    // ever swapped for another web terminal.
    exposureSubdomain: 'ssh',
    // This one hands out a root-capable shell on the host, so it must never
    // be reachable without the forward-auth gate. Authelia itself has to be
    // up for that gate to work at all.
    dependsOn: ['authelia'],
  },
  'itflow': {
    name: 'itflow',
    label: 'ITFlow',
    description: 'IT documentation, tickets and billing',
    icon: 'book',
    category: 'Productivity',
    composePath: 'apps/itflow/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8080',
      interval: 30000,
      timeout: 5000,
    },
    // ITFlow builds password-reset links, ticket-reply URLs and the client
    // portal address from this, so it must be the hostname users actually
    // reach rather than the container's.
    exposureEnvKeys: {
      url: ['ITFLOW_URL'],
    },
    managedEnvKeys: ['ITFLOW_URL'],
    // Internal MariaDB credentials — nothing outside this compose project
    // uses them, so there is nothing for the user to choose.
    hiddenGeneratedSecrets: ['ITFLOW_DB_PASSWORD'],
    // NOTE: deliberately no mailEnvKeys. ITFlow has no environment-variable
    // support for SMTP or IMAP at all — its mail configuration lives in its
    // own database, entered through its UI. The dashboard's global mail
    // settings are values to copy in, not values that can be injected. Adding
    // mailEnvKeys here would look like it worked and quietly do nothing.
    // See plan.md §62.1.
  },
  'home-assistant': {
    name: 'home-assistant',
    label: 'Home Assistant',
    description: 'Home automation platform',
    icon: 'home',
    category: 'Home Automation',
    composePath: 'apps/home-assistant/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8123/manifest.json',
      interval: 30000,
      timeout: 5000,
    },
    // HA returns "400: Bad Request" through any proxy unless its
    // configuration.yaml has an http: block with use_x_forwarded_for +
    // trusted_proxies, and there's no env var for it. See
    // services/exposureConfigFiles.ts.
    exposureConfigFile: true,
  },
  'code-server': {
    name: 'code-server',
    label: 'Code Server',
    description: 'VS Code in the browser',
    icon: 'code',
    category: 'Development',
    composePath: 'apps/code-server/docker-compose.yml',
    // Container-internal only — it unlocks sudo *inside* the code-server
    // container, never anything on the host, so there is nothing for a human
    // to choose here.
    hiddenGeneratedSecrets: ['CODE_SERVER_SUDO_PASSWORD'],
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8443/healthz',
      interval: 30000,
      timeout: 5000,
    },
  },
  'bookstack': {
    name: 'bookstack',
    label: 'BookStack',
    description: 'Wiki and knowledge management',
    icon: 'book',
    category: 'Productivity',
    composePath: 'apps/bookstack/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/login',
      interval: 30000,
      timeout: 5000,
    },
    // BookStack forces redirects to APP_URL and rejects login CSRF if it
    // doesn't match the URL in the browser, so it has to track the public one.
    exposureEnvKeys: {
      url: ['BOOKSTACK_URL'],
    },
    // Internal MariaDB credentials + the Laravel APP_KEY (base64:<32 bytes>) —
    // all generated on first start; BookStack won't boot without APP_KEY.
    hiddenGeneratedSecrets: ['BOOKSTACK_DB_PASSWORD', 'BOOKSTACK_DB_ROOT_PASSWORD'],
    autoGeneratedSecrets: ['BOOKSTACK_APP_KEY'],
  },
  'filebrowser': {
    name: 'filebrowser',
    label: 'File Browser',
    description: 'Web-based file manager',
    icon: 'folder',
    category: 'Backup & Storage',
    composePath: 'apps/file-browser/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'homepage': {
    name: 'homepage',
    label: 'Home Page',
    description: 'Custom start page dashboard',
    icon: 'dashboard',
    category: 'Productivity',
    composePath: 'apps/home-page/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:3000/api/healthcheck',
      interval: 30000,
      timeout: 5000,
    },
    // gethomepage rejects any request whose Host isn't in HOMEPAGE_ALLOWED_HOSTS
    // with `{"error":"Host validation failed. See logs for more details."}`.
    exposureEnvKeys: {
      allowedHosts: ['HOMEPAGE_ALLOWED_HOSTS'],
    },
  },
  'n8n': {
    name: 'n8n',
    label: 'n8n',
    description: 'Workflow automation platform',
    icon: 'workflow',
    category: 'Productivity',
    composePath: 'apps/n8n/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:5678/healthz',
      interval: 30000,
      timeout: 5000,
    },
    // n8n blocks the editor ("secure cookie … not using https") unless it
    // knows it's behind HTTPS, and builds webhook/OAuth callback URLs from
    // N8N_HOST / WEBHOOK_URL / N8N_EDITOR_BASE_URL.
    exposureEnvKeys: {
      url: ['N8N_WEBHOOK_URL', 'N8N_EDITOR_BASE_URL'],
      host: ['N8N_HOST'],
      staticOnExposure: { N8N_PROTOCOL: 'https' },
    },
    // Generated on first start. The encryption key stays visible (secret
    // field) — losing it makes stored credentials unrecoverable, so it needs
    // to be backed up; the DB password is purely internal.
    hiddenGeneratedSecrets: ['N8N_DB_PASSWORD'],
    autoGeneratedSecrets: ['N8N_ENCRYPTION_KEY'],
  },
  'paperless': {
    name: 'paperless',
    label: 'Paperless',
    description: 'Document management system',
    icon: 'document',
    category: 'Backup & Storage',
    composePath: 'apps/paperless/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    exposureEnvKeys: {
      // PAPERLESS_URL feeds ALLOWED_HOSTS + CSRF_TRUSTED_ORIGINS derivation,
      // but set CSRF explicitly too — a bare 400 on the login POST is exactly
      // what a missing trusted origin looks like.
      url: ['PAPERLESS_URL', 'PAPERLESS_CSRF_TRUSTED_ORIGINS'],
      allowedHosts: ['PAPERLESS_ALLOWED_HOSTS'],
    },
    // Generated on first start so nothing has to be typed. SECRET_KEY / admin
    // password stay visible (secret field) so they can be retrieved/backed up.
    hiddenGeneratedSecrets: ['PAPERLESS_DB_PASSWORD'],
    autoGeneratedSecrets: ['PAPERLESS_SECRET_KEY', 'PAPERLESS_ADMIN_PASSWORD'],
  },
  'pihole': {
    name: 'pihole',
    label: 'Pi-hole',
    description: 'DNS ad blocker',
    icon: 'shield',
    category: 'Networking & Security',
    composePath: 'apps/pihole/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // The compose file publishes DNS (53/tcp, 53/udp) before the web UI
    // port — "first port in the file" would pick DNS, not the web UI, so
    // exposure needs to be told explicitly which one is the actual upstream.
    exposurePortEnvVar: 'PIHOLE_WEB_PORT',
    // Pi-hole serves its admin UI under /admin; the bare root just redirects
    // (or 403s on v6), so the dashboard link has to target the sub-path.
    webPath: '/admin',
    // The web admin password. Generated rather than hidden: it is a real
    // login the user needs to read, so the config panel shows it — the point
    // is only that they never have to invent one, and that it is never left
    // at the shipped 'change-me'.
    autoGeneratedSecrets: ['PIHOLE_WEB_PASSWORD'],
  },
  'speedtest': {
    name: 'speedtest',
    label: 'Speedtest',
    description: 'Internet speed testing tool',
    icon: 'speed',
    category: 'Monitoring & Management',
    composePath: 'apps/speedtest/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // speedtest-tracker is a Laravel app: wrong APP_URL = broken assets and
    // 419 CSRF errors on login once it's proxied.
    exposureEnvKeys: {
      url: ['SPEEDTEST_APP_URL'],
    },
    // Laravel APP_KEY — generated on first start (as base64:<32 bytes>).
    // Without a valid one every request 500s.
    autoGeneratedSecrets: ['SPEEDTEST_APP_KEY'],
  },
  'tailscale': {
    name: 'tailscale',
    label: 'Tailscale',
    description: 'Mesh VPN service',
    icon: 'vpn',
    category: 'Networking & Security',
    composePath: 'apps/tailscale/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'dozzle': {
    name: 'dozzle',
    label: 'Dozzle',
    description: 'Real-time Docker container log viewer',
    icon: 'logs',
    category: 'Monitoring & Management',
    composePath: 'apps/dozzle/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'beszel': {
    name: 'beszel',
    label: 'Beszel',
    description: 'Lightweight server monitoring hub',
    icon: 'monitor',
    category: 'Monitoring & Management',
    composePath: 'apps/beszel/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8090/api/health',
      interval: 30000,
      timeout: 5000,
    },
    // Seeds the first Beszel login on an empty DB — generated so nothing is
    // typed; readable in the config panel / .env to sign in, then change it
    // in the Beszel UI.
    autoGeneratedSecrets: ['BESZEL_ADMIN_PASSWORD'],
  },
  'mealie': {
    name: 'mealie',
    label: 'Mealie',
    description: 'Recipe manager and meal planner',
    icon: 'food',
    category: 'Productivity',
    composePath: 'apps/mealie/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // Mealie builds share links, OAuth redirects and API URLs from BASE_URL;
    // wrong value = broken login and links once proxied.
    exposureEnvKeys: {
      url: ['MEALIE_BASE_URL'],
    },
  },
  'portainer': {
    name: 'portainer',
    label: 'Portainer',
    description: 'Docker container management UI',
    icon: 'container',
    category: 'Monitoring & Management',
    composePath: 'apps/portainer/docker-compose.yml',
    // Portainer publishes both 9000 (HTTP) and 9443 (its own TLS listener).
    // The HTTP one is what belongs behind NPM — proxying plain HTTP at 9443
    // would just garble a TLS handshake. It happens to be declared first, so
    // "first port in the file" already picks it, but pinning it removes the
    // dependency on that ordering: reorder the two lines and exposure would
    // silently move to the TLS port. Same trap that pointed netbird-vpn at
    // signal (see the comment on netbird-vpn above).
    exposurePortEnvVar: 'PORTAINER_HTTP_PORT',
    healthCheck: {
      enabled: false,
    },
    // Portainer prints a one-time initial-admin setup token to its logs on
    // first start (`setup_token=<value>`), valid for 5 minutes.
    setupToken: {
      logPattern: 'setup_token=(\\S+)',
    },
  },
  'vaultwarden': {
    // Email comes from the dashboard's global mail settings rather than being
    // configured per app. SMTP_SECURITY needs the map: Vaultwarden's
    // vocabulary is starttls/force_tls/off, and passing our tls/ssl/none
    // through verbatim would leave it unencrypted without complaining.
    mailEnvKeys: {
      smtpHost: ['SMTP_HOST'],
      smtpPort: ['SMTP_PORT'],
      smtpUser: ['SMTP_USERNAME'],
      smtpPassword: ['SMTP_PASSWORD'],
      smtpEncryption: ['SMTP_SECURITY'],
      smtpEncryptionMap: { tls: 'starttls', ssl: 'force_tls', none: 'off' },
      fromAddress: ['SMTP_FROM'],
      fromName: ['SMTP_FROM_NAME'],
    },
    name: 'vaultwarden',
    label: 'Vaultwarden',
    description: 'Self-hosted password manager (Bitwarden-compatible)',
    icon: 'lock',
    category: 'Networking & Security',
    composePath: 'apps/vaultwarden/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/alive',
      interval: 30000,
      timeout: 5000,
    },
    // Vaultwarden needs DOMAIN to exactly match the browser URL or WebAuthn,
    // attachments and the /admin panel break — so the dashboard drives it
    // from the exposure hostname and shows it read-only instead of letting
    // the user type a value.
    exposureEnvKeys: {
      url: ['VAULTWARDEN_DOMAIN'],
    },
    managedEnvKeys: ['VAULTWARDEN_DOMAIN'],
    booleanEnvKeys: ['VAULTWARDEN_SIGNUPS_ALLOWED'],
    // ADMIN_TOKEN only unlocks the /admin panel; generate it during setup and
    // keep it out of the dashboard entirely.
    hiddenGeneratedSecrets: ['VAULTWARDEN_ADMIN_TOKEN'],
  },
  'uptime-kuma': {
    name: 'uptime-kuma',
    label: 'Uptime Kuma',
    description: 'Uptime and status monitoring with alerts',
    icon: 'pulse',
    category: 'Monitoring & Management',
    composePath: 'apps/uptime-kuma/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:3001',
      interval: 30000,
      timeout: 5000,
    },
  },
  'authelia': {
    name: 'authelia',
    label: 'Authelia',
    description: 'Single sign-on and 2FA gateway',
    icon: 'key',
    category: 'Networking & Security',
    composePath: 'apps/authelia/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    supportsAdminUserManagement: true,
    // start.sh generates these on bootstrap; declaring them here means a
    // dashboard-driven setup fills them too, rather than silently leaving
    // Authelia unable to start. Both paths only ever touch an unset or
    // placeholder value.
    hiddenGeneratedSecrets: [
      'AUTHELIA_SESSION_SECRET',
      'AUTHELIA_STORAGE_ENCRYPTION_KEY',
      'AUTHELIA_JWT_SECRET',
      'AUTHELIA_OIDC_HMAC_SECRET',
    ],
  },
  'duplicati': {
    name: 'duplicati',
    label: 'Duplicati',
    description: 'Encrypted offsite/cloud backup',
    icon: 'backup',
    category: 'Backup & Storage',
    composePath: 'apps/duplicati/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8200',
      interval: 30000,
      timeout: 5000,
    },
    // Duplicati 2.x rejects requests whose Host header isn't allow-listed;
    // its compose default is "*" so it works proxied out of the box. If you
    // narrow DUPLICATI__WEBSERVICE_ALLOWEDHOSTNAMES in .env, add the public
    // hostname there yourself.
    //
    // Generated on first start, both left visible (secret field): the
    // settings-encryption key is needed to restore Duplicati's own config
    // after a rebuild, and the web password to log in.
    autoGeneratedSecrets: ['DUPLICATI_SETTINGS_ENCRYPTION_KEY', 'DUPLICATI_WEB_PASSWORD'],
  },
  'nextcloud': {
    name: 'nextcloud',
    label: 'Nextcloud',
    description: 'File sync, calendar, and contacts',
    icon: 'cloud',
    category: 'Backup & Storage',
    composePath: 'apps/nextcloud/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/status.php',
      interval: 30000,
      timeout: 5000,
    },
    // Nextcloud hard-blocks unknown domains ("Access through untrusted
    // domain") and needs the overwrite* knobs to emit https:// URLs behind a
    // TLS-terminating proxy. TRUSTED_DOMAINS is space-separated, not comma.
    exposureEnvKeys: {
      allowedHosts: ['NEXTCLOUD_TRUSTED_DOMAINS'],
      allowedHostsSeparator: ' ',
      host: ['NEXTCLOUD_OVERWRITEHOST'],
      staticOnExposure: {
        NEXTCLOUD_OVERWRITEPROTOCOL: 'https',
        NEXTCLOUD_TRUSTED_PROXIES: '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fc00::/7',
      },
    },
    // Generated on first start. Admin password stays visible (secret field)
    // so it can be used to sign in; the DB password is purely internal.
    hiddenGeneratedSecrets: ['NEXTCLOUD_DB_PASSWORD'],
    autoGeneratedSecrets: ['NEXTCLOUD_ADMIN_PASSWORD'],
  },
  'immich': {
    name: 'immich',
    label: 'Immich',
    description: 'Photo and video backup with mobile auto-upload',
    icon: 'photo',
    category: 'Media',
    composePath: 'apps/immich/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:2283/api/server/ping',
      interval: 30000,
      timeout: 5000,
    },
    // Purely internal app↔Postgres credential — generated on first start.
    hiddenGeneratedSecrets: ['IMMICH_DB_PASSWORD'],
  },
  'jellyfin': {
    name: 'jellyfin',
    label: 'Jellyfin',
    description: 'Home media server',
    icon: 'media',
    category: 'Media',
    composePath: 'apps/jellyfin/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8096/health',
      interval: 30000,
      timeout: 5000,
    },
  },
  'vikunja': {
    name: 'vikunja',
    label: 'Vikunja',
    description: 'Task and project management',
    icon: 'tasks',
    category: 'Productivity',
    composePath: 'apps/vikunja/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // VIKUNJA_JWT_SECRET has no default — pre-generate it in the config
    // panel. VIKUNJA_PUBLIC_URL feeds Vikunja's own PUBLICURL (used to build
    // links and validate the frontend origin), so it has to follow the
    // public hostname once exposure is on.
    autoGeneratedSecrets: ['VIKUNJA_JWT_SECRET'],
    exposureEnvKeys: {
      url: ['VIKUNJA_PUBLIC_URL'],
    },
  },
  'watchtower': {
    name: 'watchtower',
    label: 'Watchtower',
    description: 'Automatic container image updates',
    icon: 'update',
    category: 'Monitoring & Management',
    composePath: 'apps/watchtower/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'ntfy': {
    name: 'ntfy',
    label: 'ntfy',
    description: 'Push notifications to phone and desktop',
    icon: 'bell',
    category: 'Monitoring & Management',
    composePath: 'apps/ntfy/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8010/v1/health',
      interval: 30000,
      timeout: 5000,
    },
    // ntfy builds the web app base href, click links and attachment URLs from
    // NTFY_BASE_URL, and only trusts X-Forwarded-For when NTFY_BEHIND_PROXY is
    // set — both follow the public hostname once exposure is enabled.
    exposureEnvKeys: {
      url: ['NTFY_BASE_URL'],
      staticOnExposure: { NTFY_BEHIND_PROXY: 'true' },
    },
  },
  'crowdsec': {
    name: 'crowdsec',
    label: 'CrowdSec',
    description: 'Behavioural intrusion prevention — bans scanners at the Cloudflare edge',
    icon: 'siren',
    category: 'Networking & Security',
    composePath: 'apps/crowdsec/docker-compose.yml',
    // No unauthenticated HTTP endpoint to probe; the container's own
    // `cscli lapi status` healthcheck drives its running/error state.
    healthCheck: {
      enabled: false,
    },
    // Shared LAPI key for the bundled Cloudflare bouncer — pre-filled in the
    // config panel. On start, services/crowdsecConfig.ts renders
    // config/cloudflare-bouncer.yaml from this key + the stored Cloudflare
    // account/zone/token, and adds the real-IP block to NPM — nothing to edit.
    autoGeneratedSecrets: ['CROWDSEC_BOUNCER_KEY'],
    // No published port and no web UI — the local API only needs to be
    // reachable by its bouncer on the compose network, so exposure is N/A.
  },
  'nocodb': {
    name: 'nocodb',
    label: 'NocoDB',
    description: 'Airtable-style database over Postgres',
    icon: 'table',
    category: 'Productivity',
    composePath: 'apps/nocodb/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8011/api/v1/health',
      interval: 30000,
      timeout: 5000,
    },
    // Generated on first start: JWT secret (visible so it can be backed up —
    // rotating it drops sessions) and the internal Postgres password. Both
    // hex, so they stay safe inside NocoDB's pg:// connection string.
    autoGeneratedSecrets: ['NOCODB_JWT_SECRET'],
    hiddenGeneratedSecrets: ['NOCODB_DB_PASSWORD'],
    // NC_PUBLIC_URL feeds invite links, shared-view URLs and email links, so
    // it has to follow the public hostname once exposure is enabled.
    exposureEnvKeys: {
      url: ['NOCODB_PUBLIC_URL'],
    },
  },
  'waha': {
    name: 'waha',
    label: 'WAHA',
    description: 'WhatsApp HTTP API — REST, webhooks, and a dashboard',
    icon: 'chat',
    category: 'Productivity',
    composePath: 'apps/waha/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:3009/ping',
      interval: 30000,
      timeout: 5000,
    },
    // WAHA_BASE_URL feeds webhook payloads, Swagger's server URL and the
    // QR/screenshot links — it has to follow the public hostname once exposed.
    exposureEnvKeys: {
      url: ['WAHA_BASE_URL'],
    },
    // Generated on first start, all kept visible (secret field): the API key
    // is sent by clients (n8n etc.), and the dashboard / Swagger passwords are
    // needed to sign in.
    autoGeneratedSecrets: ['WAHA_API_KEY', 'WAHA_DASHBOARD_PASSWORD', 'WAHA_SWAGGER_PASSWORD'],
  },
  'stirling-pdf': {
    name: 'stirling-pdf',
    label: 'Stirling-PDF',
    description: 'Local PDF toolkit (merge, split, OCR, sign, convert)',
    icon: 'pdf',
    category: 'Backup & Storage',
    composePath: 'apps/stirling-pdf/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8009/api/v1/info/status',
      interval: 30000,
      timeout: 5000,
    },
    // No Host-header / allowed-origin validation — nothing to sync on exposure.
  },
  'grocy': {
    name: 'grocy',
    label: 'Grocy',
    description: 'Pantry/household stock manager (expiration dates, shopping list)',
    icon: 'pantry',
    category: 'Productivity',
    composePath: 'apps/grocy/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8012/',
      interval: 30000,
      timeout: 5000,
    },
    // Plain LinuxServer.io PHP app — no Host-header / allowed-origin
    // validation, nothing to sync on exposure.
  },
  'kitchen-switcher': {
    name: 'kitchen-switcher',
    label: 'Kitchen',
    description: 'One-click switcher between Mealie and Grocy',
    icon: 'switch',
    category: 'Productivity',
    composePath: 'apps/kitchen-switcher/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8013/',
      interval: 30000,
      timeout: 5000,
    },
    // Static nginx page — no framework, nothing to sync on exposure. Its
    // own Mealie/Grocy target URLs are configured client-side (gear icon,
    // localStorage), not via env, so they can be changed without a restart.
  },
  'pantry': {
    name: 'pantry',
    label: 'Pantry',
    description: 'Custom pantry stock tracker (expiration dates, use-item flow, shopping list)',
    icon: 'fridge',
    category: 'Productivity',
    composePath: 'apps/pantry/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8014/api/health',
      interval: 30000,
      timeout: 5000,
    },
    // Custom single-container Node/Express app (see apps/pantry/app/) — no
    // framework Host-header/CSRF validation, nothing to sync on exposure.
  },
  'price-compare': {
    name: 'price-compare',
    label: 'Price Compare',
    description: 'Compare grocery prices across Continente, Pingo Doce, Lidl, Recheio, Makro',
    icon: 'cart',
    category: 'Productivity',
    composePath: 'apps/price-compare/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8015/api/health',
      interval: 30000,
      timeout: 5000,
    },
    // Custom single-container Node/Express app (see apps/price-compare/app/)
    // — no framework Host-header/CSRF validation, nothing to sync on
    // exposure. Outbound scraping to the store sites themselves isn't
    // affected by this app's own exposure state either way.
  },
};

export function getAllServices(): ServiceDefinition[] {
  return Object.values(SERVICES);
}

export function getService(name: string): ServiceDefinition | undefined {
  return SERVICES[name];
}

export function isValidServiceName(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SERVICES, name);
}

/**
 * Root directory holding the managed app stacks. Mounted at the same absolute
 * path inside the container as on the host.
 */
export function getAppsDir(): string {
  return process.env.APPS_DIR || path.join(process.cwd(), 'apps');
}

/**
 * Compose project name for a service, derived from its app directory so that
 * containers can be matched back to the service via compose labels.
 */
export function getProjectName(name: string): string | null {
  const service = getService(name);
  return service ? path.basename(path.dirname(service.composePath)) : null;
}

/**
 * Locate a service's compose file on disk.
 * Returns `composeFile: null` when the app is not installed.
 */
export function resolveComposeFile(name: string): ResolvedComposeFile | null {
  const service = getService(name);
  if (!service) {
    return null;
  }

  const projectName = path.basename(path.dirname(service.composePath));
  const appDir = path.join(getAppsDir(), projectName);
  const configured = path.basename(service.composePath);

  for (const candidate of [configured, ...COMPOSE_FILENAMES]) {
    const composeFile = path.join(appDir, candidate);
    if (fs.existsSync(composeFile)) {
      return { projectName, appDir, composeFile };
    }
  }

  return { projectName, appDir, composeFile: null };
}

export interface ComposeEnvVar {
  key: string;
  // No `:-default` anywhere it's referenced in the compose file — Compose
  // itself will fail to start the service without it.
  required: boolean;
  defaultValue: string | null;
}

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

/**
 * Every `${VAR}` / `${VAR:-default}` reference in a compose file, deduped by
 * key. A key referenced without a default anywhere counts as required, even
 * if another occurrence of the same key has one.
 */
export function extractComposeEnvVars(composeContent: string): ComposeEnvVar[] {
  const byKey = new Map<string, ComposeEnvVar>();
  for (const match of composeContent.matchAll(ENV_VAR_PATTERN)) {
    const [, key, defaultValue] = match;
    const hasDefault = defaultValue !== undefined;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, required: !hasDefault, defaultValue: hasDefault ? defaultValue : null });
    } else if (!hasDefault) {
      existing.required = true;
    }
  }
  return [...byKey.values()];
}

// Matches a compose `ports:` entry's host-side value, e.g. "8000:8000" or
// "${PAPERLESS_PORT:-8000}:8000". Captures either a literal port or a
// ${VAR:-default} expression, to resolve against the app's .env file.
const HOST_PORT_PATTERN = /-\s*["']?(?:\$\{([A-Z0-9_]+)(?::-([^}]*))?\}|(\d+)):\d+["']?/;

/**
 * Derive a service's published host port from its compose file, used to
 * auto-configure exposure upstream settings instead of requiring the user to
 * enter them. Without `portEnvVar`, returns the first `ports:` mapping found
 * (the common single-port-per-app case). With it, returns the port whose
 * mapping uses that specific `${VAR}` — needed once an app publishes more
 * than one port (see `additionalExposures` on ServiceDefinition), since file
 * order alone can't disambiguate which port belongs to which container.
 */
export function getPublishedUpstreamPort(name: string, portEnvVar?: string): number | null {
  const resolved = resolveComposeFile(name);
  if (!resolved?.composeFile) {
    return null;
  }

  const composeContent = fs.readFileSync(resolved.composeFile, 'utf8');
  const envFilePath = path.join(resolved.appDir, '.env');
  const envValues = fs.existsSync(envFilePath) ? parseEnvFile(envFilePath) : {};

  const resolvePort = (varName: string | undefined, varDefault: string | undefined, literalPort: string | undefined) => {
    const hostPortStr = varName ? envValues[varName] ?? varDefault : literalPort;
    const hostPort = hostPortStr ? Number.parseInt(hostPortStr, 10) : NaN;
    return Number.isFinite(hostPort) ? hostPort : null;
  };

  if (portEnvVar) {
    for (const match of composeContent.matchAll(new RegExp(HOST_PORT_PATTERN.source, 'g'))) {
      const [, varName, varDefault, literalPort] = match;
      if (varName === portEnvVar) {
        return resolvePort(varName, varDefault, literalPort);
      }
    }
    return null;
  }

  const match = HOST_PORT_PATTERN.exec(composeContent);
  if (!match) {
    return null;
  }
  const [, varName, varDefault, literalPort] = match;
  return resolvePort(varName, varDefault, literalPort);
}

/**
 * The public hostname a service is exposed under.
 *
 * Defaults to `<service name>.<base domain>`, but a service may override just
 * the subdomain via `exposureSubdomain` (see ServiceDefinition) when its
 * internal name isn't the name users should type. Pass `suffix` to build one
 * of the service's additionalExposures hostnames, which are stemmed from the
 * same subdomain so a rename carries through consistently.
 */
export function buildExposureHostname(serviceName: string, baseDomain: string, suffix?: string): string {
  const subdomain = SERVICES[serviceName]?.exposureSubdomain ?? serviceName;
  const label = suffix ? `${subdomain}-${suffix}` : subdomain;
  return `${label}.${baseDomain}`;
}
