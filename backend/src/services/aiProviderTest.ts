/**
 * Validity check for a stored AI provider key — generalizes the old
 * Anthropic-only claudeKeyTest.ts (plan.md §610). Each provider verifies
 * differently (different auth scheme, different free "list models" call),
 * so this dispatches per provider rather than pretending they're uniform;
 * what they share is the request/response plumbing below.
 *
 * Deliberately raw `https`, not each provider's SDK — the whole job is
 * "does this key authenticate," which a bare models-list call answers with
 * a 200/401, at no token cost.
 */

import https from 'https';
import { AiProviderId } from '../utils/aiSettings';

export interface AiKeyTestResult {
  success: boolean;
  message: string;
}

function requestJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'GET', headers }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 500, body }));
    });
    request.on('error', (error) => reject(error));
    request.setTimeout(10000, () => request.destroy(new Error('AI provider verification timed out.')));
    request.end();
  });
}

function errorDetail(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.error?.message === 'string') return parsed.error.message;
    if (typeof parsed?.error === 'string') return parsed.error;
  } catch {
    // Non-JSON body — fall through to the status code.
  }
  return `HTTP ${status}`;
}

const PROVIDER_LABEL: Record<AiProviderId, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  groq: 'Groq',
};

/** The free "list models" call each provider offers, and its auth shape. */
function verifyRequest(provider: AiProviderId, apiKey: string): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models?limit=1',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      };
    case 'google':
      // Gemini takes the key as a query param, not a header.
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        headers: {},
      };
    case 'groq':
      return {
        url: 'https://api.groq.com/openai/v1/models',
        headers: { Authorization: `Bearer ${apiKey}` },
      };
  }
}

export async function testAiProviderKey(provider: AiProviderId, apiKey: string): Promise<AiKeyTestResult> {
  const { url, headers } = verifyRequest(provider, apiKey);
  const { status, body } = await requestJson(url, headers);
  const label = PROVIDER_LABEL[provider];

  if (status >= 200 && status < 300) {
    return { success: true, message: `${label} API key verified.` };
  }

  const detail = errorDetail(body, status);
  return {
    success: false,
    message: status === 401 || status === 403 ? `Key rejected: ${detail}` : detail,
  };
}
