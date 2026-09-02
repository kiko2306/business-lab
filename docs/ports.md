# Host ports

Every managed app answers on a port on the host. Nginx Proxy Manager forwards
to it, so these are internal plumbing — you reach apps by hostname, not port.
Almost all of them get there by publishing a port from a Docker bridge; one
(Home Assistant) binds the host directly instead — see below.

## The scheme

| Range | Use |
|---|---|
| `10000`–`10099` | Core stack (`BACKEND_PORT=10000`, `FRONTEND_PORT=10001`) |
| `10100`+ | Managed apps, alphabetical, in steps of 10 |
| below `10000` | **Only** the three exceptions below |

### Exceptions, and why

| Port | Service | Why it cannot move |
|---|---|---|
| `80` / `443` | Nginx Proxy Manager | The Cloudflare Tunnel connector points at these as its origin |
| `53` | Pi-hole | DNS clients expect port 53 |
| `8123` | Home Assistant | Runs with `network_mode: host` so its zeroconf/SSDP/DHCP discovery can see the LAN; host networking cannot remap ports |

That "below 10000 means deliberate" rule is what protects them: the allocator
only manages ports whose compose default is **≥ 10000**, so there is no list of
special cases to keep in sync.

## Why the renumbering happened

Upstream defaults collided. Before this scheme:

| Port | Claimed by |
|---|---|
| `80` | bookstack, nginx-proxy-manager, speedtest |
| `8080` | file-browser, netbird-management, pihole-web |
| `8081` | dozzle, netbird-dashboard |
| `3000` | home-page **and the backend itself** |

Colliding apps simply fail to start — one at a time, as you enable them, with
an error that points at Docker rather than at the real cause.

## How allocation works

On every `start.sh` run, for each app:

1. If its `.env` already sets the port, **that wins** — always. Upgrades never
   renumber a working install, and a port you chose in the dashboard is never
   moved.
2. Otherwise the compose default is bind-tested on IPv4 and IPv6.
3. If it is taken — by another app here or by anything else on the host — the
   next free port is assigned and written to that app's `.env`.

Any port it had to move is logged:

```
==> jellyfin: JELLYFIN_PORT=10211 (default 10210 was taken)
```

## Changing a port

Edit it in the dashboard's config panel for that app and restart it. The
exposure system re-reads the published port and updates the NPM proxy host, so
the public hostname follows automatically.

Avoid editing `.env` by hand — the dashboard is the source of truth, and a
hand edit can leave its copy disagreeing with the app's.

## Current allocation

`10100` authelia · `10110` beszel · `10120` bookstack · `10130` code-server ·
`10140` dozzle · `10150` duplicati · `10160` file-browser ·
`10190` home-page · `10200` immich · `10210` jellyfin ·
`10220` kitchen-switcher · `10230` mealie · `10240` n8n ·
`10250`–`10253` netbird (management, dashboard, signal, relay) ·
`10260` nextcloud · `10270` npm-admin · `10280` nocodb · `10290` ntfy ·
`10300` pantry · `10310` paperless · `10320` pihole-web ·
`10340` price-compare · `10350` speedtest ·
`10360` stirling-pdf · `10370` uptime-kuma · `10380` vaultwarden ·
`10390` vikunja · `10400` waha · `10410` wetty · `10420` itflow ·
`10430` guacamole

These are the defaults. The allocator may have moved one on your host if
something else already held the port — check the app's `.env` for the truth.

`10180` is free: it was Home Assistant's before it moved to host networking.

## The host-networked app

Home Assistant is the one app that does not publish a port. Its automatic
discovery — zeroconf/mDNS, SSDP/UPnP, and the DHCP sniffer — works on
broadcast and multicast traffic that never crosses a Docker bridge, so it runs
with `network_mode: host` and serves on the host's `8123` directly. There is
no `HA_PORT`: the port is Home Assistant's own setting (Settings → System →
Network), and the allocator leaves it alone because there is no `ports:`
mapping to allocate. The registry declares that `8123` as `hostNetworkPort`
(`backend/src/config/services.ts`) so exposure, the health check and the
dashboard's Open link still know where to look. If something else on the host
already holds `8123`, Home Assistant fails to bind and says so in its log —
that is the one case the allocator cannot cover for you.

## The core stack

`FRONTEND_PORT` used to default to **80**, which collided with Nginx Proxy
Manager the moment you started it — on a fresh install, before you had done
anything wrong. Both core ports now sit in the reserved range.

`BACKEND_PORT` only controls the *host* publish. The frontend reaches the
backend at `http://backend:3000` over the compose network, so changing it
never affects the dashboard itself.

## Two couplings worth knowing

A port that moves can break things that assumed it. Both of these are now
derived automatically, but they are the places to look if authentication or
every hostname breaks at once:

- **Authelia's forward-auth upstream** — NPM's `authelia-location.conf`
  contains a literal `http://<gateway>:<authelia-port>`. Wrong, and *every*
  protected site fails at once. `start.sh` rewrites it each run.
- **NPM's admin API URL** — the dashboard uses it to create proxy hosts, and
  the tunnel origin is derived from it. Wrong, and every public hostname
  serves NPM's admin UI instead of its app. `start.sh` seeds it from the
  gateway and the allocated admin port.

### Retired ports

`10170` (grocy) and `10330`/`10331` (portainer) are retired, not free. A removed app can still have an NPM proxy
host and a Cloudflare hostname pointing at its old port for as long as it takes
the reconciler to clear them, and handing that number to a different app would
route the old hostname at the new app in the meantime. New apps take the next
number above the highest in use.

Alphabetical placement holds for the original allocation. Apps added afterwards
append rather than renumber — rule 1 above (an existing port always wins) is
what protects a working install, and §69 is what happens when a renumbering
moves a port something else was pinned to.
