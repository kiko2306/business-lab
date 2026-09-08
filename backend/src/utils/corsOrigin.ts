/**
 * Whether a browser-sent `Origin` header names the same host as the request
 * it arrived on. See index.ts's CORS setup (plan.md §286) for why this
 * matters: this dashboard is reachable at several different origins (a LAN
 * IP, the public Cloudflare hostname, `localhost` on the host itself), so a
 * fixed origin allowlist can never cover the same-origin case correctly —
 * comparing against the request's own Host header does.
 */
export function isSameOrigin(origin: string, requestHost: string | undefined): boolean {
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}
