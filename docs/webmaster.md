# Webmaster runbook — the Cloudflare side

You own the **Cloudflare account, domain, DNS, Tunnel and Zero Trust** for one
deployment. You do not touch the app stack — that is the
[IT administrator](it-admin.md). This page is your remit and the few things
that are yours to get wrong; everything procedural lives in
[first-run.md](first-run.md).

## The one hard rule: no router changes

No port forwarding. No static WAN IP, no DDNS. No firewall rules. Every inbound
path is either the **Cloudflare Tunnel** or the **Tailscale overlay** — nothing
listens on the public internet directly. A design that needs a router change
does not ship (`plan.md` §0, principle 1). If someone asks you to "just open a
port", the answer is an ingress rule on the tunnel instead.

## What you set up once

Two things have to exist before `start.sh` runs — see
[first-run.md § Before you run it](first-run.md#before-you-run-it):

1. **The domain is a zone in your Cloudflare account.** Every public hostname
   is `<app>.<your-domain>`.
2. **An API token** scoped to **Account → Cloudflare Tunnel: Edit** and
   **Zone → DNS: Edit** — nothing wider.

`start.sh` then creates the tunnel, its ingress rules and the DNS records from
that token. It also looks up the account / zone / tunnel IDs from the domain —
you do not supply them.

## What the dashboard manages after that

Every `<app>.<your-domain>` hostname — its **tunnel ingress rule** and its
**DNS record** — is created when an operator turns on "Publicly expose this
service" and removed when they turn it off. You do **not** hand-create DNS
records or ingress rules for apps. If you see a stray `CNAME` to the tunnel
for an app that is not exposed, that is drift worth investigating, not
something to add to.

The **dashboard's own hostname is the exception**: `start.sh` publishes it and
routes the tunnel **straight to the frontend port, bypassing Nginx Proxy
Manager**, so a broken NPM can still be repaired through the dashboard. Its
subdomain defaults to `homelab` and is set by `DASHBOARD_SUBDOMAIN` in the
root `.env`. The API is deliberately **not** published.

## The two things that are yours and bite

### 1. The `cloudflared` connector is pinned to HTTP/2

`setup_server.sh` writes `/etc/systemd/system/cloudflared.service.d/10-grpc-http2.conf`
with `Environment=TUNNEL_TRANSPORT_PROTOCOL=http2`. cloudflared's default QUIC
backbone silently drops HTTP/2 trailers, which breaks NetBird's gRPC — the
management API answers with no `grpc-status` and NetBird fails in a way that
looks like an unrelated bug (`plan.md` §46, §52).

If you **reinstall cloudflared, rewrite its unit, or move the connector to
another host**, re-apply that drop-in (or pass `--protocol http2` on the
`ExecStart`) or NetBird breaks.

### 2. NetBird's signal server does not use the Cloudflare Tunnel

It is published over **Tailscale Funnel** instead, because the tunnel cannot
carry what signalling needs (`plan.md` §52). So the deployment also needs a
Tailscale account, a reusable auth key, and Funnel enabled on the tailnet —
all covered in [first-run.md](first-run.md). This is the one place two
overlays are in play; everything else is the Cloudflare Tunnel.

## Zero Trust / access control

Forward-auth is done **inside the stack** by Nginx Proxy Manager + Authelia,
not by Cloudflare Access. You normally configure no Cloudflare Access
policies. If you do put Cloudflare Access in front of a hostname, it stacks on
top of Authelia — the user then passes two gates, which is rarely what anyone
wants. Leave access control to the IT administrator's "Require Authelia login"
toggle unless there is a specific reason not to.

## When a hostname is not reachable

Work the list in
[first-run.md § If something is not reachable](first-run.md#if-something-is-not-reachable)
first — most causes are stack-side (app not started, NPM down), not
Cloudflare. Cloudflare-side causes are narrow: DNS not propagated (a new
record takes a minute; a `000` from the host can be a cached NXDOMAIN), the
tunnel connector down (`systemctl status cloudflared`), or an ingress rule
that never got written (check the tunnel's config in the Cloudflare
dashboard against `service_exposure` in the app database).

## Per client

Each client deployment is **its own Cloudflare account, domain, API token and
tunnel** — nothing is shared between clients (`plan.md` §84.7). Handing a
deployment over means handing over that account, or creating the zone and
token inside the client's own account before the first run.
