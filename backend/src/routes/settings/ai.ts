// Settings routes: AI provider keys and which provider serves each feature.
// Mounted, behind the capability gate, by ./index.ts.
import { Router, Request, Response } from 'express';
import { writeAuditLog } from '../../utils/audit';
import { schemas, validateBody, validateParams } from '../../middleware/validation';
import {
  AI_FEATURES,
  AI_PROVIDERS,
  AiFeature,
  AiProviderId,
  getAiApiKey,
  getFeatureProvider,
  maskAiApiKey,
  setAiApiKey,
  setFeatureProvider,
} from '../../utils/aiSettings';
import { testAiProviderKey } from '../../services/aiProviderTest';
import { syncMealieAiProvider } from '../../services/mealieAiSync';

const router = Router();

// ---------------------------------------------------------------------------
// AI API keys — one third-party token per provider (Anthropic, Google
// Gemini, Groq), entered once, used by content generation (§84.3) and
// Mealie AI parsing (§238). Generalized from a single Anthropic-only "Claude
// API key" in plan.md §610. Same shape as the Cloudflare token above: masked
// on read, overwrite on write, verify on test — plus which provider is
// active for each feature.
// ---------------------------------------------------------------------------
router.get('/ai-keys', async (_req: Request, res: Response) => {
  try {
    const providers = await Promise.all(
      AI_PROVIDERS.map(async (definition) => {
        const key = await getAiApiKey(definition.id);
        return { provider: definition.id, label: definition.label, configured: Boolean(key), keyMasked: maskAiApiKey(key) };
      })
    );
    const features = Object.fromEntries(
      await Promise.all(AI_FEATURES.map(async (feature) => [feature, await getFeatureProvider(feature)]))
    ) as Record<AiFeature, AiProviderId>;
    return res.json({ providers, features });
  } catch {
    return res.status(500).json({ error: 'Unable to load the AI API keys.' });
  }
});

router.put(
  '/ai-keys/:provider',
  validateParams(schemas.aiProviderIdParam),
  validateBody(schemas.aiKeyUpdate),
  async (req: Request, res: Response) => {
    const provider = req.params.provider as AiProviderId;
    try {
      const key = req.body.apiKey.trim();
      await setAiApiKey(provider, key);
      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'settings_change',
        resource: `ai_api_key_${provider}`,
        result: 'success',
      });

      // Push the new key into Mealie's AI recipe parser if this is the
      // provider configured for it, and it's running (§238). Detached: the
      // reconcile polls Mealie for up to a minute, and a Mealie start
      // re-runs it anyway (executor.ts), so the response never waits.
      void syncMealieAiProvider('mealie').catch(() => {});

      return res.json({ configured: true, keyMasked: maskAiApiKey(key), message: 'API key saved.' });
    } catch {
      return res.status(500).json({ error: 'Unable to save the AI API key.' });
    }
  }
);

router.post(
  '/ai-keys/:provider/test',
  validateParams(schemas.aiProviderIdParam),
  validateBody(schemas.aiKeyTest),
  async (req: Request, res: Response) => {
    const provider = req.params.provider as AiProviderId;
    const key = (req.body.apiKey || '').trim() || (await getAiApiKey(provider));
    if (!key) {
      return res.status(400).json({ error: 'No API key to test — save one first.' });
    }

    try {
      const result = await testAiProviderKey(provider, key);
      return res.status(result.success ? 200 : 400).json(result);
    } catch {
      return res.status(502).json({ error: 'Unable to reach the provider to verify the key.' });
    }
  }
);

router.put('/ai-feature-provider', validateBody(schemas.aiFeatureProviderUpdate), async (req: Request, res: Response) => {
  const feature = req.body.feature as AiFeature;
  const provider = req.body.provider as AiProviderId;
  try {
    await setFeatureProvider(feature, provider);
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: `ai_provider_${feature}`,
      metadata: { provider },
      result: 'success',
    });

    // Same reasoning as the key save above — apply immediately if it's the
    // Mealie feature and Mealie is running.
    if (feature === 'mealie_parse') {
      void syncMealieAiProvider('mealie').catch(() => {});
    }

    return res.json({ feature, provider });
  } catch {
    return res.status(500).json({ error: 'Unable to save the AI provider selection.' });
  }
});

export default router;
