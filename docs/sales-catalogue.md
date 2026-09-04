# Sales catalogue

One row per managed app (`backend/src/config/services.ts`): what it does, and
the commercial or SaaS product a client would otherwise be paying a monthly
subscription for. No pricing and no client scenarios — see
[the README's "What it is, and how it's sold"](/README.md#what-it-is-and-how-its-sold):
Business Lab itself is free, what's sold is the service of standing this up
and running it. This doc exists so that conversation has a plain, factual app
list to point at, not a pitch deck.

Some apps here are platform plumbing rather than something a user opens day
to day — they're listed too, because "we don't pay a managed WAF / VPN
vendor / status-page SaaS either" is still a real part of what self-hosting
replaces.

## Business operations

| App | What it does | Stands in for |
|---|---|---|
| ITFlow | IT documentation, ticketing and client billing (PSA) | ConnectWise Manage, Autotask, Syncro |
| BookStack | Wiki and knowledge base | Confluence, Notion (wiki use) |
| Vikunja | Task and project management — kanban/list/Gantt views | Asana, Trello, Monday.com |
| NocoDB | Airtable-style spreadsheet database over Postgres | Airtable, Baserow |
| n8n | Visual workflow automation connecting other apps and APIs | Zapier, Make (Integromat) |
| Paperless-ngx | Document management — OCR, tagging and search over scanned/ingested files | DocuWare, Adobe Document Cloud's storage tier |
| OnlyOffice | In-browser document editor (opens from Nextcloud) | Microsoft 365 web apps, Google Docs/Sheets/Slides |
| Homebox | Asset, warranty and inventory tracking | Sortly, EZOfficeInventory |
| Stirling-PDF | Local PDF toolkit — merge, split, OCR, sign, convert | Adobe Acrobat, SmallPDF/iLovePDF subscriptions |

## Files, photos and media

| App | What it does | Stands in for |
|---|---|---|
| Nextcloud | File sync, calendar and contacts | Google Drive/Calendar, Dropbox, Microsoft 365 |
| Immich | Photo and video backup with mobile auto-upload | Google Photos, iCloud Photos |
| File Browser | Web-based file manager over a shared folder | A lightweight Dropbox/WeTransfer-style file portal |
| Samba | Windows (SMB) network file share on the LAN | A NAS's file-share tier |
| Jellyfin | Home media server for the client's own video/music library | Plex Pass, a personal Netflix-style front end |

## Communication

| App | What it does | Stands in for |
|---|---|---|
| Ntfy | Push notifications to phone and desktop, triggered from other apps or scripts | Pushover, Pushbullet |
| WAHA | WhatsApp HTTP API gateway for automations (e.g. n8n) to send/receive messages | A paid WhatsApp Business API provider (Twilio, 360dialog) |
| Vaultwarden | Self-hosted password manager, Bitwarden-client compatible | 1Password, LastPass, Bitwarden's own hosted tiers |

## Home and lifestyle

| App | What it does | Stands in for |
|---|---|---|
| Home Assistant | Home automation hub — devices, sensors, automations | SmartThings, Google Home/Nest's automation tier |
| Mealie | Recipe manager and meal planner, imports recipes from URLs | Paprika, Whisk |
| Kitchen Switcher | One-click toggle between the Mealie and Pantry apps on a shared kiosk device | (internal utility — no SaaS equivalent) |
| Pantry | Custom-built pantry stock tracker — expiration dates, use-item flow, shopping list | Custom-built to replace a spreadsheet or a paid pantry-tracking app |
| Price Compare | Compares grocery prices across several Portuguese supermarket chains | A grocery price-comparison app/browser extension |

## Security, identity and networking

| App | What it does | Stands in for |
|---|---|---|
| Authelia | Single sign-on and 2FA gateway in front of every exposed app | Okta, Auth0, Cloudflare Access (the identity layer) |
| Nginx Proxy Manager | Reverse proxy and TLS certificate management for every exposed app | A managed reverse-proxy/CDN service's routing tier |
| CrowdSec | Intrusion prevention — bans scanners and abusive IPs at the edge, crowdsourced threat intel | A managed WAF/IPS subscription |
| ClamAV | Antivirus scanning daemon for files uploaded through Nextcloud/Paperless | A cloud antivirus/file-scanning API |
| Guacamole | Browser-based RDP, VNC and SSH — remote desktop with no client install | A commercial remote-desktop/PAM product (Splashtop, TeamViewer) |
| Pi-hole | Network-wide DNS ad- and tracker-blocking | NextDNS or a commercial DNS filtering service |
| Netbird VPN | Zero-trust mesh VPN and network access control | Tailscale's or Twingate's paid business tiers |
| Tailscale | Mesh VPN client used internally (for NetBird's signalling, no web UI of its own) | (infrastructure dependency, not a client-facing product) |
| Wetty | Browser-based SSH terminal onto this host | A bastion-host/jump-box SaaS |
| Code-server | VS Code running in the browser, for editing files on this host | GitHub Codespaces, Gitpod |

## Platform and operations

| App | What it does | Stands in for |
|---|---|---|
| Kopia | Fast, encrypted, deduplicated snapshot backups of every app's data | Backblaze/Veeam-style managed backup |
| Uptime Kuma | Uptime and status monitoring with alerts | UptimeRobot, a hosted status-page product |
| Beszel | Lightweight server resource monitoring (CPU/RAM/disk) | Datadog or New Relic's infrastructure-monitoring tier |
| Dozzle | Real-time Docker container log viewer | A log-aggregation SaaS (Papertrail, Loggly) for container logs |
| Speedtest | Internet speed testing, run from the host itself | speedtest.net (self-hosted, no third party involved) |
| Home Page | This dashboard's own start page — tiles for every running, exposed app | An internal company intranet/portal page |
