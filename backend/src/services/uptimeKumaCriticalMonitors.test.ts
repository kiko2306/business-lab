import { describe, expect, it } from 'vitest';
import { defaultMonitor, findExistingMonitorNames, notificationIdsFor, reconciledRow } from './uptimeKumaCriticalMonitors';

describe('defaultMonitor', () => {
  // A transport failure is the only thing that should count as down — a real
  // HTTP response (NetBird's 401/404, Tailscale's 405) must not trip the
  // monitor, or every one of these would falsely alert as soon as it existed.
  it('accepts any HTTP status code, not just 2xx', () => {
    const monitor = defaultMonitor('NetBird management (public)', 'https://netbird-vpn-api.example.com/api/instance', [3]);
    expect(monitor.accepted_statuscodes).toEqual(['100-199', '200-299', '300-399', '400-499', '500-599']);
  });

  it('wires the given notification id into notificationIDList', () => {
    const monitor = defaultMonitor('Authelia (public)', 'https://authelia.example.com/api/health', [7]);
    expect(monitor.notificationIDList).toEqual({ 7: true });
  });

  it('carries the name/url/type through unchanged', () => {
    const monitor = defaultMonitor('Tailscale Funnel (also NetBird signal)', 'https://signal.example.ts.net/', [1]);
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

describe('notificationIdsFor', () => {
  // ntfy can't report its own outage, so its monitor must reach the operator
  // some other way (§533).
  it('sends the ntfy monitor to email only', () => {
    expect(notificationIdsFor('email', 3, 9)).toEqual([9]);
  });

  it('keeps every other monitor on ntfy only', () => {
    expect(notificationIdsFor('ntfy', 3, 9)).toEqual([3]);
  });

  it('falls back to ntfy when no email notification exists, rather than alerting nowhere', () => {
    expect(notificationIdsFor('email', 3, null)).toEqual([3]);
  });
});

describe('defaultMonitor with a health endpoint', () => {
  it('wires every notification id and passes only the given statuses', () => {
    const monitor = defaultMonitor('n8n (alert relay)', 'http://10.201.0.1:10240/healthz', [3, 9], ['200-299']);
    expect(monitor.notificationIDList).toEqual({ 3: true, 9: true });
    expect(monitor.accepted_statuscodes).toEqual(['200-299']);
  });
});

describe('reconciledRow', () => {
  const row = {
    id: 3,
    name: 'Tailscale Funnel (also NetBird signal)',
    maxretries: 1,
    url: 'https://x.ts.net/',
    notificationIDList: { '1': true, '2': true },
  };

  it('raises a lower retry count, keeping every other field', () => {
    expect(reconciledRow(row, 7, [1, 2])).toEqual({ ...row, maxretries: 7 });
  });

  it('never lowers a hand-raised count, and ignores monitors without a minimum', () => {
    expect(reconciledRow({ ...row, maxretries: 10 }, 7, [1, 2])).toBeNull();
    expect(reconciledRow({ ...row, maxretries: 7 }, 7, [1, 2])).toBeNull();
    expect(reconciledRow(row, undefined, [1, 2])).toBeNull();
  });

  it('strips the applyExisting email notification when the ids must be exact', () => {
    expect(reconciledRow({ ...row, maxretries: 7 }, 7, [2])).toEqual({ ...row, maxretries: 7, notificationIDList: { '2': true } });
    expect(reconciledRow({ ...row, maxretries: 7, notificationIDList: { '2': true, '1': false } }, 7, [2])).toBeNull();
  });

  it('repoints a monitor whose probe URL changed, and leaves a matching one alone', () => {
    expect(reconciledRow({ ...row, maxretries: 7 }, 7, [1, 2], 'https://y/')).toEqual({ ...row, maxretries: 7, url: 'https://y/' });
    expect(reconciledRow({ ...row, maxretries: 7 }, 7, [1, 2], row.url)).toBeNull();
    expect(reconciledRow({ ...row, maxretries: 7 }, 7, [1, 2], null)).toBeNull();
  });

  it('passes the retry count through to a new monitor', () => {
    expect(defaultMonitor('m', 'https://x/', [1], undefined, 7).maxretries).toBe(7);
    expect(defaultMonitor('m', 'https://x/', [1]).maxretries).toBe(1);
  });
});
