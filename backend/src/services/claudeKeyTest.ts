/**
 * Validity check for the stored Anthropic API key.
 *
 * Written against raw `https` rather than pulling in `@anthropic-ai/sdk` for
 * one call — the whole job is "does this key authenticate", which a bare
 * `GET /v1/models` answers with a 200/401. Same reasoning as
 * `verifyCloudflareToken` and the socket-level mail test. The SDK comes in
 * with the generation feature that actually needs it (plan.md §254 P2).
 *
 * `/v1/models` is used deliberately: it costs no tokens, so testing the key
 * is free.
 */

import https from 'https';

export interface ClaudeKeyTestResult {
  success: boolean;
  message: string;
}

const ANTHROPIC_VERSION = '2023-06-01';

export function testClaudeApiKey(apiKey: string): Promise<ClaudeKeyTestResult> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      'https://api.anthropic.com/v1/models?limit=1',
      {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          const status = response.statusCode ?? 500;
          if (status >= 200 && status < 300) {
            resolve({ success: true, message: 'Anthropic API key verified.' });
            return;
          }

          let detail = `Anthropic API returned HTTP ${status}.`;
          try {
            const parsed = JSON.parse(body);
            if (parsed?.error?.message) detail = parsed.error.message;
          } catch {
            // Non-JSON body — keep the status-code message.
          }
          resolve({
            success: false,
            message: status === 401 ? `Key rejected: ${detail}` : detail,
          });
        });
      }
    );

    request.on('error', (error) => reject(error));
    request.setTimeout(10000, () => request.destroy(new Error('Anthropic API verification timed out.')));
    request.end();
  });
}
