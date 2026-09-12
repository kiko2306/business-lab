import { describe, expect, it } from 'vitest';
import { looksGenerated, parseToken } from './ntfyAuthBootstrap';

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

// §429: ntfy's .env ended up holding an 11-char value with no digit, so the
// credential no longer matched ntfy's auth db and the phone app got 401 with
// nothing on the server side noticing.
describe('looksGenerated', () => {
  it('accepts what generateComplexPassword actually produces', () => {
    // 24 chars, mixed case, a digit and a safe special.
    expect(looksGenerated('aB3!cdefghijkmnpqrstuvwx')).toBe(true);
    expect(looksGenerated('Zz9=aaaaaaaaaaaaaaaaaaaa')).toBe(true);
  });

  it('rejects the value that actually broke it, and anything else foreign', () => {
    expect(looksGenerated('abc@Defghij')).toBe(false); // 11 chars, no digit
    expect(looksGenerated('')).toBe(false);
    expect(looksGenerated('aB3!cdefghijkmnpqrstuvw')).toBe(false); // 23 chars
    expect(looksGenerated('aBcdefghijkmnpqrstuvwxyz')).toBe(false); // no digit, no special
    expect(looksGenerated('aB3cdefghijkmnpqrstuvwxy')).toBe(false); // no special
  });
});
