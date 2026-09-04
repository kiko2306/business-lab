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

/**
 * A second dashboard-managed compose file, separate from the image-pin
 * `docker-compose.override.yml` (services/composeOverride.ts). The pin override
 * is wiped and rewritten wholesale by the Update button; anything the backend
 * needs to add to a compose file that must survive an update goes here instead.
 * Currently only Paperless's `PAPERLESS_PRE_CONSUME_SCRIPT` env
 * (services/paperlessClamav.ts), which the base compose file cannot reference.
 * It only ever sets `environment:` keys, disjoint from the pin override's
 * `image:`, so the two merge in any order.
 */
export const MANAGED_COMPOSE_FILENAME = 'docker-compose.managed.yml';

export const SERVICES: Record<string, ServiceDefinition> = {
  'nginx-proxy-manager': {
    backup: { engine: 'mysql', service: 'npm-db' },
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
    // Joined to CrowdSec's local API for the Lua bouncer's decision stream
    // (§119). The compose file declares it `external: true`, so it has to
    // exist before `compose up` — the executor creates it. NPM attaches
    // whether or not enforcement is on: the network alone costs nothing, and
    // the alternative (an app whose compose file changes with a setting)
    // would mean backend code editing a compose file.
    externalNetworks: ['crowdsec-lapi'],
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
    // Both are needed for NetBird to work, and neither stops it booting:
    //   tailscale — signal is published through Tailscale Funnel, because
    //     Cloudflare never flushes its response headers on an open gRPC
    //     stream (§52). With the tailscale app down, peers cannot register.
    //   nginx-proxy-manager — the dashboard is a static SPA that calls the
    //     management API at its own public hostname, and OIDC login goes to
    //     https://authelia.<domain>. Both routes live in NPM, so login and
    //     the API are broken without it even on the LAN.
    requires: ['tailscale', 'nginx-proxy-manager'],
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
    backup: { engine: 'mariadb', service: 'itflow-db' },
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
    // Runs with `network_mode: host` so zeroconf/SSDP/DHCP discovery can see
    // the LAN, which means no `ports:` mapping to derive a port from — HA is
    // on the host's 8123 directly. See apps/home-assistant/docker-compose.yml.
    hostNetworkPort: 8123,
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
  'clamav': {
    name: 'clamav',
    label: 'ClamAV',
    description: 'Antivirus scanning daemon for uploaded files',
    icon: 'shield',
    category: 'Networking & Security',
    composePath: 'apps/clamav/docker-compose.yml',
    // clamd speaks its own protocol on 3310, not HTTP, so there is nothing
    // for an HTTP probe to ask. The container's own `clamdscan --ping` drives
    // its running/error state.
    healthCheck: {
      enabled: false,
    },
    // No web UI and nothing to expose publicly: its only callers are other
    // apps on this host, over the docker gateway.
  },
  'code-server': {
    name: 'code-server',
    label: 'Code Server',
    description: 'VS Code in the browser',
    icon: 'code',
    category: 'Development',
    composePath: 'apps/code-server/docker-compose.yml',
    // CODE_SERVER_SUDO_PASSWORD is container-internal — it unlocks sudo
    // *inside* the code-server container, never anything on the host.
    // CODE_SERVER_PASSWORD gates the IDE's own web login, which is the only
    // thing standing between the LAN and this container's :10130 (NPM/
    // Authelia never sees LAN-direct traffic — plan.md §93). Neither needs a
    // human to choose a value, so both are hidden and auto-generated.
    hiddenGeneratedSecrets: ['CODE_SERVER_SUDO_PASSWORD', 'CODE_SERVER_PASSWORD'],
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8443/healthz',
      interval: 30000,
      timeout: 5000,
    },
  },
  'bookstack': {
    backup: { engine: 'mariadb', service: 'bookstack-db' },
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
    // Outgoing mail from the dashboard's global mail settings. BookStack's
    // Symfony mailer takes only `tls` or `null` for MAIL_ENCRYPTION — port 465
    // implies implicit TLS on its own — so 'ssl' maps to 'tls' too.
    mailEnvKeys: {
      staticWhenConfigured: { BOOKSTACK_MAIL_DRIVER: 'smtp' },
      smtpHost: ['BOOKSTACK_MAIL_HOST'],
      smtpPort: ['BOOKSTACK_MAIL_PORT'],
      smtpUser: ['BOOKSTACK_MAIL_USERNAME'],
      smtpPassword: ['BOOKSTACK_MAIL_PASSWORD'],
      smtpEncryption: ['BOOKSTACK_MAIL_ENCRYPTION'],
      smtpEncryptionMap: { tls: 'tls', ssl: 'tls', none: 'null' },
      fromAddress: ['BOOKSTACK_MAIL_FROM'],
      fromName: ['BOOKSTACK_MAIL_FROM_NAME'],
    },
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
    // The bare domain lands here: exposing the Home Page also publishes it at
    // the zone apex, fully public (plan.md §111). buildExposureEnvOverrides
    // sees this and adds <base-domain> to HOMEPAGE_ALLOWED_HOSTS alongside
    // homepage.<base-domain>, or gethomepage 400s the apex request.
    additionalExposures: [{ apex: true, label: 'Bare domain', portEnvVar: 'HOMEPAGE_PORT' }],
    // The public front door (plan.md §111) — every other exposed app
    // requires an Authelia login, this one deliberately doesn't.
    skipAutheliaProtection: true,
  },
  'n8n': {
    backup: { engine: 'postgres', service: 'n8n-db' },
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
    // SMTP for user-management emails (invites, password resets). n8n splits
    // encryption across two booleans that BOTH default to true — implicit SSL
    // (465) and STARTTLS (587) — so each mode sets both explicitly.
    mailEnvKeys: {
      staticWhenConfigured: { N8N_EMAIL_MODE: 'smtp' },
      smtpHost: ['N8N_SMTP_HOST'],
      smtpPort: ['N8N_SMTP_PORT'],
      smtpUser: ['N8N_SMTP_USER'],
      smtpPassword: ['N8N_SMTP_PASS'],
      fromAddress: ['N8N_SMTP_SENDER'],
      smtpEncryptionFlags: {
        tls: { N8N_SMTP_SSL: 'false', N8N_SMTP_STARTTLS: 'true' },
        ssl: { N8N_SMTP_SSL: 'true', N8N_SMTP_STARTTLS: 'false' },
        none: { N8N_SMTP_SSL: 'false', N8N_SMTP_STARTTLS: 'false' },
      },
    },
  },
  'paperless': {
    backup: { engine: 'postgres', service: 'paperless-db' },
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
    // Document intake is virus-scanned via a pre-consume script that streams to
    // ClamAV (services/paperlessClamav.ts). The script fails open when clamd is
    // unreachable — a stopped ClamAV must not halt all intake — so `requires`,
    // not `dependsOn`: the dashboard warns when ClamAV is down, never blocks.
    requires: ['clamav'],
    // Outgoing mail only (share links, admin notifications). Document intake
    // over IMAP is a separate per-account setting in Paperless' own UI and is
    // deliberately left alone. Django's USE_TLS (STARTTLS/587) and USE_SSL
    // (implicit/465) are mutually exclusive, so each mode sets both.
    mailEnvKeys: {
      smtpHost: ['PAPERLESS_EMAIL_HOST'],
      smtpPort: ['PAPERLESS_EMAIL_PORT'],
      smtpUser: ['PAPERLESS_EMAIL_HOST_USER'],
      smtpPassword: ['PAPERLESS_EMAIL_HOST_PASSWORD'],
      fromAddress: ['PAPERLESS_EMAIL_FROM'],
      smtpEncryptionFlags: {
        tls: { PAPERLESS_EMAIL_USE_TLS: 'true', PAPERLESS_EMAIL_USE_SSL: 'false' },
        ssl: { PAPERLESS_EMAIL_USE_TLS: 'false', PAPERLESS_EMAIL_USE_SSL: 'true' },
        none: { PAPERLESS_EMAIL_USE_TLS: 'false', PAPERLESS_EMAIL_USE_SSL: 'false' },
      },
    },
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
  'samba': {
    name: 'samba',
    label: 'Samba',
    description: 'Windows (SMB) network file share on the LAN',
    icon: 'folder',
    category: 'Backup & Storage',
    composePath: 'apps/samba/docker-compose.yml',
    healthCheck: {
      // SMB isn't HTTP and the container has no web endpoint; dockur/samba
      // carries its own smbclient healthcheck.
      enabled: false,
    },
    // SMB on 445 is a LAN protocol the Cloudflare Tunnel + NPM path can't
    // carry (§0 principle 1). The compose file publishes 445, so without
    // this the dashboard would think it's exposable. No Home Page tile
    // follows for free — a tile needs a provisioned exposure.
    lanOnly: true,
    // The SMB account password. Generated rather than hidden: the user needs
    // it to map the drive from Windows, so the config panel shows the field —
    // they can also set their own there. Never left at the shipped
    // 'change-me'.
    autoGeneratedSecrets: ['SAMBA_PASSWORD'],
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
  'guacamole': {
    // Its Postgres holds every saved connection, the user accounts and the
    // session history — the whole app, in other words. Without this its live
    // database files are copied raw and can restore corrupt (§88.6).
    backup: { engine: 'postgres', service: 'guacamole-db' },
    name: 'guacamole',
    label: 'Guacamole',
    description: 'Browser RDP, VNC and SSH to machines on the overlay',
    icon: 'remote',
    category: 'Networking & Security',
    composePath: 'apps/guacamole/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8080/',
      interval: 30000,
      timeout: 5000,
    },
    // GUACAMOLE_DB_PASSWORD: its own bundled Postgres, nothing outside this
    // compose project uses it. GUACAMOLE_ADMIN_PASSWORD is never passed to
    // the container at all — guacamoleAdminRotate.ts generates it, then sets
    // it over Guacamole's own REST API the first time guacadmin/guacadmin
    // logs in successfully, replacing the shipped default (§200 slice 1).
    hiddenGeneratedSecrets: ['GUACAMOLE_DB_PASSWORD', 'GUACAMOLE_ADMIN_PASSWORD'],
    // Chosen over MeshCentral for machines on the overlay (§84.1) precisely
    // because it needs no agent: no pinned certificate hash to go wrong behind
    // the tunnel, and Authelia can gate it without breaking anything, since
    // there is no agent to fail a forward-auth redirect.
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
  'homebox': {
    name: 'homebox',
    label: 'Homebox',
    description: 'Asset, warranty and inventory tracking',
    icon: 'box',
    category: 'Productivity',
    composePath: 'apps/homebox/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:7745/api/v1/status',
      interval: 30000,
      timeout: 5000,
    },
    // Go app serving its own SPA — no Host-header or allowed-origin
    // validation, so nothing to sync when exposure is enabled.
    //
    // The pepper is required — the app panics on boot without at least 32
    // bytes of it — and rotating it invalidates every issued API key, so it is
    // generated once and hidden rather than offered as an editable field.
    hiddenGeneratedSecrets: ['HOMEBOX_API_KEY_PEPPER'],
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
    // NOTE: deliberately no mailEnvKeys. Uptime Kuma has no environment
    // variables for SMTP at all — an email alert is a row in its SQLite
    // `notification` table, created in the UI (Settings → Notifications). The
    // dashboard's global mail settings are values to copy in there by hand,
    // not values it can inherit. Same situation as ITFlow (§62.1). See
    // docs/app-credentials.md.
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
    // Authelia only ever gets asked anything by NPM's forward-auth snippet —
    // nothing else calls it. It boots fine on its own, and protects nothing
    // while the proxy is down.
    requires: ['nginx-proxy-manager'],
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
    // Can't forward-auth-gate its own login page — the auth_request call
    // would loop back into itself.
    skipAutheliaProtection: true,
  },
  'kopia': {
    name: 'kopia',
    label: 'Kopia',
    description: 'Fast encrypted snapshot backup',
    icon: 'backup',
    category: 'Backup & Storage',
    composePath: 'apps/kopia/docker-compose.yml',
    // The server puts its UI and REST API behind basic auth, so an
    // unauthenticated HTTP probe always 401s. The compose file's own
    // healthcheck checks with the generated credentials instead; here we let
    // the container state drive running/error, same as ClamAV.
    healthCheck: {
      enabled: false,
    },
    // All generated on first start, all left visible (secret field):
    // KOPIA_PASSWORD is the repository encryption password and must be kept to
    // restore on a rebuild; the two server passwords are the UI/API and
    // control-API logins. Slice 2 (§81.5) adds kopiaClient.ts, which drives
    // this server over its REST API with these credentials.
    autoGeneratedSecrets: ['KOPIA_PASSWORD', 'KOPIA_SERVER_PASSWORD', 'KOPIA_SERVER_CONTROL_PASSWORD'],
  },
  'nextcloud': {
    backup: { engine: 'postgres', service: 'nextcloud-db' },
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
    // The files_antivirus app is wired to ClamAV on every start
    // (services/nextcloudClamav.ts). Nextcloud boots fine without it — with
    // av_block_unreachable=false a stopped ClamAV just means uploads aren't
    // scanned until the background scan catches up — so `requires`, not
    // `dependsOn`: the dashboard warns when ClamAV is down, never blocks.
    requires: ['clamav'],
  },
  'immich': {
    backup: { engine: 'postgres', service: 'immich-db' },
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
    // SMTP from the dashboard's global mail settings. Vikunja always attempts
    // STARTTLS; FORCESSL switches it to implicit TLS (465). MAILER_ENABLED
    // stays false until mail is configured, which just disables reset emails.
    mailEnvKeys: {
      staticWhenConfigured: { VIKUNJA_MAILER_ENABLED: 'true' },
      smtpHost: ['VIKUNJA_MAILER_HOST'],
      smtpPort: ['VIKUNJA_MAILER_PORT'],
      smtpUser: ['VIKUNJA_MAILER_USERNAME'],
      smtpPassword: ['VIKUNJA_MAILER_PASSWORD'],
      fromAddress: ['VIKUNJA_MAILER_FROMEMAIL'],
      smtpEncryptionFlags: {
        tls: { VIKUNJA_MAILER_FORCESSL: 'false' },
        ssl: { VIKUNJA_MAILER_FORCESSL: 'true' },
        none: { VIKUNJA_MAILER_FORCESSL: 'false' },
      },
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
    // CROWDSEC_NGINX_BOUNCER_KEY is the same idea for the Lua bouncer inside
    // NPM (§119) — the piece that actually enforces bans. Kept as a separate
    // key from the Cloudflare one so either bouncer can be revoked alone.
    autoGeneratedSecrets: ['CROWDSEC_BOUNCER_KEY', 'CROWDSEC_NGINX_BOUNCER_KEY'],
    // Shared with the nginx-proxy-manager project so NPM's bouncer can reach
    // LAPI at crowdsec:8080 without it being published anywhere.
    externalNetworks: ['crowdsec-lapi'],
    // No published port and no web UI — the local API only needs to be
    // reachable by its bouncer on the compose network, so exposure is N/A.
    //
    // It detects attacks by parsing NPM's per-proxy-host access logs, mounted
    // read-only from ../nginx-proxy-manager/data/app/log. CrowdSec starts and
    // stays healthy with NPM down; it just has nothing to read.
    requires: ['nginx-proxy-manager'],
  },
  'nocodb': {
    backup: { engine: 'postgres', service: 'nocodb-db' },
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
    // WAHA's UI is under /dashboard, not the root — the generated Home Page
    // tile builds its href from the hostname plus this (plan.md §114), same
    // as Pi-hole's /admin.
    webPath: '/dashboard',
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
  'kitchen-switcher': {
    name: 'kitchen-switcher',
    label: 'Kitchen',
    description: 'One-click switcher between Mealie and Pantry',
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
    // Static nginx page — no framework, nothing to sync on exposure. The
    // URLs of the apps it embeds are written into html/config.json on every
    // start (services/kitchenConfig.ts) from live exposure state and the
    // allocated ports, so there is nothing to type in; the gear icon still
    // offers a per-browser override in localStorage.
  },
  'onlyoffice': {
    name: 'onlyoffice',
    label: 'OnlyOffice',
    description: 'Document editor that Nextcloud embeds',
    icon: 'document',
    category: 'Productivity',
    composePath: 'apps/onlyoffice/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/healthcheck',
      interval: 30000,
      timeout: 5000,
    },
    // Signs every request between the editor and Nextcloud. Generated rather
    // than asked for — but unlike most generated secrets this one has to be
    // copied into Nextcloud's connector settings, so it is shown in the
    // config panel rather than hidden.
    autoGeneratedSecrets: ['ONLYOFFICE_JWT_SECRET'],
    // Exposed only so a remote browser can load the editor Nextcloud embeds —
    // nobody opens OnlyOffice directly. Infrastructure, not a destination, so
    // no Home Page tile (§131.2).
    hideFromHomePage: true,
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
 * Whether a public exposure of this app should sit behind Authelia's
 * forward-auth login. Every app does by default; `skipAutheliaProtection`
 * is the only opt-out (Home Page and Authelia itself). Not a per-app
 * setting — always computed, never stored.
 */
export function isAutheliaProtectionRequired(name: string): boolean {
  return !getService(name)?.skipAutheliaProtection;
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

  // The dashboard-managed compose files, listed by hand because an explicit
  // `-f` on the base file suppresses Compose's own override discovery (which
  // also means a hand-placed `docker-compose.override.yml` is picked up). The
  // pin override and the managed fragment touch disjoint keys (`image:` vs
  // `environment:`), so their order relative to each other doesn't matter; the
  // managed fragment goes last so executor.ts can re-derive that one `-f`
  // (it may create/remove the file mid-start) by trimming the tail.
  const overrideFile = path.join(appDir, 'docker-compose.override.yml');
  const overrideArg = fs.existsSync(overrideFile) ? ` -f ${overrideFile}` : '';
  const managedFile = path.join(appDir, MANAGED_COMPOSE_FILENAME);
  const managedArg = fs.existsSync(managedFile) ? ` -f ${managedFile}` : '';

  for (const candidate of [configured, ...COMPOSE_FILENAMES]) {
    const composeFile = path.join(appDir, candidate);
    if (fs.existsSync(composeFile)) {
      return { projectName, appDir, composeFile, composeArgs: `-f ${composeFile}${overrideArg}${managedArg}` };
    }
  }

  return { projectName, appDir, composeFile: null, composeArgs: '' };
}

export interface ComposeEnvVar {
  key: string;
  // No `:-default` anywhere it's referenced in the compose file — Compose
  // itself will fail to start the service without it.
  required: boolean;
  defaultValue: string | null;
}

const ENV_VAR_KEY_PATTERN = /^([A-Z0-9_]+)(?::-([\s\S]*))?$/;

/**
 * Every `${VAR}` / `${VAR:-default}` reference in a compose file, deduped by
 * key. A key referenced without a default anywhere counts as required, even
 * if another occurrence of the same key has one.
 *
 * Brace-depth tracked rather than a single regex: a default can itself
 * reference another variable with its own default (Home Page's
 * `HOMEPAGE_ALLOWED_HOSTS:-localhost:${HOMEPAGE_PORT:-10190}`), and a
 * `[^}]*`-style default capture stops at that inner `}` and corrupts the
 * parse — the outer default came back missing its close brace, run together
 * with whatever followed it in the file.
 */
export function extractComposeEnvVars(composeContent: string): ComposeEnvVar[] {
  const byKey = new Map<string, ComposeEnvVar>();

  function record(key: string, defaultValue: string | null): void {
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, required: defaultValue === null, defaultValue });
    } else if (defaultValue === null) {
      existing.required = true;
    }
  }

  function scan(content: string): void {
    let i = 0;
    while (i < content.length) {
      const start = content.indexOf('${', i);
      if (start === -1) {
        return;
      }
      let depth = 1;
      let j = start + 2;
      while (j < content.length && depth > 0) {
        if (content.startsWith('${', j)) {
          depth++;
          j += 2;
        } else if (content[j] === '}') {
          depth--;
          j++;
        } else {
          j++;
        }
      }
      const inner = content.slice(start + 2, depth === 0 ? j - 1 : j);
      const match = ENV_VAR_KEY_PATTERN.exec(inner);
      if (match) {
        const [, key, defaultValue] = match;
        record(key, defaultValue ?? null);
        if (defaultValue) {
          scan(defaultValue);
        }
      }
      i = j;
    }
  }

  scan(composeContent);
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
 *
 * A host-networked service has no `ports:` mapping at all — it binds the host
 * directly — so its declared `hostNetworkPort` answers instead. That only
 * applies to the service's own port: a `portEnvVar` lookup still comes from
 * the compose file, since an additional exposure names a published mapping.
 */
export function getPublishedUpstreamPort(name: string, portEnvVar?: string): number | null {
  const resolved = resolveComposeFile(name);
  if (!resolved?.composeFile) {
    return null;
  }

  const hostNetworkPort = getService(name)?.hostNetworkPort;
  if (hostNetworkPort && !portEnvVar) {
    return hostNetworkPort;
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
 * same subdomain so a rename carries through consistently. Pass
 * `{ apex: true }` for an additionalExposures entry published at the zone
 * apex — the bare base domain, no subdomain or suffix (plan.md §111).
 */
export function buildExposureHostname(
  serviceName: string,
  baseDomain: string,
  suffix?: string,
  opts?: { apex?: boolean }
): string {
  if (opts?.apex) {
    return baseDomain;
  }
  const subdomain = SERVICES[serviceName]?.exposureSubdomain ?? serviceName;
  const label = suffix ? `${subdomain}-${suffix}` : subdomain;
  return `${label}.${baseDomain}`;
}
