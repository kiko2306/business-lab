'use strict';

const jwt = require('jsonwebtoken');

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '1h';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

/** Parse a duration string like "7d", "1h", "30m" into milliseconds. */
function parseDurationMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * multipliers[unit];
}

/** Milliseconds until the refresh token expires. */
function refreshTokenExpiryMs() {
  return parseDurationMs(REFRESH_EXPIRES);
}

function getAccessSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

function getRefreshSecret() {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET (or fallback JWT_SECRET) environment variable is not set');
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

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, refreshTokenExpiryMs };
