/*
 * shares.js — the sharing-grant store. Pure logic + a temp DATA_DIR for
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
function freshShares() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shares-test-'));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve('../shares')];
  return { shares: require('../shares'), dir };
}

const OWNER = { sub: 'owner-1', email: 'Owner@Example.com', name: 'Owner One' };
const INVITEE = { sub: 'invitee-9', email: 'friend@example.com', name: 'A Friend' };

test('normaliseEmail / isValidEmail', () => {
  const { shares } = freshShares();
  assert.equal(shares.normaliseEmail('  Foo@BAR.com '), 'foo@bar.com');
  assert.ok(shares.isValidEmail('a@b.co'));
  assert.ok(!shares.isValidEmail('nope'));
  assert.ok(!shares.isValidEmail('a@b'));
  assert.ok(!shares.isValidEmail(''));
});

test('createInvite writes a pending row and rejects self / duplicates', () => {
  const { shares } = freshShares();
  const row = shares.createInvite({ owner: OWNER, inviteeEmail: '  Friend@Example.com ' });
  assert.equal(row.status, 'pending');
  assert.equal(row.ownerUserId, 'owner-1');
  assert.equal(row.inviteeEmail, 'friend@example.com'); // normalised
  assert.equal(row.inviteeUserId, null);

  assert.throws(() => shares.createInvite({ owner: OWNER, inviteeEmail: 'owner@example.com' }), /consigo próprio/);
  assert.throws(() => shares.createInvite({ owner: OWNER, inviteeEmail: 'friend@example.com' }), /pendente/);
  assert.throws(() => shares.createInvite({ owner: OWNER, inviteeEmail: 'bad' }), /inválido/);
});

test('accept binds the userId and confers access; decline does not', () => {
  const { shares } = freshShares();
  const a = shares.createInvite({ owner: OWNER, inviteeEmail: INVITEE.email });
  assert.equal(shares.isSharedWith('owner-1', 'invitee-9'), false);

  const accepted = shares.respond(a.id, INVITEE, 'accept');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.inviteeUserId, 'invitee-9');
  assert.equal(shares.isSharedWith('owner-1', 'invitee-9'), true);
  assert.equal(shares.isShared('owner-1'), true);
  assert.deepEqual(shares.accessibleOwners('invitee-9'), [
    { ownerUserId: 'owner-1', ownerEmail: 'owner@example.com', ownerName: 'Owner One' },
  ]);

  // second response is refused
  assert.throws(() => shares.respond(a.id, INVITEE, 'decline'), /já foi respondido/);

  const b = shares.createInvite({ owner: { ...OWNER, sub: 'owner-2', email: 'o2@example.com' }, inviteeEmail: INVITEE.email });
  shares.respond(b.id, INVITEE, 'decline');
  assert.equal(shares.isSharedWith('owner-2', 'invitee-9'), false);
});

test('respond rejects someone else acting on the invite', () => {
  const { shares } = freshShares();
  const a = shares.createInvite({ owner: OWNER, inviteeEmail: INVITEE.email });
  assert.throws(() => shares.respond(a.id, { sub: 'stranger', email: 'x@y.zz' }, 'accept'), /não encontrado/);
});

test('remove revokes and cuts access; only a party may do it', () => {
  const { shares } = freshShares();
  const a = shares.createInvite({ owner: OWNER, inviteeEmail: INVITEE.email });
  shares.respond(a.id, INVITEE, 'accept');

  assert.throws(() => shares.remove(a.id, 'stranger'), /não encontrada/);

  shares.remove(a.id, 'invitee-9'); // invitee leaves
  assert.equal(shares.isSharedWith('owner-1', 'invitee-9'), false);
  assert.equal(shares.isShared('owner-1'), false);
});

test('bindPendingInvites attaches the userId on first login by email', () => {
  const { shares } = freshShares();
  shares.createInvite({ owner: OWNER, inviteeEmail: 'late@example.com' });

  // before login: visible by email, not bound
  let forEmail = shares.listForInvitee({ userId: 'late-1', email: 'late@example.com' });
  assert.equal(forEmail.length, 1);
  assert.equal(forEmail[0].inviteeUserId, null);

  shares.bindPendingInvites({ sub: 'late-1', email: 'LATE@example.com' });
  const bound = shares.listForInvitee({ userId: 'late-1', email: 'nomatch@example.com' });
  assert.equal(bound.length, 1);
  assert.equal(bound[0].inviteeUserId, 'late-1');
});

test('listForOwner returns every grant the owner issued', () => {
  const { shares } = freshShares();
  shares.createInvite({ owner: OWNER, inviteeEmail: 'one@example.com' });
  shares.createInvite({ owner: OWNER, inviteeEmail: 'two@example.com' });
  assert.equal(shares.listForOwner('owner-1').length, 2);
  assert.equal(shares.listForOwner('nobody').length, 0);
});
