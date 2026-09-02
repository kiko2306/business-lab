/**
 * LAN device discovery for the dashboard's Utils section.
 *
 * The backend container itself sits on the internal `homelab-net` Docker
 * bridge, not the physical LAN, so it cannot see LAN hosts directly. Instead
 * it launches a short-lived `--network host` container through the same
 * `docker` CLI (routed at `DOCKER_HOST` to docker-socket-proxy) that
 * `executor.ts` already uses for compose — a scan-only container is created
 * and removed per request rather than granting the backend itself permanent
 * host-network access, which would be a much wider and always-on change.
 */

import { execFile } from 'child_process';

const SCAN_IMAGE = 'instrumentisto/nmap:latest';
const SCAN_TIMEOUT_MS = 60_000;
const SCAN_MAX_BUFFER = 4 * 1024 * 1024;

// Resolved inside the scan container (it shares the host's network
// namespace) rather than the backend's own, since the backend only ever
// sees the Docker bridge's route table.
const SCAN_SCRIPT = `
iface=$(ip -o -4 route show to default | awk '{print $5}')
cidr=$(ip -o -4 addr show dev "$iface" | awk '{print $4}' | head -1)
nmap -sn "$cidr"
`;

export interface DiscoveredHost {
  ip: string;
  hostname: string | null;
  type: string | null;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: SCAN_TIMEOUT_MS, maxBuffer: SCAN_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Parses plain `nmap -sn` output into discovered hosts. Pulled out as its own
 * function because it is the only part of this feature that is worth
 * unit-testing — running Docker is not.
 *
 * When reverse-DNS/NetBIOS/mDNS all fail to name a host, nmap prints the
 * host's own MAC address in the slot a hostname would otherwise occupy
 * (`Nmap scan report for AA:BB:CC:DD:EE:FF (192.168.1.3)`), so that case is
 * detected and treated as "no hostname" rather than shown as one.
 */
export function parseNmapOutput(output: string): DiscoveredHost[] {
  const hostBlockRe =
    /Nmap scan report for (?:(\S+) \(([\d.]+)\)|([\d.]+))\r?\nHost is up[^\n]*\r?\n(?:MAC Address: (\S+) \(([^)]*)\)\r?\n?)?/g;

  const hosts: DiscoveredHost[] = [];
  let match: RegExpExecArray | null;
  while ((match = hostBlockRe.exec(output)) !== null) {
    const [, name, ipWithName, ipAlone, mac, vendor] = match;
    const ip = ipWithName ?? ipAlone;
    const isMacPlaceholder = !!name && !!mac && name.toLowerCase() === mac.toLowerCase();
    hosts.push({
      ip,
      hostname: name && !isMacPlaceholder ? name : null,
      type: vendor && vendor !== 'Unknown' ? vendor : null,
    });
  }

  return hosts.sort((a, b) => ipSortKey(a.ip) - ipSortKey(b.ip));
}

function ipSortKey(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

export async function scanLan(): Promise<DiscoveredHost[]> {
  // The image's default entrypoint is `nmap` itself, not a shell — without
  // this override, "sh -c <script>" is passed to nmap as its own arguments
  // instead of running as a shell command.
  const stdout = await run('docker', [
    'run', '--rm', '--network', 'host', '--entrypoint', 'sh', SCAN_IMAGE, '-c', SCAN_SCRIPT,
  ]);
  return parseNmapOutput(stdout);
}
