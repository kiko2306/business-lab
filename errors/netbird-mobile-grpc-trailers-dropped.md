# NetBird mobile client: "server closed the stream without sending trailers"

**Reported:** 2026-08-27
**Where:** NetBird Android app → Change Server screen
**Supersedes:** [`errors/netbird-mobile-sso-check-403.md`](./netbird-mobile-sso-check-403.md)
 (that doc's fixes resolved the 403 it describes — this is a *different*,
 later error that appeared once the 403 was gone).

## Error text

> failed to check SSO support: failed getting management service public
> key: rpc error: code = Internal desc = server closed the stream without
> sending trailers

Server field entered: `https://netbird-vpn-api.tx-home-utils.com` (correct
hostname, confirmed).

## Symptom before the app surfaced the error

The app appeared to hang — no error shown, no progress. NPM's access log
for the `-api` host showed why: the real client (`grpc-go/1.80.0` user
agent) was calling `GetServerKey` successfully (`200`) every few seconds,
in a tight retry loop, never moving past it. Manually replaying the same
call with `curl -v --http2` reproduced the pattern: `HTTP/2 200`, correct
`content-type: application/grpc`, a correctly-framed protobuf body — but
**no trailing HEADERS frame with `grpc-status` at all**. A real gRPC client
(unlike curl) requires that trailer to consider a unary call complete, and
retries indefinitely without one — which is exactly what the app was doing
before it eventually surfaced this error.

## Root cause

**An open, unresolved bug in `cloudflared` itself** — not a config problem
on our end. See
https://github.com/cloudflare/cloudflared/issues/1641 ("gRPC response body
and trailers stripped through tunnel even with TLS+ALPN+h2 origin"). The
reported symptom, setup, and exact error message
(`code = Internal desc = server closed the stream without sending
trailers`) match ours precisely, including the specific origin shape that
triggers it: a TLS origin (self-signed is fine) with
`originRequest.http2Origin: true` and `originRequest.noTLSVerify: true` —
which is exactly what this app's exposure automation now configures for
gRPC exposures (see `plan.md` §20.7–20.8, `ensureGrpcCertificate` in
`backend/src/services/npmClient.ts`, `getNpmGrpcOriginUrl` in
`backend/src/services/exposure.ts`). Reported against cloudflared
2025.8.1 and 2026.3.0, still open, no documented workaround.

Why the browser dashboard has never hit this: it uses **grpc-web over
plain HTTP/1.1**, not real gRPC — a completely different, unaffected code
path. Only native clients (mobile, desktop, CLI), which use real gRPC over
HTTP/2 with trailers, are affected. This means **native NetBird clients
likely cannot enroll through a Cloudflare Tunnel at all right now**,
regardless of origin/NPM configuration on our side — this is a platform
limitation, not something to keep chasing with more tuning.

## Fix (planned, not yet implemented)

Only real way around a transport-level bug in `cloudflared` is to stop
routing this one hostname through it. Full plan in `plan.md` §20.10:

1. Router port-forward (443 or a chosen port) directly to the NPM host —
   **needs the user**, can't be done remotely.
2. Switch `netbird-vpn-api.tx-home-utils.com`'s Cloudflare DNS record to
   **unproxied** (grey-cloud), so traffic goes client → router → NPM
   directly, bypassing the tunnel.
3. Replace the self-signed cert (only valid because `noTLSVerify` skipped
   validation on the tunnel side) with a **real** Let's Encrypt cert via
   NPM's DNS-01 Cloudflare plugin — the app's existing Cloudflare API
   token already has the DNS edit rights this needs.
4. App-side: needs a way to mark an exposure as "direct" instead of
   always assuming the Cloudflare Tunnel. Bigger change than the gRPC flag
   was — size it up properly first.

**Blocked on:** confirming the user has (or can get, via DDNS) a stable
public IP to port-forward to. Nothing to implement until that's confirmed.
