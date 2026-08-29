/*
 * Per-user account metadata — VIP/paid status (both exempt a user from
 * ads, tracked separately so VIP grants and real purchases can be told
 * apart later) plus a cached profile (email/name) so the admin dashboard
 * has something human-readable to show without needing an active session
 * for every user. Same flat-JSON-file pattern as products.json/
 * push-subscriptions.json — small dataset, no real database needed.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function loadAll() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '{}');
  } catch (err) {
    console.error('Failed to read users.json, starting empty:', err.message);
    return {};
  }
}

function saveAll(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

// Called on every login — keeps email/name fresh for the admin dashboard
// without touching isVip/isPaid, which are only ever set by an admin (or,
// once real payment processing exists, by a purchase webhook).
function upsertProfile(user) {
  const all = loadAll();
  const existing = all[user.sub] || { isVip: false, isPaid: false };
  all[user.sub] = { ...existing, email: user.email, name: user.name || user.email, lastLoginAt: new Date().toISOString() };
  saveAll(all);
}

function getUser(userId) {
  return loadAll()[userId] || null;
}

function listUsers() {
  const all = loadAll();
  return Object.entries(all).map(([userId, u]) => ({ userId, ...u }));
}

// VIP or paid both remove ads — tracked as separate booleans so it's
// still possible to see later which users were comped vs. actually paid.
function adsEnabledFor(userId) {
  const u = getUser(userId);
  if (!u) return true;
  return !u.isVip && !u.isPaid;
}

function setFlag(userId, flag, value) {
  const all = loadAll();
  if (!all[userId]) return false;
  all[userId][flag] = Boolean(value);
  saveAll(all);
  return true;
}

module.exports = {
  upsertProfile,
  getUser,
  listUsers,
  adsEnabledFor,
  setVip: (userId, value) => setFlag(userId, 'isVip', value),
  setPaid: (userId, value) => setFlag(userId, 'isPaid', value),
};
