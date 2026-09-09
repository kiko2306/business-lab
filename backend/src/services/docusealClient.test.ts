import { describe, expect, it } from 'vitest';
import { cookieHeader, extractAuthenticityToken } from './docusealClient';

describe('extractAuthenticityToken', () => {
  it('reads the Rails csrf-token meta tag', () => {
    const html = '<head><meta name="csrf-token" content="abc123==" /></head>';
    expect(extractAuthenticityToken(html)).toBe('abc123==');
  });

  it('falls back to the hidden form input', () => {
    const html = '<form><input type="hidden" name="authenticity_token" value="tok-from-input" /></form>';
    expect(extractAuthenticityToken(html)).toBe('tok-from-input');
  });

  it('returns null when neither is present', () => {
    expect(extractAuthenticityToken('<html><body>no token here</body></html>')).toBeNull();
  });
});

describe('cookieHeader', () => {
  it('keeps only the name=value pair of each Set-Cookie, dropping attributes', () => {
    const setCookies = [
      '_docuseal_session=xyz; path=/; HttpOnly; SameSite=Lax',
      'other=1; Secure',
    ];
    expect(cookieHeader(setCookies)).toBe('_docuseal_session=xyz; other=1');
  });

  it('is empty for no cookies', () => {
    expect(cookieHeader([])).toBe('');
  });
});
