/**
 * Wires Mealie's AI recipe parsing to the dashboard's one Claude API key
 * (§123.1 / §238). When importing a recipe from a URL that `recipe-scrapers`
 * can't read cleanly, Mealie falls back to an OpenAI-compatible model; this
 * points that at Anthropic's OpenAI-compat endpoint with the stored key, so
 * the operator never touches Mealie's own settings (§0.2, §0.3).
 *
 * Shape: autheliaSync.ts — resolve Mealie's cross-project
 * base URL, log in as an admin whose password this process owns, drive the
 * REST API, best-effort (audited + warned, never thrown, never blocks the
 * caller).
 *
 * Two things worth knowing:
 *
 * 1. Mealie has no env-configurable admin. A fresh install always seeds
 *    `changeme@example.com` / `MyPassword` (mealie/core/settings/settings.py
 *    §283 — now a private field, "should no longer be set by end users"). So
 *    this rotates that default to a backend-generated `MEALIE_ADMIN_PASSWORD`
 *    (`hiddenGeneratedSecrets`, services.ts) the first time it logs in, the
 *    same trick as guacamoleAdminRotate.ts.
 *
 * 2. Anthropic's OpenAI-compat layer ignores `response_format`, and Mealie
 *    calls `chat.completions.parse()` with a schema. Claude usually still
 *    returns schema-shaped JSON because Mealie's prompts spell the schema
 *    out, but a messy page can still fail to parse. That's a known ceiling of
 *    the compat endpoint (Anthropic documents it as test-only), acceptable
 *    on this box; the native API isn't OpenAI-shaped and a real shim is a
 *    bigger lift than the feature is worth here.
 *    ponytail: compat endpoint, swap for a native-API shim only if parse
 *    failures actually bite.
 */

import logger from '../utils/logger';
import { writeAuditLog } from '../utils/audit';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getClaudeApiKey } from '../utils/claudeSettings';
import { readAppEnvValue } from './appEnv';
import {
  mealieChangePassword,
  mealieCreateAiProvider,
  mealieDeleteAiProvider,
  mealieGetAiSettings,
  mealieLogin,
  mealieSetAiSettings,
  mealieUpdateAiProvider,
  MealieAiProviderInput,
} from './mealieClient';

export const MEALIE_SERVICE = 'mealie';
export const MEALIE_ADMIN_PASSWORD_KEY = 'MEALIE_ADMIN_PASSWORD';

// The immutable first-run seed account (see file header). We keep the email
// as-is — it's only ever a login identifier for this process, never shown.
const SEED_ADMIN_EMAIL = 'changeme@example.com';
const SEED_ADMIN_PASSWORD = 'MyPassword';

// Name of the provider row this sync owns in Mealie. Matched on to decide
// create-vs-update; anything else in the group is left alone.
const MANAGED_PROVIDER_NAME = 'Claude (dashboard-managed)';
// Recipe parsing is a plain extraction task — Haiku is plenty and ~5x cheaper
// than Opus per import, which §123.1 flagged as the concern.
const MEALIE_AI_MODEL = 'claude-haiku-4-5';
// Anthropic's OpenAI-compatible endpoint. Mealie's OpenAI client appends
// `/chat/completions`; the trailing slash matches Anthropic's own docs.
const ANTHROPIC_OPENAI_BASE_URL = 'https://api.anthropic.com/v1/';

// Compose always sets ${MEALIE_PORT:-10230}; this only covers a parse miss.
const FALLBACK_PORT = 10230;

// `up` returns before Mealie's webapp is serving (its healthcheck
// start_period is 60s). Same budget as guacamoleAdminRotate's poll.
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveMealieBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(MEALIE_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

/**
 * Log in as the dashboard-owned admin, polling for the webapp to come up.
 * Prefers the generated password; if that's rejected but the shipped default
 * still works, rotates it and re-logs-in. Returns a bearer token or null.
 */
async function loginAsManagedAdmin(baseUrl: string): Promise<string | null> {
  const generated = readAppEnvValue(MEALIE_SERVICE, MEALIE_ADMIN_PASSWORD_KEY);
  if (!generated) {
    logger.error(`Mealie AI sync skipped: ${MEALIE_ADMIN_PASSWORD_KEY} is not set`);
    return null;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let reachable = true;
    try {
      const token = await mealieLogin(baseUrl, SEED_ADMIN_EMAIL, generated);
      if (token) {
        return token;
      }
      // Generated password rejected — either the default is still in place
      // (rotate it now) or someone changed it by hand (nothing we can do).
      const defaultToken = await mealieLogin(baseUrl, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
      if (!defaultToken) {
        logger.warn("Mealie AI sync: neither the generated nor the default admin password works — can't authenticate");
        return null;
      }
      const rotated = await mealieChangePassword(baseUrl, defaultToken, SEED_ADMIN_PASSWORD, generated);
      if (!rotated) {
        logger.error('Mealie AI sync: default admin login worked but the password change failed');
        return null;
      }
      logger.info("Rotated Mealie's default admin password");
      return mealieLogin(baseUrl, SEED_ADMIN_EMAIL, generated);
    } catch {
      reachable = false;
    }
    if (!reachable && attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
    }
  }
  logger.warn('Mealie AI sync gave up: the app never became reachable');
  return null;
}

/**
 * Reconcile the managed AI provider against the stored Claude key. No key →
 * turn AI off and drop the provider. Key set → upsert the provider (always a
 * full write: Mealie never echoes `api_key` back, so there's nothing to
 * diff) and make it the group default. No-op for every other service; never
 * throws.
 */
export async function syncMealieAiProvider(serviceName: string): Promise<void> {
  if (serviceName !== MEALIE_SERVICE) {
    return;
  }
  if (!resolveComposeFile(MEALIE_SERVICE)?.composeFile) {
    return;
  }

  try {
    const baseUrl = await resolveMealieBaseUrl();
    const token = await loginAsManagedAdmin(baseUrl);
    if (!token) {
      return;
    }

    const key = await getClaudeApiKey();
    const settings = await mealieGetAiSettings(baseUrl, token);
    const existing = settings.providers.find((p) => p.name === MANAGED_PROVIDER_NAME);

    if (!key) {
      if (existing) {
        if (settings.defaultProviderId === existing.id) {
          await mealieSetAiSettings(baseUrl, token, null);
        }
        await mealieDeleteAiProvider(baseUrl, token, existing.id);
        logger.info('Mealie AI sync: Claude key cleared — disabled AI parsing and removed the managed provider');
        await writeAuditLog({
          userId: null,
          action: 'settings_change',
          resource: 'mealie_ai_provider',
          result: 'success',
        }).catch(() => {});
      }
      return;
    }

    const body: MealieAiProviderInput = {
      name: MANAGED_PROVIDER_NAME,
      base_url: ANTHROPIC_OPENAI_BASE_URL,
      api_key: key,
      model: MEALIE_AI_MODEL,
    };

    let providerId: string;
    if (existing) {
      await mealieUpdateAiProvider(baseUrl, token, existing.id, body);
      providerId = existing.id;
    } else {
      providerId = await mealieCreateAiProvider(baseUrl, token, body);
    }

    if (settings.defaultProviderId !== providerId) {
      await mealieSetAiSettings(baseUrl, token, providerId);
    }
    logger.info('Mealie AI sync: managed Claude provider is in place and set as the group default');
    await writeAuditLog({
      userId: null,
      action: 'settings_change',
      resource: 'mealie_ai_provider',
      result: 'success',
    }).catch(() => {});
  } catch (error) {
    logger.warn('Mealie AI sync failed', { error: (error as Error).message });
  }
}
