import { describe, it, expect } from 'vitest';
import { CAPABILITIES, effectiveCapabilities, hasCapability, webmasterOnlyReason } from './capabilities';

const ALL = [...CAPABILITIES].sort();

describe('effectiveCapabilities', () => {
  it('gives a webmaster every capability, ignoring any grant rows', () => {
    expect(effectiveCapabilities(['webmaster']).sort()).toEqual(ALL);
    // A stray grant row must not be able to *narrow* a webmaster.
    expect(effectiveCapabilities(['webmaster'], ['audit:view']).sort()).toEqual(ALL);
  });

  it('gives a user nothing', () => {
    expect(effectiveCapabilities(['user'])).toEqual([]);
    expect(effectiveCapabilities(['user'], ['apps:control'])).toEqual([]);
  });

  it('gives an admin with no grant rows every capability (all-on default)', () => {
    expect(effectiveCapabilities(['admin']).sort()).toEqual(ALL);
  });

  it('scopes an admin to exactly its grant rows when it has some', () => {
    const caps = effectiveCapabilities(['admin'], ['apps:control', 'backups:manage']);
    expect(caps).toEqual(['apps:control', 'backups:manage']);
  });

  it('ignores unknown grant names and de-dupes', () => {
    const caps = effectiveCapabilities(['admin'], ['apps:control', 'apps:control', 'nonsense']);
    expect(caps).toEqual(['apps:control']);
  });

  it('returns capabilities in canonical order regardless of grant order', () => {
    expect(effectiveCapabilities(['admin'], ['backups:manage', 'apps:control'])).toEqual([
      'apps:control',
      'backups:manage',
    ]);
  });

  it('takes the webmaster path when an account holds both roles', () => {
    expect(effectiveCapabilities(['admin', 'webmaster'], ['audit:view']).sort()).toEqual(ALL);
  });

  it('gives an unknown / empty role set nothing', () => {
    expect(effectiveCapabilities([])).toEqual([]);
    expect(effectiveCapabilities(['nonsense'])).toEqual([]);
  });
});

describe('hasCapability', () => {
  it('is true only when the effective set contains it', () => {
    expect(hasCapability(['webmaster'], [], 'users:manage')).toBe(true);
    expect(hasCapability(['admin'], [], 'users:manage')).toBe(true); // all-on default
    expect(hasCapability(['admin'], ['audit:view'], 'users:manage')).toBe(false);
    expect(hasCapability(['admin'], ['audit:view'], 'audit:view')).toBe(true);
    expect(hasCapability(['user'], [], 'apps:control')).toBe(false);
  });
});

// plan.md §873 item 1. `admin` holds users:manage by default, so without this
// an admin promoted a second account to webmaster, reset its password and
// signed in as it — or just reset the sitting webmaster's password.
describe('webmasterOnlyReason', () => {
  it('lets a webmaster do anything', () => {
    expect(webmasterOnlyReason(['webmaster'], ['webmaster'])).toBeNull();
    expect(webmasterOnlyReason(['webmaster'], ['admin'], ['webmaster'])).toBeNull();
    expect(webmasterOnlyReason(['webmaster', 'admin'], ['webmaster'], ['user'])).toBeNull();
  });

  it('stops a non-webmaster granting the webmaster role', () => {
    expect(webmasterOnlyReason(['admin'], ['user'], ['webmaster'])).toMatch(/webmaster/i);
    expect(webmasterOnlyReason(['admin'], ['admin'], ['admin', 'webmaster'])).toMatch(/webmaster/i);
  });

  it('stops a non-webmaster touching an account that holds the role', () => {
    // No nextRoles: a password reset or a delete, which changes no roles but
    // is just as much a takeover of that account.
    expect(webmasterOnlyReason(['admin'], ['webmaster'])).toMatch(/webmaster/i);
    expect(webmasterOnlyReason(['admin'], ['webmaster'], ['user'])).toMatch(/webmaster/i);
  });

  it('leaves an admin its ordinary accounts', () => {
    expect(webmasterOnlyReason(['admin'], ['user'], ['admin'])).toBeNull();
    expect(webmasterOnlyReason(['admin'], ['admin'], ['user'])).toBeNull();
    expect(webmasterOnlyReason(['admin'], ['user'])).toBeNull();
    expect(webmasterOnlyReason(['admin'], [])).toBeNull();
  });
});
