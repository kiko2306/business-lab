import { describe, expect, it } from 'vitest';
import { ranButRejected } from './autheliaValidate';

// The two outcomes lead to opposite decisions: a rejection blocks the write,
// an inability to run does not (see rejectsAutheliaConfig).
describe('ranButRejected', () => {
  it('is true when the validator ran and exited non-zero', () => {
    expect(ranButRejected({ code: 1 })).toBe(true);
    expect(ranButRejected({ code: 2 })).toBe(true);
  });

  it('is false when it could not run at all', () => {
    expect(ranButRejected({ code: 'ENOENT' })).toBe(false);
    expect(ranButRejected({ code: 'ETIMEDOUT' })).toBe(false);
    expect(ranButRejected({})).toBe(false);
  });

  it('is false for a timeout kill, which is not a verdict on the config', () => {
    expect(ranButRejected({ code: 1, killed: true })).toBe(false);
    expect(ranButRejected({ killed: true })).toBe(false);
  });

  it('is false on success', () => {
    expect(ranButRejected({ code: 0 })).toBe(false);
  });
});
