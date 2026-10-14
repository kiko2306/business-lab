import { HttpErrorResponse } from '@angular/common/http';
import { extractErrorMessage } from './api';

// The backend's rate limiters answer in English (plan.md §933); seen in pt-PT
// under the 2FA field as "Too many requests, please try again later".
describe('extractErrorMessage on a 429', () => {
  const rateLimited = new HttpErrorResponse({
    status: 429,
    error: { error: 'Too many requests, please try again later' },
  });

  afterEach(() => (document.documentElement.lang = 'en'));

  it('answers in the page language, not the limiter\'s English', () => {
    document.documentElement.lang = 'pt-PT';
    const message = extractErrorMessage(rateLimited);
    expect(message).not.toContain('Too many requests');
    expect(message).toContain('pedidos');
  });

  it('reads in English on an English page', () => {
    document.documentElement.lang = 'en';
    expect(extractErrorMessage(rateLimited)).toContain('Too many requests');
  });
});
