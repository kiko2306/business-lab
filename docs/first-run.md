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

### Where Docker keeps its data

Worth deciding before the images pile up, because Ubuntu's installer creates a
root filesystem of about 100 GiB and hands the rest of the disk to `/home` —
so a 500 GB machine can still run Docker out of space while most of the disk
sits idle. Check with `lsblk` and `df -h /` before the first run.

To put Docker's storage somewhere else, set `DOCKER_DATA_ROOT` when running the
script:

```bash
sudo DOCKER_DATA_ROOT=/home/docker ./start.sh
```

Opt-in and idempotent. On a fresh host it costs nothing — there is nothing to
copy yet. On a host that has been running a while it stops the daemon (so every
container with it), checks there is room, copies the tree with `rsync -aHAX`,
adds `data-root` to `/etc/docker/daemon.json` keeping the address pools, and
restarts, then compares the image and container counts either side.

The old tree is left in place. Rollback is removing `data-root` from
`daemon.json` and restarting Docker; reclaim the space with
`sudo rm -rf /var/lib/docker` once you're satisfied.

### Adding a disk later

When the machine gets a second disk, nothing uses it until something claims it.
If the filesystem you want to grow is on LVM — which it is on a default Ubuntu
Server install — the disk can be absorbed into the existing volume group and
the filesystem grown **while everything stays running**:

```bash
sudo EXPAND_VG_DISK=/dev/sdX ./start.sh
```

`lsblk -dno NAME,SIZE,MODEL` lists the disks; pick the whole disk, not a
partition. By default it grows whatever holds `/home`, which is where Docker's
data root and containerd's root live once the move above has run — set
`EXPAND_VG_TARGET` to grow a different mount point instead.

**It erases the named disk.** Before doing anything it refuses a disk that has
a mounted filesystem or belongs to another volume group, prints the partition
table it is about to destroy, and asks you to type the disk name back. Set
`EXPAND_VG_ASSUME_YES=1` only when you are scripting it and certain.

The disk becomes a whole-disk physical volume, with no partition table —
`lsblk` will show it as an `LVM2_member` with no children. Running it a second
time with the same disk is a no-op.

One thing to be clear about before you do this: a volume group spanning two
disks with no redundancy fails if **either** disk fails, and takes the
filesystem with it. That is a fine trade when backups are known to work, and a
bad one when they are not. `start.sh` prints the same warning every time it
runs.

`./scripts/test-vg-expansion.sh` exercises this against loopback disks — the
refusals, the grow, and a repeat run — without touching a real one.

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

### Two more prompts, from `setup_server.sh`

`start.sh` sources `setup_server.sh` for the host-only half of bootstrap
(packages, Docker, the daemon address-pool, cloudflared's transport) before
any of the above. That file also offers two one-time, opt-in y/N prompts of
its own, both skipped automatically without a TTY:

| Prompt | What it does | Why it asks instead of just doing it |
|---|---|---|
| **Set a fixed IP** | Writes a netplan config for a static address, applied with `netplan try` (auto-reverts unless you press ENTER within 45s) | A wrong gateway/DNS value can cut off the very session used to fix it |
| **Remove the sudo password prompt** | A `NOPASSWD:ALL` sudoers entry for the invoking user | Full passwordless sudo is a real privilege grant — safe now that code-server's LAN port requires its own login (plan.md §93), but still asked every time, not assumed |

Say no (or just press Enter) to skip either one; re-run `./start.sh` later to
be asked again.

## What is reachable when it finishes

**The dashboard, and only the dashboard** — on the host, and publicly:

```
http://<this-host>:10001          always
https://homelab.<your-domain>     once the tunnel is up
```

That is deliberate but easy to misread as a failure. `start.sh` brings up the
*core stack* — dashboard frontend, backend, database, docker-socket-proxy —
plus Tailscale, because NetBird signalling depends on it. Every other app is
started from the dashboard, so nothing else is running or published yet.

`start.sh` publishes the dashboard's own hostname itself, and does it
differently from every other app: the tunnel routes **straight to
`localhost:<FRONTEND_PORT>`, bypassing Nginx Proxy Manager**. Routing it
through NPM would make the one tool you would use to repair a broken NPM
depend on NPM being healthy. The subdomain defaults to `homelab` and can be
changed with `DASHBOARD_SUBDOMAIN` in the root `.env`.

The **API is not published**. The frontend proxies `/api` to the backend over
the compose network, so a public API hostname would add attack surface without
adding capability.

Your first login sets the dashboard's own admin account (it is in setup mode
until you do).

### The order that works

Some apps depend on others, and starting them out of order fails in ways that
look like unrelated bugs:

1. **Nginx Proxy Manager** — every public hostname is served through it, so
   nothing can be exposed until it runs. Log in and change its default
   credentials immediately (see [app-credentials.md](app-credentials.md)).
2. **Authelia** — the login gate in front of every exposed app but Home
   Page. Anything you expose returns errors until Authelia is up, and
   NetBird refuses to start at all without it.
3. **Everything else**, in any order.

### Then, per app

- Start it from the dashboard.
- Set any config it needs (the dashboard pre-fills generated secrets — just
  save).
- Turn on **Publicly expose this service**. Authelia protection is applied
  automatically — there's nothing to toggle, except for Home Page, which
  stays public by design.

Exposure provisioning creates the NPM proxy host, the tunnel ingress rule and
the DNS record automatically. Turning exposure off removes all three.

## If something is not reachable

- **The app is not started.** The most common cause; check the dashboard.
- **NPM is not running.** Everything public depends on it.
- **DNS has not propagated.** New hostnames take a minute; a `000` from the
  host itself can also be a cached NXDOMAIN from before the record existed.
- **The port collided.** `start.sh` allocates from 10100 upward and logs any
  app it had to move; see [ports.md](ports.md).
