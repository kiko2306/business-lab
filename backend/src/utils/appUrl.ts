import { getPublishedUpstreamPort } from '../config/services';
import { getHostGatewayIp } from './network';

/**
 * An app's base URL as reached from *this* container: the host gateway,
 * plus the port the app's compose file publishes.
 *
 * Every post-start reconciler that drives a freshly-started app over its own
 * REST/GraphQL/Socket.IO API needs this — the app lives in a different compose
 * project, so its service name doesn't resolve here and the only shared
 * address is the host. Seven modules had a private `resolveXBaseUrl()` doing
 * exactly this, and seven more built the same string inline.
 *
 * `fallbackPort` only covers a compose-file parse miss: the port normally
 * comes from the file itself, so the two can never drift apart on their own.
 *
 * Deliberately not used by the three callers that look similar but aren't:
 * Home Assistant is host-networked, so its port comes from the registry's
 * `hostNetworkPort`, not a published one; NetBird's management port needs a
 * `portEnvVar`; and uptimeKumaCriticalMonitors' `hostPortUrl`/`ntfyServerUrl`
 * return null for a missing port rather than falling back.
 *
 * Lives here rather than in utils/network.ts on purpose: that module is a
 * DNS-only leaf, and importing the service registry into it would invert the
 * layering — and, less abstractly, would break every test that mocks
 * utils/network wholesale, which is most of the bootstrap suites.
 */
export async function appBaseUrl(
  serviceName: string,
  fallbackPort: number,
  scheme: 'http' | 'ws' = 'http'
): Promise<string> {
  const port = getPublishedUpstreamPort(serviceName) ?? fallbackPort;
  return `${scheme}://${await getHostGatewayIp()}:${port}`;
}
