import dns from 'dns/promises';

let cachedHostGatewayIp: string | null = null;

/**
 * Resolve the literal IP that reaches the Docker host from any container on
 * this host, regardless of which bridge network the container is on. Every
 * exposed app container publishes its port on the host, so this is the one
 * address Nginx Proxy Manager can always reach it through.
 *
 * Resolved (not passed through as the "host.docker.internal" name) because
 * Nginx's proxy_pass uses its DNS-only resolver for variable upstreams,
 * which does not consult /etc/hosts and cannot resolve that name.
 */
export async function getHostGatewayIp(): Promise<string> {
  if (cachedHostGatewayIp) {
    return cachedHostGatewayIp;
  }
  const { address } = await dns.lookup('host.docker.internal');
  cachedHostGatewayIp = address;
  return address;
}
