# Turnkey build spec

What to buy, how to install it, and which apps ship by default for a new
client box. Written for **offices of 2–15 people** (§84.7) — that's where
the per-seat-SaaS-replacement value proposition is strongest, since most of
the tools this stack replaces price per user per month and this doesn't.

This is a **draft** (P10, §84.7) — the hardware spec and disk-partitioning
rule are proven against the real stack; the app profile below is a proposal
to review and adjust, not a finalized decision.

## Hardware

**Dell, 16 GiB RAM, 500 GB disk, ≈€400.** Not a guess — measured on the box
this whole stack runs on today: **14.84 GiB RAM, 4 CPUs, 53 containers,
8 GB used, 6 GB available**. The spec has headroom, not just enough.

### The one thing that must happen at install time, not after

Ubuntu Server's installer defaults to a **~100 GiB root LV** and hands the
rest of the disk to `/home` — which is exactly how a 256 GB box ended up
with Docker squeezed into 98 GiB on this project's own test host (`plan.md`
§83). A 500 GB client box installed with those defaults inherits the same
trap, and discovering it after the box is already in service means moving a
live data root under a running client.

Two independent tools cover this, both driven from `start.sh` (never a
manual partitioning step — see [first-run.md § Where Docker keeps its
data](first-run.md#where-docker-keeps-its-data)):

- **`DOCKER_DATA_ROOT`** — point Docker's storage at a different mount
  (e.g. `/home`, if the installer's defaults are already applied) before
  containers pile up. Opt-in, idempotent, safe to run any time.
- **`EXPAND_VG_DISK`** — absorb a second physical disk into the existing LVM
  volume group and grow the filesystem live, no downtime.

**For a fresh install: partition deliberately at install time instead** —
give the root LV the whole disk (or close to it) rather than accepting
Ubuntu's ~100 GiB default, and `DOCKER_DATA_ROOT`/`EXPAND_VG_DISK` become
unnecessary rather than a rescue.

## Provisioning

Covered already, not part of this spec — see
[deployment-guide.md](deployment-guide.md) for the ordered first-run-to-handover
procedure, and **Settings → Deployment checklist** (P9a) for confirming a box
is fully provisioned before it goes to a client. Nothing here duplicates that.

## App profile

The client endpoints are Windows (§84.7) — that's what makes Guacamole's RDP
path the right remote-access tool, not MeshCentral or RustDesk (those matter
for endpoints that never join the overlay, a different scenario).

Every app below already ships in the registry (`backend/src/config/services.ts`)
— this section is about which ones are **part of the default pitch** to a
2–15-person office, not which ones exist. Nothing here removes an app from
the roster; the dashboard can start any of them regardless of this list.

### Core — always running, not a client-facing choice

The plumbing every deployment needs regardless of what the client actually
uses: **Nginx Proxy Manager**, **Authelia**, **NetBird VPN**, **Tailscale**
(NetBird's signal transport), **Web Terminal**, **ClamAV**, **CrowdSec**,
**Kopia** (backups), **Samba** (the shared-tree SMB share), **Home Page**.
These don't get pitched as "apps" — they're what makes exposure, auth,
backup and file-sharing work at all.

### Recommended default bundle

What a typical small office actually needs, started on day one of an
engagement:

| App | Replaces |
|---|---|
| **Nextcloud** + **OnlyOffice** | File sync/share (Dropbox/Google Drive) + online document editing (Google Docs/O365) |
| **Vaultwarden** | A team password manager (1Password/LastPass) |
| **Vikunja** | Task/project boards (Asana/Trello) |
| **Paperless-ngx** | Document scanning/archival with OCR |
| **DocuSeal** | E-signatures (DocuSign) |
| **Twenty** | A simple CRM |
| **Kimai** | Time tracking/billing |
| **BookStack** | An internal wiki/knowledge base |
| **NocoDB** | A shared spreadsheet-as-database (Airtable) |
| **n8n** | Workflow automation (Zapier) |
| **Guacamole** | Remote access to the office's Windows machines |
| **Stirling-PDF** | PDF tools (merge/split/convert) |
| **Uptime Kuma** | "Is our stuff up" monitoring — useful for whoever's supporting the box, client-visible or not |
| **Pi-hole** | Network-wide ad/tracker blocking (optional but cheap to include) |

### Available, not part of the default pitch

Real apps, just not something every small office asks for — start them on
request rather than by default: **ITFlow** (this is an MSP's own
tooling — only relevant if the client *is* one, not a typical office),
**Immich** (photo library — more a household than an office need),
**Miniflux** (RSS reader), **Scrutiny** (disk health — admin-facing, not
client-facing), **Dozzle** (log viewer — same), **Speedtest**.

### Not recommended for this profile

Built for a specific personal/household use case, not a generic small
office — still fine to start for a client who specifically wants them, but
they don't belong in a standard pitch: **Jellyfin**, **Navidrome** (personal
media/music), **Mealie** (recipes), **Pantry**, **Price Compare** (household
grocery tools), **Home Assistant** (home automation), **Code Server**,
**IT Tools** (developer tooling, not office-relevant unless the client is a
dev shop).

## What this doesn't answer

- **P11 — data protection position** (§84.5): controller vs processor,
  backup-key custody, DR promise. A business stance, not a hardware/app
  question — separate README item.
- **P12 — commercial plan** (§84.5): hardware BOM pricing, support model,
  onboarding time, what happens to a client's data if they stop paying.
  Blocked on the SaaS inventory + monthly costs from the operator; lands as
  an Artifact, not a repo commit, once that's in.
