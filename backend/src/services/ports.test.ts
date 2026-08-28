import { describe, expect, it } from 'vitest';
import { isPortKey, nextFreePort, parseHostPorts } from './ports';

describe('isPortKey', () => {
  it('matches keys that end in PORT', () => {
    expect(isPortKey('DOZZLE_PORT')).toBe(true);
    expect(isPortKey('PIHOLE_WEB_PORT')).toBe(true);
    expect(isPortKey('PORT')).toBe(true);
  });

  it('ignores everything else', () => {
    expect(isPortKey('PORTAINER_URL')).toBe(false);
    expect(isPortKey('VIKUNJA_JWT_SECRET')).toBe(false);
  });
});

describe('parseHostPorts', () => {
  it('pulls host ports out of `docker ps` {{.Ports}} lines', () => {
    const out = [
      '0.0.0.0:8081->80/tcp, [::]:8081->80/tcp',
      '443/tcp, 0.0.0.0:3456->3456/tcp',
      '53/tcp', // container-only, unpublished — skipped
    ].join('\n');
    expect([...parseHostPorts(out)].sort((a, b) => a - b)).toEqual([3456, 8081]);
  });

  it('expands published port ranges', () => {
    expect([...parseHostPorts('0.0.0.0:80-82->80-82/tcp')].sort((a, b) => a - b)).toEqual([80, 81, 82]);
  });

  it('is empty for no published ports', () => {
    expect(parseHostPorts('').size).toBe(0);
  });
});

describe('nextFreePort', () => {
  it('returns the preferred port when it is free', () => {
    expect(nextFreePort(8080, new Set([8081, 8082]))).toBe(8080);
  });

  it('advances past every taken port', () => {
    expect(nextFreePort(8080, new Set([8080, 8081, 8082]))).toBe(8083);
  });

  it('falls back to the input when it is not a usable port', () => {
    expect(nextFreePort(NaN, new Set())).toBeNaN();
    expect(nextFreePort(0, new Set())).toBe(0);
  });
});
