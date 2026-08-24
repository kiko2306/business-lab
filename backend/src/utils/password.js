'use strict';

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/**
 * Hash a plain-text password.
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plain-text password to a stored hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, verifyPassword };
