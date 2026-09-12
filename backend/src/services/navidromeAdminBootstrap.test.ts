import { describe, expect, it } from 'vitest';
import { readSetupState } from './navidromeAdminBootstrap';

describe('readSetupState', () => {
  // The live shape: Navidrome embeds its UI config as a JSON string inside a
  // JS assignment, so the quotes arrive backslash-escaped.
  it('reads the escaped firstTime flag out of the app shell', () => {
    expect(readSetupState('window.__APP_CONFIG__ = "{\\"baseURL\\":\\"\\",\\"firstTime\\":true}"')).toBe(
      'needs-admin'
    );
  });

  it('also reads it unescaped, in case the embedding changes', () => {
    expect(readSetupState('{"firstTime": true}')).toBe('needs-admin');
  });

  it('reads firstTime:false as already set up', () => {
    expect(readSetupState('window.__APP_CONFIG__ = "{\\"firstTime\\":false}"')).toBe('already-setup');
  });

  // Fails closed: POSTing createAdmin at a server that already has users is
  // the damaging direction, so anything unrecognised must read as set up.
  it('treats a missing or renamed flag as already set up, never as needs-admin', () => {
    expect(readSetupState('<html><body>no config here</body></html>')).toBe('already-setup');
    expect(readSetupState('')).toBe('already-setup');
    expect(readSetupState('{"isFirstTime":true}')).toBe('already-setup');
    expect(readSetupState('{"firstTime":"true"}')).toBe('already-setup');
  });
});
