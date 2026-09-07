# Licence due diligence

Every image the stack runs, against the one question that matters commercially:
**can Business Lab operate this model without breaching a licence?**

Researched 2026-09-02. Licences change — re-check any row marked ⚠️ before a
launch, and whenever an image tag is re-pinned.

**Keep this current.** Per CLAUDE.md's "Adding an app" convention, every new app
**and every base or sidecar image in its compose file** gets a row here, with
its licence checked against the model below, as part of the same change that
adds it. A candidate whose licence fails that test does not get added.

## The business model this is checked against

> The software is **free to use** — not sold, no tiers, no hosted service.
> Business Lab sells **domain management, custom configuration and server
> maintenance** (and turnkey hardware alongside). The client owns the box,
> runs it on their own domain / Cloudflare account / user set (§84.7), and
> uses the apps for their **own internal business** — not to resell access to
> anyone else. See the README's "What it is, and how it's sold".

That model is the easy case for almost every licence here. The only things that
can still bite, and the rows to read carefully, are:

1. **AGPL** — obligations trigger only when you *modify* the code **and** serve
   the modified version over a network. Running a stock image, unmodified, for
   internal use creates no source-disclosure duty beyond what upstream already
   publishes. Do not ship patched builds of an AGPL app without also publishing
   the patch.
2. **"Fair-code" / source-available** licences (n8n, Redis 7.4+) — these carry a
   clause against *providing the software to third parties as a service*. The
   line is **who operates the instance**: the client, on their own box, for
   their own use → fine; Business Lab hosting it centrally for several clients →
   not, without a commercial licence.
3. **Non-software terms** — WAHA automates WhatsApp Web, which breaches Meta's
   ToS regardless of WAHA's own (permissive) licence. Ookla's Speedtest CLI has
   its own EULA. These are business risks, not licence blockers.

Under this model, **nothing here blocks pricing.** The ⚠️ rows are conditions to
operate within, listed again at the end.

## Registry apps

| App | Upstream licence | Status | Note |
|---|---|---|---|
| Authelia | Apache-2.0 | ✅ Clean | |
| Beszel | MIT | ✅ Clean | |
| BookStack | MIT (LinuxServer image scripts GPL-3.0) | ✅ Clean | |
| ClamAV | GPL-2.0 | ✅ Clean | internal use |
| Code Server | MIT | ✅ Clean | VS Code OSS build |
| CrowdSec | MIT | ✅ Clean | Cloudflare bouncer MIT; NPM Lua bouncer MIT, see vendored code below |
| Dozzle | MIT | ✅ Clean | |
| File Browser | Apache-2.0 | ✅ Clean | |
| Forgejo (`codeberg.org/forgejo/forgejo`) | **GPL-3.0-or-later** | ✅ Clean | official image, run stock. GPL-3.0 places no restriction on running it internally; not modified, not redistributed as software. Bundled SQLite (public domain) is in the binary — no separate image. Alpine base rowed below. No paid tier |
| Guacamole | Apache-2.0 | ✅ Clean | incl. bundled `guacamole-auth-header` extension, same licence |
| Home Assistant | Apache-2.0 | ✅ Clean | |
| Homebox | **AGPL-3.0** | ✅ Clean | unmodified; see AGPL note |
| Home Page (gethomepage) | GPL-3.0 | ✅ Clean | internal use |
| Immich | **AGPL-3.0** | ✅ Clean | unmodified |
| ITFlow | GPL-3.0 | ✅ Clean | no paid tiers |
| IT Tools (`corentinth/it-tools`) | **GPL-3.0** | ✅ Clean | stock unmodified, static SPA served by nginx; GPL-3.0 places no restriction on running it internally, not redistributed as software |
| Jellyfin | GPL-2.0 | ✅ Clean | |
| Kitchen switcher | *ours* — no LICENSE file | ⚠️ Decide | repo has no licence (below) |
| Kopia | Apache-2.0 | ✅ Clean | official `kopia/kopia` image, built by the project; internal backup use. The image bundles `rclone` (**MIT**, ✅ clean) — used only to reach an FTP destination via Kopia's `rclone` backend (§267); no separate image |
| Mealie | **AGPL-3.0** | ✅ Clean | unmodified |
| MeshCentral (`ghcr.io/ylianst/meshcentral`) | **Apache-2.0** | ✅ Clean | official image built by the project, run stock. Alpine + Node.js base (`alpine` rowed below; Node.js is MIT-style). No paid tier or SSO paywall. |
| Metabase (`metabase/metabase`) | **AGPL-3.0** (OSS edition) | ✅ Clean | unmodified; the paid Enterprise/Pro edition is a separate image and licence — we ship only the AGPL OSS one. Bundled `metabase-db` is `postgres:16-alpine` (PostgreSQL License, already rowed below) |
| Miniflux (`miniflux/miniflux`) | **Apache-2.0** | ✅ Clean | stock unmodified. Bundled `miniflux-db` is `postgres:16-alpine` (PostgreSQL License, already rowed below) |
| **n8n** | **Sustainable Use License** (fair-code, not OSI) | ⚠️ Condition | client-operated instance for their own workflows = allowed (consulting & support are explicitly permitted). Business Lab hosting n8n *for* clients on infrastructure it operates = needs an n8n Enterprise licence. Keep it one-box-one-client. |
| NetBird | BSD-3-Clause | ✅ Clean | |
| Nginx Proxy Manager | MIT | ✅ Clean | |
| NocoDB | **AGPL-3.0** | ✅ Clean | unmodified |
| ntfy | Apache-2.0 / GPL-2.0 | ✅ Clean | |
| **OnlyOffice** Docs | **AGPL-3.0** + branding terms | ⚠️ Condition | must keep the ONLYOFFICE name and the "ONLYOFFICE is the original developer" About notice — **no white-labeling the editor**. Historical 20 simultaneous-connection cap (removed in Docs 9.4; irrelevant at ≤15 seats). Fine unmodified. |
| Pantry | *ours* — no LICENSE file | ⚠️ Decide | |
| Paperless-ngx | GPL-3.0 | ✅ Clean | |
| Pi-hole | EUPL-1.2 | ✅ Clean | weak copyleft, commercial use permitted |
| **Postiz** (`ghcr.io/gitroomhq/postiz-app`) | **AGPL-3.0** | ⚠️ Condition | run **stock, unmodified** — obligation is only an offer of upstream source, which pointing at the public repo satisfies since we convey no changes. The §257 Temporal search-attribute fix is an **env var (`SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES`), deliberately not an image patch**, precisely so this stays "unmodified". Do not fork or rebuild the image. Bundled sidecars rowed below. |
| Price Compare | *ours* — no LICENSE file | ⚠️ Decide | |
| Samba (`dockurr/samba`) | GPL-3.0 (Samba); MIT (image wrapper) | ✅ Clean | stock unmodified Samba for internal LAN file sharing — GPL-3.0 places no restriction on running it; not modified, not redistributed |
| Scrutiny (`ghcr.io/analogj/scrutiny`, omnibus) | **MIT** | ✅ Clean | stock unmodified. The omnibus image bundles InfluxDB 2 OSS (MIT), smartmontools (GPL-2.0+) and s6-overlay (ISC) — all clean for internal use, none redistributed as software |
| Speedtest (speedtest-tracker) | MIT | ⚠️ Condition | wraps **Ookla Speedtest CLI**, which has its own EULA the operator must accept (free, but not FOSS and not for "commercial" measurement without Ookla's OK). Swap for LibreSpeed if that matters. |
| **SQL Server 2022 Express** (`mcr.microsoft.com/mssql/server`) | **Microsoft Software Licence Terms** (proprietary, zero-cost) | ⚠️ Condition | **cleared for the setup-and-maintenance model via the §2.b.iv hosting exception + a first-start acceptance gate** (§121.5). The only hard bar is §6 "transfer to a third party" — avoided because the **client accepts the Microsoft EULA themselves** (§263d gate: terms shown → tick → backend writes `ACCEPT_EULA=Y`), making them Microsoft's own licensee under §1.b, not a transferee from us. **No High Risk Use** (§2.b.iv(3)): not for e-commerce / payment / banking / shipping-transaction or life-safety databases. x86-64 only; telemetry to MS; AS-IS, ~$5 liability cap; no published benchmark comparisons without MS approval. The backend must **never** set `ACCEPT_EULA=Y` on its own. |
| Stirling-PDF | **MIT** (core, since v1.0.0) | ✅ Clean | login / SSO / audit features under `app/proprietary/` are paywalled — don't enable or redistribute those |
| Syncthing (`syncthing/syncthing`) | **MPL-2.0** | ✅ Clean | stock unmodified; file-level copyleft only, no obligation from running it. Uses the community relay pool by default — no cost, no account |
| Tailscale | BSD-3-Clause (client) | ✅ Clean | coordination is Tailscale's paid SaaS (a subscription cost, not a licence issue); or self-host headscale (BSD-3) |
| Uptime Kuma | MIT | ✅ Clean | |
| Vaultwarden | **AGPL-3.0** | ✅ Clean | unmodified |
| Vikunja | **AGPL-3.0** | ✅ Clean | unmodified |
| **WAHA** (core image) | Apache-2.0 | ⚠️ Watch | licence is clean. But automating WhatsApp Web **breaches Meta/WhatsApp ToS** — the client's number can be banned. Treat as a documented risk the client accepts, not a feature sold with a guarantee. |
| Web Terminal (wetty) | MIT | ✅ Clean | |

## Infrastructure & dependency images

| Image | Licence | Status | Note |
|---|---|---|---|
| postgres:14/15/16/17-alpine, postgres:16 (Postiz stack) | PostgreSQL License (BSD-like) | ✅ Clean | Postiz's own DB is `postgres:17-alpine`; Temporal's is `postgres:16` (non-alpine, matching Temporal's tested matrix) |
| temporalio/auto-setup:1.28.1 (Postiz) | **MIT** (Temporal) | ✅ Clean | hard dependency of the Postiz backend — no lighter scheduler path (§243). Bundles the `temporal`/`tctl` CLIs and PostgreSQL client tooling, all MIT/Apache-2.0/PostgreSQL-License. Elasticsearch is **not** run (§257). |
| pgautoupgrade/pgautoupgrade:17-alpine (n8n, Paperless) | **MIT** ("Docker PostgreSQL Authors") | ✅ Clean | drop-in for `postgres:17-alpine` that runs `pg_upgrade` in place on a major bump; bundled PostgreSQL keeps the PostgreSQL License. n8n needs PG ≥ 16 (§118.3); Paperless moved off `postgres:15-alpine` for the same deprecation notice (§182). |
| mariadb:latest (ITFlow), lscr.io/linuxserver/mariadb:latest (BookStack) | GPL-2.0 (server) | ✅ Clean | internal use / mere aggregation |
| mysql:8.0 (NPM) | GPL-2.0 + FOSS exception | ✅ Clean | not standardisable on MariaDB — its JSON column type breaks NPM's own migrations (§210.1) |
| valkey:9-alpine (Immich, Paperless, Postiz) | BSD-3-Clause | ✅ Clean | BSD-3 community fork of Redis 7.2; wire-compatible. Paperless moved here from `redis:7-alpine` (RSALv2/SSPL); Postiz's upstream compose ships `redis:7.2` and we swap it for the same reason. |
| nginx:alpine (Kitchen switcher) | BSD-2-Clause | ✅ Clean | |
| alpine | MIT | ✅ Clean | base of several images incl. `dockurr/samba` (`alpine:edge`); bundled `tini` MIT |
| busybox (init containers) | GPL-2.0 | ✅ Clean | unmodified |
| mcr.microsoft.com/mssql/server:2022-latest (SQL Server) | **Microsoft Software Licence Terms** (proprietary) | ⚠️ Condition | the SQL Server engine — see the app row above and §121.5. Bundles `mssql-tools18` (ODBC 18, MS EULA) for `sqlcmd`, used by the healthcheck and the `mssql` backup engine. Not redistributed; the client accepts the terms on first start. |
| LinuxServer.io images (BookStack, Code Server, MariaDB, Speedtest) | image build scripts GPL-3.0; bundled apps keep their own licence | ✅ Clean | GPL applies to the packaging scripts, adds no restriction on running the app |

## Vendored source

Third-party source checked into this repo rather than pulled from an image.
Same question, one extra wrinkle: it is *distributed* with the repo (which is
public), so the licence has to permit redistribution, not just use.

| Code | Upstream | Licence | Status | Note |
|---|---|---|---|---|
| `apps/nginx-proxy-manager/crowdsec-bouncer/lua/crowdsec.lua`, `lua/plugins/crowdsec/*` | crowdsecurity/lua-cs-bouncer v1.0.18 | MIT | ✅ Clean | unmodified; `LICENSE.lua-cs-bouncer` kept beside it |
| `apps/nginx-proxy-manager/crowdsec-bouncer/lua/resty/http*.lua` | ledgetech/lua-resty-http v0.17.2 | BSD-2-Clause | ✅ Clean | unmodified; `LICENSE.lua-resty-http` kept beside it. Vendored because the NPM image ships no `resty.http` |

Both permit redistribution with the copyright notice retained, which is why the
upstream `LICENSE` files travel with the code rather than being summarised here.

## This repository has no licence

There is no `LICENSE` file and no `license` field in any `package.json`. A public
repo with no licence is "all rights reserved" by default — nobody has a grant to
use, modify or redistribute it, and contributions have no legal basis. For a
product that clients and IT admins will run, and that the plan treats as
sellable-as-a-service, this needs a deliberate choice (AGPL-3.0 to keep the
same terms as the copyleft apps it bundles, or a permissive licence, or a
source-available one). Out of scope for this table; flagged for whoever owns the
commercial side.

## Conditions to operate within

1. **Keep n8n one-box-one-client.** Never run a shared n8n that holds several
   clients' workflows/credentials without an Enterprise licence.
2. **Don't white-label OnlyOffice.** Keep its name and the About notice.
3. **Don't enable Stirling-PDF's `proprietary/` features** (SSO, audit log) —
   those are paid.
4. **Keep off `redis:7-alpine`** (RSALv2/SSPL). Paperless is on Valkey; if any
   future app needs a Redis, use Valkey or pin `redis:7.2-alpine` (still BSD-3).
5. **Speedtest**: accept the Ookla CLI EULA, or replace with LibreSpeed.
6. **WAHA**: document the WhatsApp-ToS ban risk in the client agreement; don't
   warrant deliverability.
7. **Never ship a modified build** of any AGPL/GPL app without making the source
   available. Stock images only.
8. **Pick a licence for this repo.**

Do those and the "not sold, setup & maintenance only" model is clear of every
licence here.
