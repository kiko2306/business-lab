/*
 * users.js — per-user metadata store. Pure logic + a temp DATA_DIR for
 * the file it reads/writes; no server, no network.
 *
 *   npm test   (from apps/price-compare/app)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fresh module bound to a throwaway /data for each test.
function freshUsers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'users-test-'));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve('../users')];
  return { users: require('../users'), dir };
}

test('findByEmail matches case-insensitively and returns the userId', () => {
  const { users } = freshUsers();
  users.upsertProfile({ sub: 'sub-1', email: 'Reporter@Example.com', name: 'A Reporter' });

  const hit = users.findByEmail('reporter@example.com');
  assert.equal(hit?.userId, 'sub-1');
  assert.equal(users.findByEmail('REPORTER@EXAMPLE.COM')?.userId, 'sub-1');
});

test('findByEmail returns null for unknown / empty input', () => {
  const { users } = freshUsers();
  users.upsertProfile({ sub: 'sub-1', email: 'a@b.co', name: 'A' });

  assert.equal(users.findByEmail('nobody@example.com'), null);
  assert.equal(users.findByEmail(''), null);
  assert.equal(users.findByEmail(null), null);
  assert.equal(users.findByEmail(undefined), null);
});
