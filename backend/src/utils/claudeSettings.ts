/**
 * The Anthropic (Claude) API key, entered once in Settings — the same
 * third-party-token pattern as the Cloudflare and Tailscale credentials,
 * which §0.3 explicitly allows for something the system cannot derive.
 *
 * Consumed by the content-generation feature (plan.md §84.3 / §254) and
 * Mealie's AI recipe parsing (§238). Stored in `settings` so it sits next to
 * the Cloudflare token and the mail credentials.
 */

import { query } from './database';

export const CLAUDE_API_KEY_SETTING = 'claude_api_key';

/** The stored key, or `null` if it has never been set. */
export async function getClaudeApiKey(): Promise<string | null> {
  const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [CLAUDE_API_KEY_SETTING]);
  return result.rows[0]?.value?.trim() || null;
}

/** First/last few characters only — enough to tell which key is stored. */
export function maskClaudeKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
