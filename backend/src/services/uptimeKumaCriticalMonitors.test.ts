import { describe, expect, it } from 'vitest';
import { defaultMonitor, findExistingMonitorNames } from './uptimeKumaCriticalMonitors';

describe('defaultMonitor', () => {
  // A transport failure is the only thing that should count as down — a real
  // HTTP response (NetBird's 401/404, Tailscale's 405) must not trip the
  // monitor, or every one of these would falsely alert as soon as it existed.
  it('accepts any HTTP status code, not just 2xx', () => {
    const monitor = defaultMonitor('NetBird management (public)', 'https://netbird-vpn-api.example.com/api/networks', 3);
    expect(monitor.accepted_statuscodes).toEqual(['100-199', '200-299', '300-399', '400-499', '500-599']);
  });

  it('wires the given notification id into notificationIDList', () => {
    const monitor = defaultMonitor('Authelia (public)', 'https://authelia.example.com/api/health', 7);
    expect(monitor.notificationIDList).toEqual({ 7: true });
  });

  it('carries the name/url/type through unchanged', () => {
    const monitor = defaultMonitor('Tailscale Funnel (also NetBird signal)', 'https://signal.example.ts.net/', 1);
    expect(monitor.type).toBe('http');
    expect(monitor.name).toBe('Tailscale Funnel (also NetBird signal)');
    expect(monitor.url).toBe('https://signal.example.ts.net/');
    expect(monitor.method).toBe('GET');
  });
});

describe('findExistingMonitorNames', () => {
  // The only thing standing between a restart and a duplicate monitor — a
  // monitor's `add` handler has no server-side dedup at all, unlike
  // addNotification's id-based upsert.
  it('collects names out of the monitorList object shape (keyed by id, not an array)', () => {
    const monitorList = {
      '1': { id: 1, name: 'Nginx Proxy Manager (public)' },
      '2': { id: 2, name: 'Authelia (public)' },
    };
    expect(findExistingMonitorNames(monitorList)).toEqual(
      new Set(['Nginx Proxy Manager (public)', 'Authelia (public)'])
    );
  });

  it('ignores rows with no name rather than adding "undefined" to the set', () => {
    const monitorList = { '1': { id: 1 } };
    expect(findExistingMonitorNames(monitorList)).toEqual(new Set());
  });

  it('is empty for an empty monitor list', () => {
    expect(findExistingMonitorNames({})).toEqual(new Set());
  });
});
