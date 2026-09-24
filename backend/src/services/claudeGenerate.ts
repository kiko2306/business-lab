/**
 * Generate a social-media post from a prompt, using whichever AI provider is
 * configured for the "social_generate" feature in Settings > AI API Keys
 * (plan.md §84.3 / §254 P2, generalized to multi-provider in §610).
 *
 * The publish path (P3) and the schedule glue (P4) are separate — this only
 * turns a prompt into text.
 */

import { callOpenAiCompatChat } from './aiChatCompletion';
import { getActiveProviderKey, getProviderDefinition } from '../utils/aiSettings';

const SYSTEM_PROMPT =
  'You write social media posts. Given the user\'s brief, return exactly one ' +
  'post as plain text — no preamble, no sign-off, no numbered options, no ' +
  'surrounding quotes, and no commentary about the post. Include hashtags or ' +
  'emoji only if the brief asks for them.';

const MAX_TOKENS = 2000;

export class AiKeyMissingError extends Error {
  constructor() {
    super('No AI provider key is configured for post generation — add one in Settings first.');
    this.name = 'AiKeyMissingError';
  }
}

export async function generateSocialPost(prompt: string): Promise<string> {
  const active = await getActiveProviderKey('social_generate');
  if (!active) {
    throw new AiKeyMissingError();
  }

  const definition = getProviderDefinition(active.provider);
  return callOpenAiCompatChat({
    baseUrl: definition.openAiCompatBaseUrl,
    apiKey: active.key,
    model: definition.generateModel,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: prompt,
    maxTokens: MAX_TOKENS,
  });
}
