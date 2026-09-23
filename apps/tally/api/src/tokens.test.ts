import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAgentToken, generateEnrolmentCode, hash, normaliseCode } from './tokens';

test('enrolment codes avoid characters that get misread aloud', () => {
  const codes = Array.from({ length: 200 }, generateEnrolmentCode);
  for (const code of codes) {
    assert.equal(code.length, 8);
    // O/0, I/1/L, U/V are the pairs someone reading a code down the phone
    // confuses; none may appear.
    assert.doesNotMatch(code, /[O0I1LUV]/, `${code} contains an ambiguous character`);
  }
  // Rejection sampling, not modulo — so no character should be markedly more
  // common. With 1600 draws over 29 symbols the expected count is ~55; a
  // modulo bias would push the low end of the alphabet well above the rest.
  const counts = new Map<string, number>();
  for (const ch of codes.join('')) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const min = Math.min(...counts.values());
  assert.ok(max < min * 3, `distribution looks biased: min ${min}, max ${max}`);
});

test('codes and tokens do not repeat', () => {
  assert.equal(new Set(Array.from({ length: 500 }, generateEnrolmentCode)).size, 500);
  assert.equal(new Set(Array.from({ length: 500 }, generateAgentToken)).size, 500);
});

test('agent tokens carry real entropy and are URL-safe', () => {
  const token = generateAgentToken();
  // 32 random bytes as base64url — no +, / or = to escape in a header.
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test('hashing is stable, and the hash is not the value', () => {
  assert.equal(hash('abc'), hash('abc'));
  assert.notEqual(hash('abc'), hash('abd'));
  assert.ok(!hash('abc').includes('abc'));
});

test('typed codes are accepted however they arrive', () => {
  assert.equal(normaliseCode(' ab-cd ef '), 'ABCDEF');
});
