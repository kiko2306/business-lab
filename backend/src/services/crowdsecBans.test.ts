import { describe, expect, it } from 'vitest';
import { goDurationSeconds, groupBans, pickStaleBouncers } from './crowdsecBans';

describe('goDurationSeconds', () => {
  it('parses what LAPI puts in a decision duration', () => {
    expect(goDurationSeconds('3h32m29s')).toBe(3 * 3600 + 32 * 60 + 29);
    expect(goDurationSeconds('164h39m5.25s')).toBeCloseTo(164 * 3600 + 39 * 60 + 5.25);
    expect(goDurationSeconds('450ms')).toBeCloseTo(0.45);
    expect(goDurationSeconds('-1m2s')).toBe(-62);
  });
});

describe('groupBans', () => {
  it('keeps active local IP bans, one row per IP, and drops CAPI and expired ones', () => {
    const bans = groupBans([
      {
        scenario: 'crowdsecurity/http-probing',
        created_at: '2026-09-19T11:34:13Z',
        source: { cn: 'AU', as_name: 'GOOGLE-CLOUD-PLATFORM' },
        decisions: [{ value: '34.87.243.166', scope: 'Ip', type: 'ban', origin: 'crowdsec', duration: '1h' }],
      },
      {
        scenario: 'crowdsecurity/http-sensitive-files',
        created_at: '2026-09-19T11:34:10Z',
        decisions: [{ value: '34.87.243.166', scope: 'Ip', type: 'ban', origin: 'crowdsec', duration: '3h' }],
      },
      { decisions: [{ value: '185.220.101.1', scope: 'Ip', type: 'ban', origin: 'CAPI', duration: '100h' }] },
      { decisions: [{ value: '1.2.3.4', scope: 'Ip', type: 'ban', origin: 'crowdsec', duration: '-5m' }] },
      { decisions: [{ value: '10.0.0.0/8', scope: 'Range', type: 'ban', origin: 'cscli', duration: '1h' }] },
    ]);
    expect(bans).toEqual([
      {
        ip: '34.87.243.166',
        scenarios: ['crowdsecurity/http-probing', 'crowdsecurity/http-sensitive-files'],
        expiresInSeconds: 3 * 3600,
        country: 'AU',
        asName: 'GOOGLE-CLOUD-PLATFORM',
        since: '2026-09-19T11:34:10Z',
      },
    ]);
  });
});

// Shape is `cscli bouncers list -o json` on the test box (plan.md §912).
describe('pickStaleBouncers', () => {
  const now = Date.parse('2026-10-13T10:00:00Z');
  const rows = [
    { name: 'cloudflare', ip_address: '', last_pull: null },
    { name: 'nginx', ip_address: '10.201.17.2', last_pull: '2026-09-23T10:04:26Z' },
    { name: 'nginx@10.201.17.3', ip_address: '10.201.17.3', last_pull: '2026-10-07T07:23:42Z' },
    { name: 'nginx@10.201.17.5', ip_address: '10.201.17.5', last_pull: '2026-10-13T09:46:53Z' },
  ];

  it('drops the per-IP copies an NPM recreate left behind', () => {
    expect(pickStaleBouncers(rows, now)).toEqual(['nginx@10.201.17.3']);
  });

  it('never drops the env-registered rows, however old', () => {
    // `nginx` and `cloudflare` come from BOUNCER_KEY_* and CrowdSec re-creates
    // them each start; `cloudflare` never pulls while the edge bouncer is parked.
    const old = rows.map((r) => ({ ...r, last_pull: r.last_pull && '2020-01-01T00:00:00Z' }));
    expect(pickStaleBouncers(old, now)).not.toContain('nginx');
    expect(pickStaleBouncers(old, now)).not.toContain('cloudflare');
  });

  it('keeps the most recent NPM copy even when NPM has been down for days', () => {
    const down = [
      { name: 'nginx@10.201.17.3', ip_address: '10.201.17.3', last_pull: '2026-09-01T00:00:00Z' },
      { name: 'nginx@10.201.17.5', ip_address: '10.201.17.5', last_pull: '2026-09-20T00:00:00Z' },
    ];
    expect(pickStaleBouncers(down, now)).toEqual(['nginx@10.201.17.3']);
  });

  it('leaves a copy that has not pulled yet, and anything with a name a shell would mangle', () => {
    expect(
      pickStaleBouncers(
        [
          { name: 'nginx@10.201.17.6', ip_address: '10.201.17.6', last_pull: null },
          { name: 'nginx@1.2.3.4;rm', ip_address: '1.2.3.4', last_pull: '2020-01-01T00:00:00Z' },
          { name: 'nginx@10.201.17.5', ip_address: '10.201.17.5', last_pull: '2026-10-13T09:46:53Z' },
        ],
        now
      )
    ).toEqual([]);
  });
});
