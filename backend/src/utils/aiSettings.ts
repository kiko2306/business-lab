/**
 * AI provider API keys, entered once per provider in Settings — the same
 * third-party-token pattern as the Cloudflare and mail credentials (§0.3
 * explicitly allows this for something the system cannot derive).
 *
 * Generalizes the old single Anthropic-only "Claude API key" (plan.md §610)
 * into a small provider registry, so free-tier alternatives (Google Gemini,
 * Groq) can sit alongside Anthropic without a redesign — another provider is
 * a registry entry here, not a rewrite. Every provider publishes an
 * OpenAI-compatible chat-completions endpoint, which is what makes one
 * shared call path (aiChatCompletion.ts) possible instead of one SDK per
 * provider.
 *
 * Each AI-backed feature (social-post generation, Mealie's AI recipe
 * parser) picks its own *one* active provider here — no per-request
 * provider picker (confirmed with the user before building, plan.md §610).
 */

import { query } from './database';

export type AiProviderId = 'anthropic' | 'google' | 'groq';

export interface AiProviderDefinition {
  id: AiProviderId;
  label: string;
  /** OpenAI-compatible chat-completions base URL, trailing slash. */
  openAiCompatBaseUrl: string;
  /** Post-generation wants a stronger model. */
  generateModel: string;
  /** Recipe parsing is plain extraction — the cheaper/faster model is plenty. */
  parseModel: string;
}

export const AI_PROVIDERS: AiProviderDefinition[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    openAiCompatBaseUrl: 'https://api.anthropic.com/v1/',
    generateModel: 'claude-opus-5',
    parseModel: 'claude-haiku-4-5',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    openAiCompatBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    generateModel: 'gemini-2.5-pro',
    parseModel: 'gemini-2.5-flash',
  },
  {
    id: 'groq',
    label: 'Groq',
    openAiCompatBaseUrl: 'https://api.groq.com/openai/v1/',
    generateModel: 'llama-3.3-70b-versatile',
    parseModel: 'llama-3.1-8b-instant',
  },
];

export const AI_PROVIDER_IDS: AiProviderId[] = AI_PROVIDERS.map((p) => p.id);

export function isValidProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && AI_PROVIDER_IDS.includes(value as AiProviderId);
}

export function getProviderDefinition(id: AiProviderId): AiProviderDefinition {
  const found = AI_PROVIDERS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown AI provider: ${id}`);
  }
  return found;
}

function keySettingKey(provider: AiProviderId): string {
  return `ai_api_key_${provider}`;
}

// The pre-registry setting name — read once by ensureAiApiKeyMigration below,
// never written to again.
const LEGACY_ANTHROPIC_KEY_SETTING = 'claude_api_key';

/** The stored key for one provider, or `null` if it has never been set. */
export async function getAiApiKey(provider: AiProviderId): Promise<string | null> {
  const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [keySettingKey(provider)]);
  return result.rows[0]?.value?.trim() || null;
}

export async function setAiApiKey(provider: AiProviderId, key: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [keySettingKey(provider), key]
  );
}

/** First/last few characters only — enough to tell which key is stored. */
export function maskAiApiKey(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/**
 * One-time backfill: a `claude_api_key` row from before this provider
 * registry existed becomes `ai_api_key_anthropic`, so an operator's
 * already-saved key isn't silently dropped. No-op once that row exists —
 * true for a fresh install and for any deployment already migrated. Same
 * shape as alertNotify.ts's ensureAlertCategoryTopics (§609).
 */
export async function ensureAiApiKeyMigration(): Promise<void> {
  const alreadyMigrated = await getAiApiKey('anthropic');
  if (alreadyMigrated) return;
  const legacy = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [LEGACY_ANTHROPIC_KEY_SETTING]);
  const legacyKey = legacy.rows[0]?.value?.trim();
  if (legacyKey) {
    await setAiApiKey('anthropic', legacyKey);
  }
}

// ---------------------------------------------------------------------------
// Which provider powers each AI-backed feature.
// ---------------------------------------------------------------------------

export type AiFeature = 'social_generate' | 'mealie_parse';

export const AI_FEATURES: AiFeature[] = ['social_generate', 'mealie_parse'];

function featureProviderSettingKey(feature: AiFeature): string {
  return `ai_provider_${feature}`;
}

/** Falls back to `anthropic` when unset or the stored value is stale. */
export async function getFeatureProvider(feature: AiFeature): Promise<AiProviderId> {
  const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [
    featureProviderSettingKey(feature),
  ]);
  const stored = result.rows[0]?.value;
  return isValidProviderId(stored) ? stored : 'anthropic';
}

export async function setFeatureProvider(feature: AiFeature, provider: AiProviderId): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [featureProviderSettingKey(feature), provider]
  );
}

/** The feature's active provider and its key, or `null` if that provider has no key stored. */
export async function getActiveProviderKey(feature: AiFeature): Promise<{ provider: AiProviderId; key: string } | null> {
  const provider = await getFeatureProvider(feature);
  const key = await getAiApiKey(provider);
  return key ? { provider, key } : null;
}
