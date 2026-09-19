import { describe, expect, it } from 'vitest';
import { goDurationSeconds, groupBans } from './crowdsecBans';

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
