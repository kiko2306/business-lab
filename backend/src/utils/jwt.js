'use strict';

const jwt = require('jsonwebtoken');

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '1h';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

function getAccessSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

function getRefreshSecret() {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

/**
 * Sign an access token for the given user payload.
 * @param {{ id: number, username: string, role: string }} payload
 * @returns {string}
 */
function signAccessToken(payload) {
  return jwt.sign(payload, getAccessSecret(), { expiresIn: ACCESS_EXPIRES });
}

/**
 * Sign a refresh token for the given user id.
 * @param {{ id: number }} payload
 * @returns {string}
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: REFRESH_EXPIRES });
}

/**
 * Verify and decode an access token.
 * Throws if invalid or expired.
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyAccessToken(token) {
  return jwt.verify(token, getAccessSecret());
}

/**
 * Verify and decode a refresh token.
 * Throws if invalid or expired.
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, getRefreshSecret());
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
