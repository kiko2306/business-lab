# Deployment Guide

Provisioning one box for one client, end to end. Each step links to the
reference that covers its detail; this page is only the order.

One deployment is one client: their domain, their Cloudflare account, their
user set, their backup destination. Nothing here is shared between clients.

## Before the box

Have these in hand — `start.sh` cannot derive them (see
[first-run.md § Before you run it](first-run.md)):

- The client's **domain**, already a zone in a Cloudflare account (theirs if
  self-controlled, a reseller-managed one if contracted — see §203).
- A **Cloudflare API token** scoped to **that one zone** (Zone Resources →
  Include → Specific zone), with Account → Cloudflare Tunnel: Edit and
  Zone → DNS: Edit.
- A **Tailscale account + reusable auth key**, and Funnel enabled once for the
  tailnet.
- If the host itself will be enrolled as a **NetBird peer** and it runs
  Pi-hole, enroll with `sudo netbird up --disable-dns` — see
  [first-run.md § Enrolling this host as a NetBird peer](first-run.md#enrolling-this-host-as-a-netbird-peer).
  A bare `netbird up` breaks host DNS (`plan.md` §368).
- Hardware per [the turnkey build spec](turnkey-build-spec.md) — decide Docker's
  data root at install time, not after (first-run.md § Where Docker keeps its
  data).

## 1. First run on the host

```bash
sudo ./start.sh
```

The only command run on the host. For an unattended run, fill
`start.config` (from `start.config.example`) with the four values above
first. `start.sh` installs Docker, provisions the tunnel, brings up the core
stack, and publishes the dashboard at `https://homelab.<domain>`. Everything
else is done from the dashboard.

Full walk-through of the prompts and the `setup_server.sh` sub-prompts (fixed
IP, passwordless sudo, freeing port 53): [first-run.md](first-run.md).

## 2. Create the admin account

Open the printed dashboard URL and complete `/setup`. This is the client's
Authelia admin identity — every app that seeds its own first admin
(Nextcloud, ITFlow, Kimai, NocoDB, …) takes its email from here on first
start, so there is no per-app admin step later (plan.md §341/§346/§347).

## 3. Fill in the per-deployment settings

**Settings → Deployment checklist** lists what is still blank and links each
item to its section. Work it top to bottom:

| Setting | Where | Notes |
|---|---|---|
| Base domain, tunnel, proxy credentials | Networking | Pre-filled by `start.sh`; confirm and **Test connection** — it warns if the token is not zone-scoped |
| Cloudflare account model | Networking | `self-controlled` or `contracted` — recorded for the record (§203/§359) |
| Cloudflare token | Networking | Only if `start.sh` could not store it |
| Email (shared mailbox) | Email | One mailbox every app sends/receives through; **Send test** |
| Backup destination | Backup destination | `disk` / `s3` / `sftp` / … — **Test** before relying on it. Custody of the repository passphrase is a contract term (§84.5) |

The checklist shows all seven items **Set** when the box is provisioned.

## 4. Add the client's people

**Users page → Accounts** — add each staff member (offices of 2–15), pick
their role, and send the invite. They set their own password and 2FA from the
invite link.

## 5. Start the apps

Order matters for the first three (first-run.md § The order that works):

1. **Nginx Proxy Manager** — every public hostname is served through it, so
   nothing can be exposed until it runs. No manual credential step: the
   dashboard claims/rotates its admin account itself the moment it first
   needs the API ([app-credentials.md](app-credentials.md)).
2. **Authelia** — the login gate; exposed apps error until it is up.
3. Everything else, any order.

Each exposable app gets a public `<name>.<domain>` behind Authelia on that
start — no toggle, no per-app exposure step (plan.md §331). Set any config an
app asks for (generated secrets are pre-filled — just save).

### Optional: NetBird's routing peer, for remote LAN access

Only if this client wants to reach the box's LAN from off-site (working from
home, a second office, …) — skip this if not. Once NetBird VPN is started and
exposed:

1. Open `https://netbird-vpn.<domain>` and log in through Authelia — first
   visit claims account ownership (this one browser click can't be automated
   away; NetBird's own OIDC flow needs a real session).
2. In NetBird's own UI: **your username (Team) → Access Tokens → Create
   Token**, expiration **365 days** (NetBird's hard cap — see
   [app-credentials.md](app-credentials.md) for why nothing shorter or
   longer is possible). Copy the value — shown once.
3. Paste it into `NETBIRD_API_TOKEN` in NetBird VPN's config panel here in
   the dashboard, save, restart NetBird VPN.

Everything past that point — the network resource, its router, the access
policy, and the peer setup key — is created and kept in sync automatically
(plan.md §405); no further NetBird-dashboard steps. Re-paste a fresh token
here once a year when the old one expires (§405 — this half genuinely can't
self-renew, NetBird has no way to mint a token without a human holding a
session in its own UI first).

#### When a client's own network uses the same range as this box's LAN

Very common — most routers default to `192.168.1.0/24`. Their machine
already has a directly-connected route for it, which beats the NetBird one,
so `192.168.1.x` over the VPN reaches *their* network, not this box's.
Nothing needs setting up for it; two ranges handle it automatically.

**The box itself: the routing peer's NetBird overlay IP.** `netbird status`
on any enrolled peer lists it, e.g. `ssh mat@100.94.52.176`,
`http://100.94.52.176:10001`. It works because `netbird-client` runs
`network_mode: host`, so that address is the host's and every service on the
box answers on it; and it can never collide, being inside `100.64.0.0/10`,
which no consumer router hands out.

**Other devices on the box's LAN: the alias range, `10.177.1.x`** (plan.md
§412). The last octet is preserved, so a LAN device is reachable at its own
address with the prefix swapped:

| On the box's LAN | Over the VPN, from anywhere |
|---|---|
| `192.168.1.1` (its gateway) | `10.177.1.1` |
| `192.168.1.30` | `10.177.1.30` |
| `192.168.1.236` (the host) | `10.177.1.236`, or the overlay IP |

Nothing to configure on any client, and the client's own `192.168.1.x` keeps
working — including its default gateway, which is exactly why a client-side
routing tweak can never be the answer for the whole range. Under the hood the
`netbird-lan-alias` sidecar NETMAPs the alias onto the real LAN, and the
backend advertises both as NetBird resources; set `NETBIRD_LAN_ALIAS_CIDR` in
this app's config panel if `10.177.1.x` is itself in use somewhere.

The clearest symptom of a collision, worth recognising on sight: **a LAN
address works from mobile data but not from WiFi.** Mobile data puts the
client in a carrier CGNAT range where nothing competes with the NetBird
route; the same phone on a `192.168.1.0/24` WiFi has a directly-connected
route that wins. The alias range works on both, which is why it is the
address to hand out.

Two more things worth knowing before someone burns an afternoon on it
(verified from a colliding client, plan.md §411.5):

- **`netbird networks deselect` / `select` does not help**, and is not what
  the alias does. NetBird puts its routes in a separate `netbird` routing
  table, consulted by `ip rule` priority 110 — *below* priority 105's
  `lookup main suppress_prefixlength 0`, which serves the client's own
  directly-connected LAN. Deselecting only empties the netbird table;
  selecting cannot make it win.
- **A colliding address can answer from the wrong machine, silently.**
  `192.168.1.1` from such a client reaches *their own router*, not the box's
  LAN. So don't "test the VPN" against a `192.168.1.x` address — a reply
  proves nothing about which side answered. Test the overlay IP or the alias.

### Optional: automate Tailscale's own setup

Step 1 already bootstrapped Tailscale with a hand-generated auth key and
(if it was needed) a manual Funnel click. This closes the loop so neither
is ever needed again on this box:

1. In Tailscale's admin console (<https://login.tailscale.com/admin/>):
   **Settings → Trust credentials** — Tailscale's current nav has moved
   OAuth clients under this label, not a literal "OAuth clients" entry —
   then generate one with scopes **`auth_keys`** and **`policy_file`**,
   tag **`tag:businesslab`** (must match — see
   [app-credentials.md](app-credentials.md) for why). Copy the client ID
   and secret — the secret is shown once.
2. Paste both into `TAILSCALE_OAUTH_CLIENT_ID` /
   `TAILSCALE_OAUTH_CLIENT_SECRET` in Tailscale's config panel here in the
   dashboard, save, restart Tailscale.

From then on, every Tailscale start mints/refreshes `TAILSCALE_AUTH_KEY`
itself (90 days, Tailscale's own max — re-checked and re-minted
automatically before it expires, no human step) and confirms Funnel stays
enabled for `tag:businesslab` in the tailnet's ACL (plan.md §408). This
closes the exact gap that caused a real outage once already (§367 — an
expired auth key deauthed the node and took NetBird's signal server down
with it, because nothing was watching).

## 6. Hand over

- Deployment checklist all green.
- Backup **Test** passes and a first snapshot has run.
- Client can log in, reach their apps through SSO, and has the recovery
  procedure ([recovery-troubleshooting.md](recovery-troubleshooting.md)).

## Dockerized E2E deployment validation

Not part of provisioning a client box — this is the pre-release check that the
core stack itself is sound:

```bash
./scripts/docker-e2e-test.sh
```

Validates frontend static serving, backend + DB connectivity, the
setup/login/refresh/logout auth flows, settings/audit/health/SSE, and
recovery mode toggled from a localhost context.
