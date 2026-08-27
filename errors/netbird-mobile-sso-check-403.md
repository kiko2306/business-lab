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
2. **Update (confirmed 2026-08-27):** switching to the `-api` hostname
   alone did *not* fix it — same 403/`text/html` error. This points at the
   secondary cause: the NPM proxy host for `netbird-vpn-api.tx-home-utils.com`
   isn't configured for gRPC/HTTP2.

   In Nginx Proxy Manager → Proxy Hosts → `netbird-vpn-api.tx-home-utils.com`
   → Edit, confirm:
   - **Details tab** → "HTTP/2 Support" is **enabled**.
   - **Advanced tab** → custom config is:
     ```
     location / {
         grpc_pass grpc://netbird-management:80;
     }
     ```
     A plain `proxy_pass http://...` (NPM's default) cannot speak gRPC to
     the backend and causes nginx to reject the request with a 403 HTML
     error page — the exact symptom seen here.

   This app's exposure automation (`additionalExposures` with `grpc: true`
   in `backend/src/config/services.ts`, built by `buildGrpcAdvancedConfig`
   in `backend/src/services/npmClient.ts`) is supposed to create/maintain
   the proxy host this way automatically. If it's still on plain
   `proxy_pass`/HTTP1.1, the proxy host was likely created or edited by
   hand before this automation existed, or the exposure sync hasn't been
   re-run since. Re-sync exposure for the `netbird-vpn` service (or
   manually fix the two settings above) and retry.
