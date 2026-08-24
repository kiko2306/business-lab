'use strict';

const https = require('https');
const { Router } = require('express');
const { query } = require('../utils/database');

const router = Router();

const CLOUDFLARE_TOKEN_KEY = 'cloudflare_tunnel_token';
const PERMISSION_EXPLANATION =
  'Required permissions: Account → Cloudflare Tunnel → Edit, Zone → DNS → Edit.';

function maskToken(token) {
  if (!token) {
    return null;
  }

  if (token.length <= 8) {
    return '••••••••';
  }

  return `${token.slice(0, 4)}••••••${token.slice(-4)}`;
}

function isValidToken(token) {
  return typeof token === 'string' && token.trim().length >= 20;
}

async function getStoredToken() {
  const result = await query('SELECT value FROM settings WHERE key = $1', [CLOUDFLARE_TOKEN_KEY]);
  return result.rows[0]?.value ?? null;
}

function verifyCloudflareToken(token) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
      (response) => {
        let body = '';

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const statusCode = response.statusCode ?? 500;
            if (statusCode >= 200 && statusCode < 300 && parsed.success) {
              resolve({ success: true, message: 'Cloudflare token verified successfully.' });
              return;
            }

            const errorMessage =
              parsed?.errors?.[0]?.message || 'Cloudflare rejected the supplied token.';
            resolve({ success: false, message: errorMessage });
          } catch {
            reject(new Error('Unable to parse Cloudflare verification response.'));
          }
        });
      }
    );

    request.on('error', (error) => reject(error));
    request.setTimeout(10000, () => request.destroy(new Error('Cloudflare verification timed out.')));
    request.end();
  });
}

router.get('/cloudflare-token', async (_req, res) => {
  try {
    const token = await getStoredToken();
    return res.json({
      configured: Boolean(token),
      tokenMasked: maskToken(token),
      permissionExplanation: PERMISSION_EXPLANATION,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load Cloudflare settings.' });
  }
});

router.put('/cloudflare-token', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

  if (!isValidToken(token)) {
    return res.status(400).json({ error: 'Cloudflare token must be at least 20 characters.' });
  }

  try {
    await query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [CLOUDFLARE_TOKEN_KEY, token]
    );

    return res.json({
      configured: true,
      tokenMasked: maskToken(token),
      permissionExplanation: PERMISSION_EXPLANATION,
      message: 'Cloudflare token saved successfully.',
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to save Cloudflare token.' });
  }
});

router.post('/cloudflare-token/test', async (req, res) => {
  try {
    const providedToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const token = providedToken || (await getStoredToken());

    if (!isValidToken(token)) {
      return res.status(400).json({ error: 'No valid Cloudflare token is available to test.' });
    }

    const result = await verifyCloudflareToken(token);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    return res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    return res.status(502).json({ error: 'Unable to reach Cloudflare to verify the token.' });
  }
});

module.exports = router;
