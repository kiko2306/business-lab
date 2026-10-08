/**
 * What has to be true before this API answers its first request, and what can
 * happen afterwards.
 *
 * These lived as a dozen unawaited `ensure*().catch(log)` calls in `index.ts`
 * with `app.listen` on the next line, so on a first boot — or on the boot after
 * an upgrade that adds a table — a request could arrive before its schema
 * existed (plan.md §884 item 3). The migrations now gate listening.
 *
 * Only the schema gates it. The sweepers, reconcilers and Docker-touching boot
 * work stay behind `listen`: they are long-running (an exposure reconcile talks
 * to Cloudflare, `ensureCoreSidecars` runs compose) and holding readiness on
 * them would trade one race for a minutes-long dark window.
 */

import {
  ensureAuditLogsIndex,
  ensureRoleModelReshape,
  ensureServiceExposureTable,
  ensureTotpSchema,
  ensureUserAppAccessSchema,
  ensureUserEmailUnique,
  ensureUserInvitationsSchema,
  ensureUserRolesTable,
  dropServiceExposureAutheliaColumn,
  dropServiceImageUpdatesTable,
} from './utils/database';
import { ensureAlertCategoryTopics } from './utils/alertNotify';
import { ensureAiApiKeyMigration } from './utils/aiSettings';
import { sealStoredSecrets } from './utils/settingsStore';
import { ensureSocialDraftsTable } from './services/socialDrafts';
import { ensureAdvertSubscribersTable } from './services/advertSubscribers';
import { ensureSelfUpdateTable, reconcileDanglingSelfUpdateRun } from './services/selfUpdate';

export interface SchemaStep {
  /** Named so a failure says which migration it was, not just that one failed. */
  label: string;
  run: () => Promise<unknown>;
}

/**
 * Each entry is one independent chain. Steps *within* a chain are sequential
 * because the later one depends on the earlier (the role reshape renames rows
 * the table migration backfilled; the email index needs the column that
 * `ensureUserAppAccessSchema` adds). Different chains touch different tables,
 * so they run concurrently and a failure in one does not cancel another.
 */
const SCHEMA_STEPS: SchemaStep[] = [
  { label: 'ensure the role model', run: () => ensureUserRolesTable().then(ensureRoleModelReshape) },
  {
    label: 'ensure the user app-access / invitations schema',
    run: () => ensureUserAppAccessSchema().then(ensureUserInvitationsSchema).then(ensureUserEmailUnique),
  },
  {
    label: 'ensure the service_exposure table',
    run: () => ensureServiceExposureTable().then(dropServiceExposureAutheliaColumn),
  },
  { label: 'ensure the TOTP schema', run: ensureTotpSchema },
  { label: 'drop service_image_updates', run: dropServiceImageUpdatesTable },
  { label: 'ensure the audit_logs index', run: ensureAuditLogsIndex },
  { label: 'ensure the alert category topics', run: ensureAlertCategoryTopics },
  { label: 'ensure the AI API key migration', run: ensureAiApiKeyMigration },
  { label: 'seal stored third-party secrets', run: sealStoredSecrets },
  { label: 'ensure the social_drafts table', run: ensureSocialDraftsTable },
  { label: 'ensure the advert_subscribers table', run: ensureAdvertSubscribersTable },
  {
    label: 'ensure the self-update schema',
    run: () => ensureSelfUpdateTable().then(reconcileDanglingSelfUpdateRun),
  },
];

/**
 * Run every schema step and resolve once all have settled — never reject.
 *
 * A broken migration logs which one it was and the API comes up anyway: the
 * alternative is a dashboard that will not answer at all, which is worse than
 * one page erroring, and the operator needs the Update panel reachable to fix
 * it. `steps` is injectable so this can be tested without a database.
 */
export async function ensureSchema(steps: SchemaStep[] = SCHEMA_STEPS): Promise<void> {
  await Promise.all(
    steps.map(async ({ label, run }) => {
      try {
        await run();
      } catch (error) {
        console.error(`Unable to ${label}:`, (error as Error).message);
      }
    })
  );
}
