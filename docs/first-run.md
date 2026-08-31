# First run: before, during, and after `start.sh`

Answers three questions in order: what to have ready, what the script asks
for, and what is actually reachable once it finishes.

Per-app login credentials are in [app-credentials.md](app-credentials.md).

## Before you run it

`start.sh` installs packages, manages systemd units and writes to
`/etc/docker`, so it must run as root:

```bash
sudo ./start.sh
```

It installs Docker itself if missing, so a bare Ubuntu/Debian host is enough.
What it does **not** do, and you need in advance:

| Prerequisite | Why | Notes |
|---|---|---|
| **A domain on Cloudflare** | Every public hostname is `<app>.<your-domain>`, published through a Cloudflare Tunnel | The domain must already be a zone in your Cloudflare account |
| **A Cloudflare API token** | Creates the tunnel, its ingress rules and DNS records | Needs **Account → Cloudflare Tunnel: Edit** and **Zone → DNS: Edit** |
| **A Tailscale account + auth key** | NetBird's signal server is published over Tailscale Funnel; it cannot work through the Cloudflare Tunnel (see plan.md §52) | A reusable auth key from <https://login.tailscale.com/admin/settings/keys> |
| **Tailscale Funnel enabled** | Same reason | One-time per tailnet. If it isn't, `start.sh` prints the exact one-click URL to enable it — you can also do this after the fact and re-run |
| **`cloudflared` installed** | `start.sh` configures the tunnel but does not install the connector | It *does* pin the connector's transport, which NetBird depends on |
| **systemd running as PID 1** | The tunnel connector is a systemd unit | WSL needs `systemd=true` in `/etc/wsl.conf`; `start.sh` warns loudly if it is missing |

Only the domain and the two credentials genuinely have to exist beforehand.
Everything else the script either installs or warns about clearly.

## What it asks you for

Four values, all remembered in `.env` so a re-run never asks twice:

| Prompt | Example | Used for |
|---|---|---|
| `BASE_DOMAIN` | `example.com` | Every public hostname, plus Authelia's and NetBird's URLs |
| `CLOUDFLARE_API_TOKEN` | *(hidden input)* | Tunnel + DNS provisioning |
| `TUNNEL_NAME` | defaults to the hostname | Names the Cloudflare Tunnel for this host |
| `TAILSCALE_AUTH_KEY` | `tskey-auth-…` *(hidden input)* | Joins the tailnet so NetBird signalling can be published |

Everything else is derived or generated: per-app secrets, database passwords,
Authelia's signing keys, NetBird's store-encryption key and relay secret, the
web terminal's SSH key, host port allocation, and the Cloudflare account/zone
/tunnel IDs (looked up from the domain).

Non-interactive runs (no TTY) skip the prompts and the setup they gate, then
tell you to re-run interactively — they never hang waiting for input.

## What is reachable when it finishes

**The dashboard, and only the dashboard.**

```
http://<this-host>:10001
```

That is deliberate but easy to misread as a failure. `start.sh` brings up the
*core stack* — dashboard frontend, backend, database, docker-socket-proxy —
plus Tailscale, because NetBird signalling depends on it. Every other app is
started from the dashboard, so nothing else is running or published yet.

Your first login sets the dashboard's own admin account (it is in setup mode
until you do).

### The order that works

Some apps depend on others, and starting them out of order fails in ways that
look like unrelated bugs:

1. **Nginx Proxy Manager** — every public hostname is served through it, so
   nothing can be exposed until it runs. Log in and change its default
   credentials immediately (see [app-credentials.md](app-credentials.md)).
2. **Authelia** — the login gate in front of protected apps. Anything with
   "Require Authelia login" enabled returns errors until Authelia is up, and
   NetBird refuses to start at all without it.
3. **Everything else**, in any order.

### Then, per app

- Start it from the dashboard.
- Set any config it needs (the dashboard pre-fills generated secrets — just
  save).
- Turn on **Publicly expose this service**, and **Require Authelia login**
  unless the app has its own solid authentication.

Exposure provisioning creates the NPM proxy host, the tunnel ingress rule and
the DNS record automatically. Turning exposure off removes all three.

## If something is not reachable

- **The app is not started.** The most common cause; check the dashboard.
- **NPM is not running.** Everything public depends on it.
- **DNS has not propagated.** New hostnames take a minute; a `000` from the
  host itself can also be a cached NXDOMAIN from before the record existed.
- **The port collided.** `start.sh` allocates from 10100 upward and logs any
  app it had to move; see [ports.md](ports.md).
