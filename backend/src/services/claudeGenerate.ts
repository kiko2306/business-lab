/**
 * Generate a social-media post from a prompt, using the Claude API key stored
 * in Settings (plan.md §84.3 / §254 P2). This is the half §84.3 said was
 * "worth building here, and it is small".
 *
 * The publish path (P3) and the schedule glue (P4) are separate — this only
 * turns a prompt into text.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getClaudeApiKey } from '../utils/claudeSettings';

// Opus 5 is the current default per Anthropic guidance; callers don't choose.
const MODEL = 'claude-opus-5';

const SYSTEM_PROMPT =
  'You write social media posts. Given the user\'s brief, return exactly one ' +
  'post as plain text — no preamble, no sign-off, no numbered options, no ' +
  'surrounding quotes, and no commentary about the post. Include hashtags or ' +
  'emoji only if the brief asks for them.';

export class ClaudeKeyMissingError extends Error {
  constructor() {
    super('No Claude API key is configured — add one in Settings first.');
    this.name = 'ClaudeKeyMissingError';
  }
}

export async function generateSocialPost(prompt: string): Promise<string> {
  const apiKey = await getClaudeApiKey();
  if (!apiKey) {
    throw new ClaudeKeyMissingError();
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) {
    throw new Error('Claude returned an empty response.');
  }
  return text;
}
