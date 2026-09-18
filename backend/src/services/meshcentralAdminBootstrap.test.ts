import { describe, expect, it } from 'vitest';
import { readSetupState } from './meshcentralAdminBootstrap';

describe('readSetupState', () => {
  // The live shape, from the login page of an unclaimed server (2026-09-18).
  it('reads the unclaimed login page as needing an admin', () => {
    expect(readSetupState('var x=1;newAccount="true",newAccountPass=parseInt("0")')).toBe('needs-admin');
  });

  it('reads newAccount="false" as already set up', () => {
    expect(readSetupState('newAccount="false",newAccountPass=parseInt("0")')).toBe('already-setup');
  });

  // Fails closed: creating an account at a server that has users is the
  // damaging direction, so anything unrecognised must read as set up.
  it('treats a missing or reshaped flag as already set up, never as needs-admin', () => {
    expect(readSetupState('')).toBe('already-setup');
    expect(readSetupState('<html>no flag</html>')).toBe('already-setup');
    expect(readSetupState('newAccount=true')).toBe('already-setup');
    expect(readSetupState('allowNewAccount="true"')).toBe('already-setup');
  });
});
