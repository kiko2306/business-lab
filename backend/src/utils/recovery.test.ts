import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { isLocalRequest, recoveryStatusBody } from './recovery';

// plan.md §829: the HTTP recovery endpoints gate on a loopback caller, which
// with the backend in a container only a request from inside it satisfies. The
// page could not say so, so a locked-out person met a 403 and no way forward.
const from = (ip: string) => ({ ip, socket: { remoteAddress: ip } }) as unknown as Request;

describe('isLocalRequest', () => {
  it('accepts every spelling of loopback', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isLocalRequest(from(ip))).toBe(true);
    }
  });

  it('refuses the Docker gateway and a LAN address, which is every browser on a containerised install', () => {
    for (const ip of ['172.18.0.1', '192.168.1.50', '']) {
      expect(isLocalRequest(from(ip))).toBe(false);
    }
  });
});

// plan.md §879 item 4. `req.ip` is proxy-derived: under `trust proxy` Express
// reads it out of X-Forwarded-For. A localhost gate must not be settable by a
// header — nginx overwrites that header today and the container is not reachable
// from outside the compose network, but `TRUST_PROXY` is operator-settable and
// `proxy-addr` had just shipped an IP-spoofing advisory (§875).
describe('isLocalRequest and a spoofed forwarding header', () => {
  // What Express hands a handler when X-Forwarded-For says 127.0.0.1 but the
  // connection itself came from somewhere else.
  const spoofed = (claimedIp: string, realIp: string) =>
    ({ ip: claimedIp, socket: { remoteAddress: realIp } }) as unknown as Request;

  it('judges the socket, not the forwarded address', () => {
    expect(isLocalRequest(spoofed('127.0.0.1', '172.18.0.5'))).toBe(false);
    expect(isLocalRequest(spoofed('::1', '192.168.1.50'))).toBe(false);
  });

  it('still accepts a real loopback connection whatever the header claims', () => {
    expect(isLocalRequest(spoofed('10.0.0.9', '127.0.0.1'))).toBe(true);
  });

  it('refuses a request with no socket address at all', () => {
    expect(isLocalRequest({ ip: '127.0.0.1' } as unknown as Request)).toBe(false);
  });
});

describe('recoveryStatusBody', () => {
  it('says whether recovery is on and whether this caller can use it', () => {
    expect(recoveryStatusBody(false, from('127.0.0.1'))).toEqual({ enabled: false, available: true });
    expect(recoveryStatusBody(true, from('172.18.0.1'))).toEqual({ enabled: true, available: false });
  });
});
