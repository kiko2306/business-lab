import { describe, expect, it } from 'vitest';
import { decodeFrame, isAckOk, isSetupSignal } from './uptimeKumaAdminBootstrap';

// Every frame below was captured from the running app, not invented.
describe('decodeFrame', () => {
  it('decodes the engine.io OPEN frame', () => {
    expect(decodeFrame('0{"sid":"T94CHSS5TkoyBKeFAAAA","upgrades":[],"pingInterval":25000}').kind).toBe('open');
  });

  it('decodes the socket.io CONNECT ack', () => {
    expect(decodeFrame('40{"sid":"bHWc0U7Xrs-vTmEUAAAB"}').kind).toBe('connect');
  });

  it('decodes a ping so it can be ponged', () => {
    expect(decodeFrame('2').kind).toBe('ping');
  });

  it('decodes events, with and without arguments', () => {
    expect(decodeFrame('42["setup"]')).toEqual({ kind: 'event', ackId: undefined, args: ['setup'] });
    expect(decodeFrame('42["info",{"serverTimezone":"UTC"}]')).toEqual({
      kind: 'event',
      ackId: undefined,
      args: ['info', { serverTimezone: 'UTC' }],
    });
  });

  it('decodes an ack and keeps its id, so a stray ack cannot be mistaken for ours', () => {
    expect(decodeFrame('431[{"ok":true,"msg":"ok"}]')).toEqual({
      kind: 'ack',
      ackId: 1,
      args: [{ ok: true, msg: 'ok' }],
    });
  });

  it('reports anything malformed as other rather than throwing', () => {
    expect(decodeFrame('42not-json').kind).toBe('other');
    expect(decodeFrame('42{"not":"an array"}').kind).toBe('other');
    expect(decodeFrame('').kind).toBe('other');
  });
});

describe('isSetupSignal', () => {
  // Its absence is what means "already set up", so a false positive here
  // would fire setup at a live instance.
  it('matches only the server\'s own setup announcement', () => {
    expect(isSetupSignal(decodeFrame('42["setup"]'))).toBe(true);
    expect(isSetupSignal(decodeFrame('42["autoLogin"]'))).toBe(false);
    expect(isSetupSignal(decodeFrame('42["info",{}]'))).toBe(false);
    expect(isSetupSignal(decodeFrame('431[{"ok":true}]'))).toBe(false);
  });
});

describe('isAckOk', () => {
  it('requires an explicit ok:true', () => {
    expect(isAckOk(decodeFrame('431[{"ok":true}]'))).toBe(true);
    expect(isAckOk(decodeFrame('431[{"ok":false,"msg":"Password is too short"}]'))).toBe(false);
    expect(isAckOk(decodeFrame('431[{}]'))).toBe(false);
    expect(isAckOk(decodeFrame('42["setup"]'))).toBe(false);
  });
});
