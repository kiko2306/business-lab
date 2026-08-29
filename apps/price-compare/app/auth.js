/*
 * Standalone Google Sign-In — no Authelia, no other dependency. Each Google
 * account that ever completes the OAuth flow becomes its own user
 * automatically (no separate invite/registration step); server.js scopes
 * every product to req.user.sub.
 *
 * Sessions are an in-memory Map, not a DB table or JWT — restarting the
 * container logs everyone out. Acceptable trade-off for a personal tool;
 * revisit (persist sessions to /data) if that becomes annoying.
 *
 * The id_token returned by exchangeCode() is decoded without verifying its
 * signature — safe here specifically because it was fetched server-to-server
 * from Google's token endpoint using our client_secret, not received from
 * the browser, so there's nothing for a client to have forged.
 */

const crypto = require('crypto');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function isConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && REDIRECT_URI);
}

// CSRF protection for the OAuth redirect — short-lived, checked once.
const pendingStates = new Map(); // state -> expiresAt
function buildAuthUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 5 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function consumeState(state) {
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(state && expiresAt && expiresAt > Date.now());
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  const { id_token } = await res.json();
  if (!id_token) throw new Error('no id_token in Google response');
  const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8'));
  return { sub: payload.sub, email: payload.email, name: payload.name || payload.email, picture: payload.picture || null };
}

// --- Sessions ---
const SESSION_COOKIE = 'pc_session';
const sessions = new Map(); // token -> user

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user);
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function currentUser(req) {
  const token = getCookie(req, SESSION_COOKIE);
  return token ? sessions.get(token) || null : null;
}

function setSessionCookie(req, res, token) {
  const secure = req.protocol === 'https';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'sessão não iniciada' });
  req.user = user;
  next();
}

module.exports = {
  isConfigured,
  buildAuthUrl,
  consumeState,
  exchangeCode,
  createSession,
  destroySession,
  currentUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
};
