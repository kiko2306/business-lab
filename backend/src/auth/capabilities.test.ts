import { describe, it, expect } from 'vitest';
import { CAPABILITIES, capabilitiesFor, roleHasCapability } from './capabilities';

describe('capabilitiesFor', () => {
  it('gives owner every capability', () => {
    expect(capabilitiesFor(['owner']).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('gives user nothing', () => {
    expect(capabilitiesFor(['user'])).toEqual([]);
  });

  it('scopes it_admin to the app stack, not exposure settings or user management', () => {
    const caps = capabilitiesFor(['it_admin']);
    expect(caps).toContain('apps:control');
    expect(caps).toContain('settings:manage');
    expect(caps).toContain('backups:manage');
    expect(caps).not.toContain('exposure:settings');
    expect(caps).not.toContain('users:manage');
  });

  it('scopes webmaster to exposure settings only', () => {
    expect(capabilitiesFor(['webmaster'])).toEqual(['exposure:settings']);
  });

  it('unions the capabilities of several roles', () => {
    const caps = capabilitiesFor(['webmaster', 'it_admin']);
    expect(caps).toContain('exposure:settings'); // from webmaster
    expect(caps).toContain('apps:control'); // from it_admin
    expect(caps).not.toContain('users:manage'); // neither grants it
  });

  it('deduplicates and ignores unknown role names', () => {
    expect(capabilitiesFor(['it_admin', 'it_admin', 'nonsense'])).toEqual(capabilitiesFor(['it_admin']));
  });

  it('returns capabilities in the canonical order regardless of role order', () => {
    expect(capabilitiesFor(['it_admin', 'webmaster'])).toEqual(capabilitiesFor(['webmaster', 'it_admin']));
  });
});

describe('roleHasCapability', () => {
  it('is true only when a held role grants it', () => {
    expect(roleHasCapability(['webmaster'], 'exposure:settings')).toBe(true);
    expect(roleHasCapability(['webmaster'], 'apps:control')).toBe(false);
    expect(roleHasCapability(['user'], 'apps:control')).toBe(false);
    expect(roleHasCapability(['owner'], 'users:manage')).toBe(true);
  });
});
