import { describe, expect, it } from 'vitest';
import { parseToken } from './ntfyAuthBootstrap';

describe('parseToken', () => {
  // The shape ntfy's CLI actually prints.
  it('picks the token out of ntfy token add output', () => {
    expect(parseToken('token tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2 for user subscriber, never expires\n')).toBe(
      'tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2'
    );
  });

  it('finds it among surrounding noise on stderr', () => {
    expect(parseToken('warning: cache file not found\ntoken tk_abcdefghij1234567890 for user x\n')).toBe(
      'tk_abcdefghij1234567890'
    );
  });

  // Storing a wrong substring gives a token that silently never
  // authenticates, so anything unrecognised must be reported as nothing.
  it('returns null rather than a guess', () => {
    expect(parseToken('')).toBeNull();
    expect(parseToken('error: user subscriber does not exist')).toBeNull();
    expect(parseToken('tk_short')).toBeNull();
    expect(parseToken('ntfy_AgQdq7mVBoFD37zQVN29')).toBeNull();
  });
});
