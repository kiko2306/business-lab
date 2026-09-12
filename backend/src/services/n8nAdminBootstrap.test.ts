import { describe, expect, it } from 'vitest';
import { readSetupState, splitName } from './n8nAdminBootstrap';

describe('readSetupState', () => {
  // The live shape, as returned by GET /rest/settings on an unclaimed n8n.
  it('reads n8n\'s showSetupOnFirstLoad as "no owner yet"', () => {
    expect(
      readSetupState({
        data: { userManagement: { authenticationMethod: 'email', showSetupOnFirstLoad: true } },
      })
    ).toBe('needs-owner');
  });

  it('treats the flag being false as already owned', () => {
    expect(readSetupState({ data: { userManagement: { showSetupOnFirstLoad: false } } })).toBe('already-owned');
  });

  // Fails closed on purpose: an upstream rename must not be read as "no owner
  // yet", which would POST the setup endpoint on every start of a live n8n.
  it('treats a missing or unrecognised shape as already owned, never as needs-owner', () => {
    expect(readSetupState({})).toBe('already-owned');
    expect(readSetupState({ data: {} })).toBe('already-owned');
    expect(readSetupState({ data: { userManagement: {} } })).toBe('already-owned');
    expect(readSetupState(null)).toBe('already-owned');
    expect(readSetupState({ data: { userManagement: { showSetupOnFirstLoad: 'yes' } } })).toBe('already-owned');
  });
});

describe('splitName', () => {
  it('splits a display name, and falls back when there is none', () => {
    expect(splitName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(splitName('Ada Byron Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Byron Lovelace' });
    expect(splitName('Ada')).toEqual({ firstName: 'Ada', lastName: 'Admin' });
    expect(splitName('')).toEqual({ firstName: 'Admin', lastName: 'User' });
    expect(splitName(undefined)).toEqual({ firstName: 'Admin', lastName: 'User' });
  });
});
