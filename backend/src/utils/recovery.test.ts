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

describe('recoveryStatusBody', () => {
  it('says whether recovery is on and whether this caller can use it', () => {
    expect(recoveryStatusBody(false, from('127.0.0.1'))).toEqual({ enabled: false, available: true });
    expect(recoveryStatusBody(true, from('172.18.0.1'))).toEqual({ enabled: true, available: false });
  });
});
