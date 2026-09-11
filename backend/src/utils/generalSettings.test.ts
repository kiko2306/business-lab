import { describe, expect, it } from 'vitest';
import { isValidBranchName } from './generalSettings';

describe('isValidBranchName', () => {
  it('accepts plain branch names', () => {
    expect(isValidBranchName('main')).toBe(true);
    expect(isValidBranchName('beta')).toBe(true);
    expect(isValidBranchName('feature/netbird-vpn')).toBe(true);
    expect(isValidBranchName('release-1.2.3')).toBe(true);
  });

  it('rejects empty, non-string and path-traversal-shaped values', () => {
    expect(isValidBranchName('')).toBe(false);
    expect(isValidBranchName('   ')).toBe(false);
    expect(isValidBranchName(undefined)).toBe(false);
    expect(isValidBranchName(123)).toBe(false);
    expect(isValidBranchName('../../etc/passwd')).toBe(false);
  });

  it('rejects shell metacharacters — this gets interpolated into a git argv', () => {
    expect(isValidBranchName('main; rm -rf /')).toBe(false);
    expect(isValidBranchName('main`whoami`')).toBe(false);
    expect(isValidBranchName('main && echo pwned')).toBe(false);
  });
});
