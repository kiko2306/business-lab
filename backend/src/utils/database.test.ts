import { describe, expect, it } from 'vitest';
import { uniqueViolation, USERS_EMAIL_UNIQUE_INDEX } from './database';

// plan.md §879 item 3. `POST /users` mapped every 23505 to "Username already
// exists", so once `users.email` had a unique index of its own, a duplicate
// address would have been reported as a duplicate username. The constraint name
// is what tells them apart.
describe('uniqueViolation', () => {
  const violation = (constraint: string) => ({ code: '23505', constraint });

  it('names which column a unique violation was about', () => {
    expect(uniqueViolation(violation('users_username_key'))).toBe('username');
    expect(uniqueViolation(violation(USERS_EMAIL_UNIQUE_INDEX))).toBe('email');
  });

  it('is null for anything that is not a unique violation', () => {
    expect(uniqueViolation({ code: '23503', constraint: 'users_username_key' })).toBeNull();
    expect(uniqueViolation({ code: '42P01' })).toBeNull();
    expect(uniqueViolation(new Error('connection refused'))).toBeNull();
    expect(uniqueViolation(undefined)).toBeNull();
    expect(uniqueViolation(null)).toBeNull();
  });

  it('is null for a unique violation on some other constraint', () => {
    // A caller that cannot say which column it was must not guess — the route
    // falls through to its generic 500 rather than blaming the wrong field.
    expect(uniqueViolation(violation('refresh_tokens_token_key'))).toBeNull();
  });
});
