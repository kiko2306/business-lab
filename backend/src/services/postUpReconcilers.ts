import logger from '../utils/logger';
import { reconcileNextcloudOnlyOffice } from './nextcloudOnlyOffice';
import { reconcileNextcloudClamav } from './nextcloudClamav';
import { reconcileNextcloudSaml } from './nextcloudSaml';
import { reconcileNextcloudSharedMount } from './nextcloudSharedMount';
import { reconcileNextcloudMail } from './nextcloudMail';
import { reconcileNextcloudMaintenance } from './nextcloudMaintenance';
import { reconcileGuacamoleAdminPassword } from './guacamoleAdminRotate';
import { syncMealieAiProvider } from './mealieAiSync';
import { reconcilePaperlessUsers } from './paperlessUsers';
import { reconcileImmichFirstAdmin } from './immichAdminBootstrap';
import { reconcileDocusealFirstAdmin } from './docusealAdminBootstrap';
import { reconcileDocusealSignedCopy } from './docusealSignedCopy';
import { reconcileKimaiAdminAccount } from './kimaiAdminBootstrap';
import { reconcileTwentyFirstAdmin } from './twentyAdminBootstrap';
import { reconcileN8nFirstAdmin } from './n8nAdminBootstrap';
import { reconcileJellyfinFirstAdmin } from './jellyfinAdminBootstrap';
import { reconcileNavidromeFirstAdmin } from './navidromeAdminBootstrap';
import { reconcileMeshcentralFirstAdmin } from './meshcentralAdminBootstrap';
import { ensureNocodbInviteOnlySignup } from './nocodbUserProvisioning';
import { reconcileUptimeKumaFirstAdmin } from './uptimeKumaAdminBootstrap';
import { ensureNtfySubscriberToken } from './ntfyAuthBootstrap';
import { ensureCrowdsecDashboardMachine } from './crowdsecBans';
import { reconcileUptimeKumaMailNotification } from './uptimeKumaMailNotification';
import { ensureCriticalServiceMonitors } from './uptimeKumaCriticalMonitors';
import { reconcileHomeAssistantFirstAdmin } from './homeAssistantAdminBootstrap';
import { reconcileItflowFirstAdmin } from './itflowAdminBootstrap';
import { reconcileItflowMailCron } from './itflowMailCron';
import { reconcileItflowBillingModule } from './itflowBillingModule';

/**
 * The per-app reconcilers that run after `docker compose up`, keyed by the
 * service they belong to.
 *
 * A start runs only its own service's entries (plan.md §901). This used to be
 * one flat list that every start walked, each entry returning on a
 * service-name check; the cost was small but a new app's wiring meant reading
 * past two dozen unrelated entries to know it would not fire. Each entry still
 * keeps its own name guard, so a mis-keyed entry does nothing rather than the
 * wrong thing. Keys are registry service names (executor.test.ts checks).
 *
 * **Order is load-bearing in places, within one service** and the comments
 * below say where — the ITFlow mail/cron and billing entries need the
 * `settings` row the first-admin wizard creates, the Uptime Kuma notification
 * needs its admin. An array preserves it; there is no ordering between
 * services, since a start only ever runs one.
 *
 * **Errors are isolated per entry** (see runPostUpReconcilers). By the time
 * these run `up` has already succeeded and the container is up, so one of
 * them throwing must not make a successful start report as a failure — which
 * is exactly what it used to do: the throw unwound into startService's catch,
 * answered 500 with the app running, and skipped both exposure provisioning
 * and the Home Page regeneration, leaving the app up with no NPM host, no
 * tunnel route and no tile until the next start.
 */
export const POST_UP_RECONCILERS: Record<string, ((serviceName: string) => Promise<unknown>)[]> = {
  nextcloud: [
    // Nextcloud roster wiring via `occ`. After `up`, not before — unlike HACS
    // these need the app's own database, which is only up once the container is
    // (§81.4/§81.7). Both no-op for every other service.
    reconcileNextcloudOnlyOffice,
    reconcileNextcloudClamav,
    // Nextcloud: switch user_saml into environment-variable mode so Authelia's
    // forward-auth headers log the user in (§216/§217). Gated behind
    // NEXTCLOUD_PROXY_HEADER_AUTH + exposure; disables the app otherwise. Also
    // promotes the Authelia admin into Nextcloud's admin group once their
    // header-auth'd account exists (§369). After `up` — it's occ against the
    // running database. No-op elsewhere.
    reconcileNextcloudSaml,
    // Nextcloud: register the `/shared` bind mount as external storage (§219/
    // §369) — the "needs an interactive password confirmation" premise that
    // used to make this a by-hand step was wrong; `occ files_external:create`
    // has no such constraint. After `up`; no-op elsewhere.
    reconcileNextcloudSharedMount,
    // Nextcloud: copy the dashboard's global mail settings into its own SMTP
    // config (§402 — root cause of one of its two log-error warnings, a
    // Connection-refused to 127.0.0.1:25 with no mail_smtp* set at all). After
    // `up`; no-op elsewhere and when no dashboard mail account is configured.
    reconcileNextcloudMail,
    // Nextcloud: set a maintenance-window hour and run the mimetype repair
    // pass once (§402 — its other two admin-panel warnings). After `up`;
    // no-op elsewhere.
    reconcileNextcloudMaintenance,
  ],
  guacamole: [
    // Guacamole: rotate the shipped guacadmin/guacadmin default the first time
    // it's reachable (§200 slice 1). Also after `up`, not before — it's a
    // REST call against the running webapp, not a file it needs before boot.
    reconcileGuacamoleAdminPassword,
  ],
  mealie: [
    // Mealie: rotate its shipped admin default and point its AI recipe parser
    // at the stored Claude key (§238). Also after `up` — REST against the
    // running webapp. No-op for every other service.
    syncMealieAiProvider,
  ],
  immich: [
    // Immich: create the first (admin) account on an exposed start so Authelia
    // OIDC has an admin to link to — Immich won't provision the first account
    // via OAuth (§329). REST against the running API, so after `up`. No-op
    // otherwise.
    reconcileImmichFirstAdmin,
  ],
  docuseal: [
    // DocuSeal: run its first-run /setup wizard so there's no manual onboarding
    // step (§341). No OIDC — DocuSeal community has no SSO — so Authelia stays
    // the outer gate and this just creates the admin account. After `up`; no-op
    // otherwise.
    reconcileDocusealFirstAdmin,
    // DocuSeal: copy signed PDFs to the shared signed/ folder (§872). After `up`.
    reconcileDocusealSignedCopy,
  ],
  paperless: [
    // Paperless: promote the Authelia admin, or the header-trusted login lands
    // on a permissionless account and the UI 403s (§247 follow-up). After `up`.
    reconcilePaperlessUsers,
  ],
  kimai: [
    // Kimai: re-sync its admin's email/password when they've drifted from the
    // config-panel/Authelia values since first boot (§501) — the entrypoint
    // that seeds the account only ever creates it, never updates it. DB write
    // against the running kimai-db, so after `up`; no-op otherwise.
    reconcileKimaiAdminAccount,
  ],
  twenty: [
    // Twenty: claim the workspace-owner account so an exposed Twenty shows a
    // login instead of the first-visitor-claims-it signup form (§421). GraphQL
    // against the running server, so after `up`; no-op otherwise and once an
    // owner already exists.
    reconcileTwentyFirstAdmin,
  ],
  'home-assistant': [
    // Home Assistant: run its onboarding so exposing it direct (§344) has no
    // first-visitor-claims-owner race. Clean JSON API with a real `done` flag.
    // After `up`; no-op otherwise.
    reconcileHomeAssistantFirstAdmin,
  ],
  n8n: [
    // n8n: claim the owner account so an exposed n8n shows a login instead of
    // a setup wizard, and the first visitor through Authelia can't claim it
    // (§419). REST against the running editor backend, so after `up`; no-op
    // otherwise.
    reconcileN8nFirstAdmin,
  ],
  jellyfin: [
    // Jellyfin: run its startup wizard so a LAN visitor gets a login instead
    // of claiming the server (§420). REST against the running server, so after
    // `up`; no-op otherwise.
    reconcileJellyfinFirstAdmin,
  ],
  navidrome: [
    // Navidrome: create the admin so its first-run form can't be claimed by a
    // visitor (§420). REST against the running app, so after `up`; no-op
    // otherwise.
    reconcileNavidromeFirstAdmin,
  ],
  meshcentral: [
    // MeshCentral: create the site admin so its public create-account form
    // can't be claimed by a visitor (it has no Authelia gate). HTTP against the
    // running server, so after `up`; no-op otherwise.
    reconcileMeshcentralFirstAdmin,
  ],
  nocodb: [
    // NocoDB: close its public signup (its default leaves it open, and it has
    // no Authelia gate). Admin REST against the running app, so after `up`.
    ensureNocodbInviteOnlySignup,
  ],
  'uptime-kuma': [
    // Uptime Kuma: create the admin so its setup form can't be claimed by a
    // visitor (§421). Socket.IO against the running app, so after `up`; no-op
    // otherwise.
    reconcileUptimeKumaFirstAdmin,
    // Uptime Kuma: mirror the global mail settings into its own SMTP
    // notification — it has no env var for this (§427). After the admin
    // bootstrap above, and after `up`; no-op otherwise.
    reconcileUptimeKumaMailNotification,
    // Uptime Kuma: auto-provision the NPM/Authelia/Tailscale/NetBird external
    // monitors + their ntfy notification (§443) — no click-through wizard on a
    // fresh deployment. After `up`; no-op otherwise.
    ensureCriticalServiceMonitors,
  ],
  ntfy: [
    // ntfy: mint the read-only subscriber token the phone app needs, now that
    // anonymous reads are denied (§425). Writes ntfy's auth db via a throwaway
    // run container, so after `up`; no-op otherwise and once a token exists.
    ensureNtfySubscriberToken,
  ],
  itflow: [
    // ITFlow: run its first-run setup wizard (schema import + admin) so exposing
    // it direct (§344/§350) has no manual step and no claim race. The wizard's
    // first POST creates the schema — the itfloworg image doesn't. After `up`;
    // no-op otherwise.
    reconcileItflowFirstAdmin,
    // ITFlow: copy the dashboard's global mail settings into ITFlow's own DB
    // and flip its master cron switch on (§62.1) — the two by-hand steps in
    // app-credentials.md. After reconcileItflowFirstAdmin: the `settings` row
    // this writes to only exists once that wizard has run.
    reconcileItflowMailCron,
    // ITFlow: hide (or restore) the billing/accounting module from the
    // ITFLOW_HIDE_BILLING config-panel checkbox (§560) — same `settings` row,
    // same ordering constraint as the mail/cron reconciler above.
    reconcileItflowBillingModule,
  ],
  crowdsec: [
    // CrowdSec: register the dashboard's LAPI machine so Settings can list and
    // lift bans (§540). Throwaway run against its data volume, so after `up`;
    // no-op otherwise.
    ensureCrowdsecDashboardMachine,
  ],
};

/**
 * Run the started service's POST_UP_RECONCILERS entries in order, isolating each one's failure.
 *
 * Exported (with the list injectable) only so the isolation itself can be
 * tested without standing up the whole start path — see executor.test.ts.
 */
export async function runPostUpReconcilers(
  serviceName: string,
  reconcilers: Record<string, ((serviceName: string) => Promise<unknown>)[]> = POST_UP_RECONCILERS
): Promise<void> {
  for (const reconcile of reconcilers[serviceName] ?? []) {
    try {
      await reconcile(serviceName);
    } catch (error) {
      // Best-effort, deliberately: `up` succeeded and the container is
      // running. See POST_UP_RECONCILERS' doc comment.
      logger.error(`Post-start reconciler ${reconcile.name} failed for ${serviceName}`, {
        service: serviceName,
        error: (error as Error).message,
      });
    }
  }
}
