/**
 * Claim Twenty's workspace-owner account on start, closing the §421 race:
 * Twenty is exposed directly (no OIDC in the community edition, §342), so
 * until an owner exists the first visitor to the public hostname becomes
 * one. See twentyClient.ts's header for the source-verified mutation chain
 * and why this is safe to automate (the workspace-count gate is
 * self-closing — no config toggle needed, and §421's docs claim about
 * `IS_SIGN_UP_ENABLED` was a dead env var, not a real gate).
 *
 * Gated on exposure like docusealAdminBootstrap — the race is only live
 * while Twenty is reachable at the public hostname; unexposed, it keeps its
 * own onboarding for whoever reaches it directly.
 *
 * Idempotent by construction, tracked via `checkUserExists`, not a boolean
 * flag: `already-owned` (our email already owns a workspace) is a no-op;
 * `needs-workspace` (our own `signUp` ran on a prior start but
 * `signUpInNewWorkspace` didn't) resumes with `signIn` instead of retrying
 * `signUp`, which would otherwise fail on an account that already exists.
 *
 * Retry budget is longer than every sibling bootstrap's default 60s: Twenty
 * runs every pending TypeORM migration before it answers anything (the
 * compose healthcheck's own 180s `start_period`, confirmed live at ~3 min in
 * §371) — first boot on a fresh clone is exactly the highest-value case,
 * since that's when no workspace exists yet.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { checkTwentyUserState, getTwentyAccessToken, createTwentyWorkspace } from './twentyClient';

export const TWENTY_SERVICE = 'twenty';
export const TWENTY_ADMIN_PASSWORD_KEY = 'TWENTY_ADMIN_PASSWORD';
// Compose always sets ${TWENTY_PORT:-10580}; this only covers a parse miss.
const FALLBACK_PORT = 10580;
// The workspace's display name — not the admin's; Twenty has no sensible
// per-deployment default for this, so it's fixed like DocuSeal's ACCOUNT_NAME.
const WORKSPACE_DISPLAY_NAME = 'Business Lab';

// 210s (70 x 3s): comfortably past the 180s first-boot migration window
// (see module doc comment) — deliberately longer than the 60s every other
// sibling bootstrap uses, since those apps don't run migrations this long.
const MAX_ATTEMPTS = 70;
const RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveTwentyBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(TWENTY_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

export async function reconcileTwentyFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== TWENTY_SERVICE) return;
  if (!resolveComposeFile(TWENTY_SERVICE)?.composeFile) return;

  const exposureRow = await getServiceExposureRow(TWENTY_SERVICE);
  if (!exposureRow?.enabled) return;

  const password = readAppEnvValue(TWENTY_SERVICE, TWENTY_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`Twenty admin bootstrap skipped: ${TWENTY_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const email = getAutheliaAdminUser()?.email?.trim();
  if (!email) {
    logger.warn('Twenty admin bootstrap skipped: no Authelia admin email yet — complete the dashboard /setup with an email first.');
    return;
  }

  try {
    const baseUrl = await resolveTwentyBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await checkTwentyUserState(baseUrl, email);

      if (state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('Twenty admin bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'already-owned') {
        logger.info('Twenty already has a workspace owner; nothing to bootstrap');
        return;
      }

      const tokenOp = state === 'needs-signup' ? 'signUp' : 'signIn';
      const accessToken = await getTwentyAccessToken(baseUrl, tokenOp, email, password);
      if (!accessToken) {
        // SIGNUP_DISABLED lands here too: someone else's account already
        // claimed the one workspace this instance allows (§421) between our
        // check and this call. Safe to stop either way — never guess further.
        logger.warn(`Twenty admin bootstrap: ${tokenOp} did not return an access token — will retry next start`);
        return;
      }

      const created = await createTwentyWorkspace(baseUrl, accessToken, WORKSPACE_DISPLAY_NAME);
      if (created) {
        logger.info('Twenty workspace owner created', { email });
      } else {
        logger.warn('Twenty admin bootstrap: workspace creation failed — will retry next start');
      }
      return;
    }
  } catch (error) {
    logger.warn('Twenty admin bootstrap failed', { error: (error as Error).message });
  }
}
