# NetBird mobile client: "failed to check SSO support" (403 Forbidden)

**Reported:** 2026-08-27
**Where:** NetBird Android app → Change Server screen

## Error text (from screenshot)

> failed to check SSO support: failed getting Management Service public key:
> rpc error: code = PermissionDenied desc = unexpected HTTP status code
> received from server: 403 (Forbidden); transport: received unexpected
> content-type "text/html"

Server field entered: `https://netbird-vpn.tx-home-utils.com`

> Note: I could not save the actual screenshot file into this folder — it
> was shared inline in the chat, not as a file on disk, and I have no tool
> access to export chat-attached images to the filesystem. This file
> documents the error text and the diagnosis instead.

## Root cause

`netbird-vpn.tx-home-utils.com` is the **dashboard** hostname — a plain
static-file server (`netbirdio/dashboard` image) with no server-side proxy
for the Management API. The browser dashboard talks to the API directly via
its own separate hostname, `netbird-vpn-api.tx-home-utils.com`
(see `apps/netbird-vpn/docker-compose.yml`, `NETBIRD_MGMT_API_ENDPOINT`).

The mobile/desktop client's "Server" field must point at the **Management
API** endpoint, not the dashboard. Pointing it at the dashboard host means
the client's gRPC call for the management server's public key lands on the
dashboard's static-file nginx, which has no matching route for it and
returns a 403 HTML error page — exactly the `text/html` content-type and
403 status in the error message.

This is also why native clients need HTTP/2 (`grpc_pass`, not `proxy_pass`)
end-to-end on the `-api` host — see the `grpc` handling in
`backend/src/config/services.ts` and `backend/src/services/npmClient.ts`
(`buildGrpcAdvancedConfig`, `http2_support`). If the proxy host for
`netbird-vpn-api.tx-home-utils.com` isn't provisioned with that gRPC/HTTP2
config, the same 403/text-html failure can occur even with the correct
hostname.

## Fix

1. In the NetBird app's "Change Server" screen, use:
   `https://netbird-vpn-api.tx-home-utils.com`
   (not `netbird-vpn.tx-home-utils.com`).
2. If that still 403s, check Nginx Proxy Manager for the
   `netbird-vpn-api.tx-home-utils.com` proxy host and confirm:
   - `http2_support` is enabled on the listener, and
   - the advanced config uses `grpc_pass grpc://netbird-management:80;`
     rather than the default `proxy_pass`.
   This app's exposure automation (`additionalExposures` with `grpc: true`
   in `backend/src/config/services.ts`) is supposed to create the proxy
   host this way automatically — if it's missing, re-run/re-sync exposure
   for the `netbird-vpn` service, or check NPM for a stale/manually-edited
   proxy host that predates this config.
