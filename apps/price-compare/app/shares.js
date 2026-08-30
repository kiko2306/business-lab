/*
 * Sharing grants — lets one account (the "owner") give another account
 * full read/write access to its products + shopping list. Same flat-JSON
 * file pattern as users.js: /data/shares.json holds an array of grant
 * rows. A grant is created as a `pending` invite addressed to an email
 * (the invitee may not have an account yet); the invitee accepts or
 * declines inside the app. Only an `accepted` row confers access.
 *
 * Nothing here touches products.json / shopping-list.json — server.js
 * resolves the "active workspace" per request and its handlers still do
 * all the actual data reads/writes, now against the resolved owner id
 * instead of always req.user.sub.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/data';
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');

const ACTIVEISH = new Set(['pending', 'accepted']); // an invite that still "occupies" the owner→email slot

function normaliseEmail(s) {
  return String(s || '').trim().toLowerCase();
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normaliseEmail(s));
}

function loadAll() {
  if (!fs.existsSync(SHARES_FILE)) return [];
  try {
    const raw = fs.readFileSync(SHARES_FILE, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read shares.json, starting empty:', err.message);
    return [];
  }
}

function saveAll(rows) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SHARES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, SHARES_FILE);
}

// Every grant this user issued (any status), newest first.
function listForOwner(ownerUserId) {
  return loadAll()
    .filter((r) => r.ownerUserId === ownerUserId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// Grants addressed to this user — matched by bound userId, or by email
// for an invite sent before they ever logged in.
function listForInvitee({ userId, email }) {
  const e = normaliseEmail(email);
  return loadAll()
    .filter((r) => r.inviteeUserId === userId || (r.inviteeUserId == null && r.inviteeEmail === e))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// owner: { sub, email, name }. Throws (message is user-safe Portuguese)
// on a self-invite or a duplicate still-live invite to the same address.
function createInvite({ owner, inviteeEmail }) {
  const email = normaliseEmail(inviteeEmail);
  if (!isValidEmail(email)) throw new Error('email inválido');
  if (email === normaliseEmail(owner.email)) throw new Error('não pode partilhar consigo próprio');

  const rows = loadAll();
  const dup = rows.find(
    (r) => r.ownerUserId === owner.sub && r.inviteeEmail === email && ACTIVEISH.has(r.status)
  );
  if (dup) {
    throw new Error(
      dup.status === 'accepted' ? 'já partilha com este email' : 'já existe um convite pendente para este email'
    );
  }

  const row = {
    id: crypto.randomUUID(),
    ownerUserId: owner.sub,
    ownerEmail: normaliseEmail(owner.email),
    ownerName: owner.name || owner.email || null,
    inviteeEmail: email,
    inviteeUserId: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    respondedAt: null,
  };
  rows.push(row);
  saveAll(rows);
  return row;
}

// invitee: { sub, email }. action: 'accept' | 'decline'.
function respond(id, invitee, action) {
  const rows = loadAll();
  const row = rows.find((r) => r.id === id);
  // Guard by identity so one user can't act on another's invite, and
  // don't distinguish "not found" from "not yours" in the message.
  const mine =
    row &&
    (row.inviteeUserId === invitee.sub ||
      (row.inviteeUserId == null && row.inviteeEmail === normaliseEmail(invitee.email)));
  if (!row || !mine) throw new Error('convite não encontrado');
  if (row.status !== 'pending') throw new Error('este convite já foi respondido');

  row.status = action === 'accept' ? 'accepted' : 'declined';
  if (action === 'accept') row.inviteeUserId = invitee.sub;
  row.respondedAt = new Date().toISOString();
  saveAll(rows);
  return row;
}

// Either party can tear a grant down: the owner revokes, the invitee
// leaves. Kept as a status change (not a delete) so the row stays
// auditable; access checks only ever look at status === 'accepted'.
function remove(id, byUserId) {
  const rows = loadAll();
  const row = rows.find((r) => r.id === id);
  if (!row || (byUserId !== row.ownerUserId && byUserId !== row.inviteeUserId)) {
    throw new Error('partilha não encontrada');
  }
  row.status = 'revoked';
  row.respondedAt = row.respondedAt || new Date().toISOString();
  saveAll(rows);
  return row;
}

// The authorization primitive: may `viewerUserId` act on `ownerUserId`'s data?
function isSharedWith(ownerUserId, viewerUserId) {
  return loadAll().some(
    (r) => r.status === 'accepted' && r.ownerUserId === ownerUserId && r.inviteeUserId === viewerUserId
  );
}

// Is this workspace shared with anyone at all? (drives the edit lock —
// the owner is subject to it too once someone else can edit their list)
function isShared(ownerUserId) {
  return loadAll().some((r) => r.status === 'accepted' && r.ownerUserId === ownerUserId);
}

// The other people's lists this user may switch into.
function accessibleOwners(viewerUserId) {
  return loadAll()
    .filter((r) => r.status === 'accepted' && r.inviteeUserId === viewerUserId)
    .map((r) => ({ ownerUserId: r.ownerUserId, ownerEmail: r.ownerEmail, ownerName: r.ownerName }));
}

// Called on every login: attach the now-known userId to any invite that
// was addressed to this email before the person had an account.
function bindPendingInvites(user) {
  const e = normaliseEmail(user.email);
  const rows = loadAll();
  let changed = false;
  for (const r of rows) {
    if (r.inviteeUserId == null && r.inviteeEmail === e && ACTIVEISH.has(r.status)) {
      r.inviteeUserId = user.sub;
      changed = true;
    }
  }
  if (changed) saveAll(rows);
}

module.exports = {
  normaliseEmail,
  isValidEmail,
  listForOwner,
  listForInvitee,
  createInvite,
  respond,
  remove,
  isSharedWith,
  isShared,
  accessibleOwners,
  bindPendingInvites,
};
