import { describe, expect, it } from 'vitest';
import { parseNmapOutput } from './networkScan';

describe('parseNmapOutput', () => {
  // Verbatim `nmap -sn` output captured against this host's real LAN.
  const sample = [
    'Starting Nmap 7.98 ( https://nmap.org ) at 2026-09-02 13:56 +0000',
    'Nmap scan report for NOSdrive.home (192.168.1.1)',
    'Host is up (0.00065s latency).',
    'MAC Address: 38:17:B1:9E:FF:47 (Sagemcom Broadband SAS)',
    'Nmap scan report for 6C:10:41:2D:D5:08 (192.168.1.3)',
    'Host is up (0.0014s latency).',
    'MAC Address: 6C:10:41:2D:D5:08 (Unknown)',
    'Nmap scan report for LG_Smart_Fridge2_open (192.168.1.17)',
    'Host is up (0.11s latency).',
    'MAC Address: E0:85:4D:9C:D6:E7 (LG Innotek)',
    'Nmap scan report for 192.168.1.15',
    'Host is up (0.11s latency).',
    'MAC Address: B8:50:D8:10:54:2E (Beijing Xiaomi Mobile Software)',
    'Nmap scan report for home-srv-01 (192.168.1.23)',
    'Host is up.',
    'Nmap done: 512 IP addresses (5 hosts up) scanned in 10.08 seconds',
  ].join('\n');

  it('reads hostname, ip and MAC vendor for a fully-resolved host', () => {
    const hosts = parseNmapOutput(sample);
    const router = hosts.find((h) => h.ip === '192.168.1.1');
    expect(router).toEqual({ ip: '192.168.1.1', hostname: 'NOSdrive.home', type: 'Sagemcom Broadband SAS' });
  });

  it('treats a MAC address standing in for the hostname as no hostname', () => {
    // nmap prints the MAC where a hostname would go once reverse-DNS/NetBIOS/mDNS
    // all fail to name the host — that is not a real hostname.
    const hosts = parseNmapOutput(sample);
    const unresolved = hosts.find((h) => h.ip === '192.168.1.3');
    expect(unresolved?.hostname).toBeNull();
  });

  it('maps an "Unknown" vendor to no type rather than the literal string', () => {
    const hosts = parseNmapOutput(sample);
    const unresolved = hosts.find((h) => h.ip === '192.168.1.3');
    expect(unresolved?.type).toBeNull();
  });

  it('handles a host with neither a resolvable hostname nor MAC parens', () => {
    const hosts = parseNmapOutput(sample);
    const noName = hosts.find((h) => h.ip === '192.168.1.15');
    expect(noName?.hostname).toBeNull();
    expect(noName?.type).toBe('Beijing Xiaomi Mobile Software');
  });

  it('handles the scanning host itself, which has no MAC Address line', () => {
    const hosts = parseNmapOutput(sample);
    const self = hosts.find((h) => h.ip === '192.168.1.23');
    expect(self).toEqual({ ip: '192.168.1.23', hostname: 'home-srv-01', type: null });
  });

  it('sorts by numeric IP rather than string order', () => {
    const hosts = parseNmapOutput(sample);
    expect(hosts.map((h) => h.ip)).toEqual(['192.168.1.1', '192.168.1.3', '192.168.1.15', '192.168.1.17', '192.168.1.23']);
  });

  it('returns an empty list when nothing was up', () => {
    expect(parseNmapOutput('Nmap done: 0 IP addresses (0 hosts up) scanned in 0.00 seconds')).toEqual([]);
  });
});
