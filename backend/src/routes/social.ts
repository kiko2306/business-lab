/**
 * Social-media content generation (plan.md §84.3 / §254 P2). Generate a post
 * draft from a prompt with the stored Claude key, then list / edit / delete
 * the drafts. Publishing is a later phase (P3).
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { generateSocialPost, ClaudeKeyMissingError } from '../services/claudeGenerate';
import { listDrafts, createDraft, updateDraftContent, deleteDraft } from '../services/socialDrafts';
import logger from '../utils/logger';

const router = Router();

// Each generate call spends Anthropic tokens, so throttle it — an operator
// iterating on a prompt clicks a handful of times, not hundreds.
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many generation requests, please slow down.' },
});

router.get('/drafts', async (_req: Request, res: Response) => {
  try {
    return res.json({ drafts: await listDrafts() });
  } catch (error) {
    logger.error('Listing social drafts failed', { error: error instanceof Error ? error.message : error });
    return res.status(500).json({ error: 'Unable to load drafts.' });
  }
});

router.post('/drafts', generateLimiter, validateBody(schemas.socialDraftCreate), async (req: Request, res: Response) => {
  try {
    const content = await generateSocialPost(req.body.prompt.trim());
    const draft = await createDraft(req.body.prompt.trim(), content);
    return res.status(201).json({ draft });
  } catch (error) {
    if (error instanceof ClaudeKeyMissingError) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('Generating a social draft failed', { error: error instanceof Error ? error.message : error });
    return res.status(502).json({ error: 'Generation failed — check the Claude API key and try again.' });
  }
});

router.patch(
  '/drafts/:id',
  validateParams(schemas.socialDraftIdParam),
  validateBody(schemas.socialDraftUpdate),
  async (req: Request, res: Response) => {
    try {
      const draft = await updateDraftContent(Number(req.params.id), req.body.content.trim());
      if (!draft) return res.status(404).json({ error: 'Draft not found.' });
      return res.json({ draft });
    } catch (error) {
      logger.error('Updating a social draft failed', { error: error instanceof Error ? error.message : error });
      return res.status(500).json({ error: 'Unable to save the draft.' });
    }
  }
);

router.delete('/drafts/:id', validateParams(schemas.socialDraftIdParam), async (req: Request, res: Response) => {
  try {
    const deleted = await deleteDraft(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Draft not found.' });
    return res.status(204).end();
  } catch (error) {
    logger.error('Deleting a social draft failed', { error: error instanceof Error ? error.message : error });
    return res.status(500).json({ error: 'Unable to delete the draft.' });
  }
});

export default router;
