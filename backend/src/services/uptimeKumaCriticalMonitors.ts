/**
 * Auto-provisions Uptime Kuma monitors for the four services everything else
 * depends on — NPM, Authelia, Tailscale's Funnel (which also carries
 * NetBird's signal traffic), and NetBird's management/relay — plus an ntfy
 * notification wired to all of them (plan.md §443). Since §533 also the
 * alert pipeline itself (CrowdSec, the n8n relay, ntfy). Everything alerts
 * over ntfy only (§550), except ntfy's own monitor, which emails, since
 * ntfy can't report its own outage.
 *
 * Built after two outages (§442) sat undetected because every *local* health
 * signal reported fine while the actual external path was broken — only a
 * real client-shaped probe over the internet would have caught either one.
 * Uptime Kuma already runs on this stack and already has an ntfy-shaped
 * notification provider built in, so this points it at the same five public
 * URLs `criticalServiceHealth.ts` probes for its own auto-restart decision,
 * rather than re-implementing scheduling/alerting from scratch.
 *
 * Same Socket.IO v4 hand-rolled transport as uptimeKumaAdminBootstrap.ts /
 * uptimeKumaMailNotification.ts (Uptime Kuma 1.x has no REST API for this —
 * confirmed against its pinned `1.23.17` source, `server/server.js`: `add`,
 * `editMonitor` and `addNotification` are plain ack-style socket events).
 *
 * Unlike notifications (`Notification.save` upserts by the `notificationID`
 * you pass it), a **monitor has no server-side dedup at all** — `add` always
 * `R.dispense`s a fresh row, full stop (confirmed reading the handler: no
 * name lookup, no id-optional upsert path). So the existing "wait a fixed
 * interval, then act" pattern the sibling files use is not safe to reuse
 * here — missing the current `monitorList` and creating anyway would leave
 * a fresh duplicate of every monitor on every backend restart. This
 * therefore *requires* an observed `monitorList` (and `notificationList`)
 * before creating anything, and skips the whole pass — logging, not
 * guessing — if either never arrives in time.
 */

import WebSocket from 'ws';
import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getExposureConfig } from '../utils/exposureSettings';
import { getAlertNotifyConfig } from '../utils/alertNotify';
import { getSignalHostname } from './criticalServiceHealth';
import { decodeFrame, isAckOk, DecodedFrame } from './uptimeKumaAdminBootstrap';
import { findExistingId, NOTIFICATION_NAME as MAIL_NOTIFICATION_NAME } from './uptimeKumaMailNotification';

const SERVICE = 'uptime-kuma';
const NTFY_SERVICE = 'ntfy';
const N8N_SERVICE = 'n8n';
const CROWDSEC_SERVICE = 'crowdsec';
const FALLBACK_PORT = 10370;
export const NOTIFICATION_NAME = 'Critical service alerts (ntfy)';

const CONNECT_WAIT_MS = 6000;
// Both notificationList and monitorList arrive unprompted once the server
// treats the socket as signed in (disableAuth → autoLogin, same as the mail
// notification file) — this is how long to wait for both before giving up
// on the whole pass rather than risk creating a monitor blind.
const LIST_WAIT_MS = 8000;
const ACK_WAIT_MS = 15_000;

interface KumaMonitorRow {
  id?: number;
  name?: string;
  maxretries?: number;
  notificationIDList?: Record<string, boolean>;
}

/**
 * Where a monitor's alert goes: ntfy (§550), except ntfy's own monitor,
 * which emails, because a push about ntfy being down would go through ntfy.
 */
type NotifyVia = 'ntfy' | 'email';

interface DesiredMonitor {
  name: string;
  url: () => Promise<string | null>;
  notify: NotifyVia;
  /** Defaults to "any HTTP response"; a real health endpoint passes only on 2xx. */
  acceptedStatuses?: string[];
  /** Failed retries (60 s apart) before DOWN and an alert. Defaults to 1. */
  maxretries?: number;
}

/**
 * Resolve a monitor's notification ids. Without an email notification (mail
 * not configured), everything falls back to ntfy, so ntfy's own monitor still
 * shows up in Uptime Kuma instead of alerting nowhere. Exported for the test.
 */
export function notificationIdsFor(notify: NotifyVia, ntfyId: number, emailId: number | null): number[] {
  return notify === 'email' && emailId !== null ? [emailId] : [ntfyId];
}

/**
 * "Any HTTP response counts, only a transport failure doesn't" — the same
 * reasoning criticalServiceHealth.ts and netbirdRoutingPeer.ts's
 * waitForManagement use. NetBird's management/relay answer unauthenticated
 * with 401/404 and Tailscale's Funnel answers a plain GET with 405; all of
 * these ranges together just means "the server responded at all".
 */
const ACCEPT_ANY_STATUS = ['100-199', '200-299', '300-399', '400-499', '500-599'];

/** Exported for the test — accepted_statuscodes and notificationIDList are what actually make alerting work. */
export function defaultMonitor(
  name: string,
  url: string,
  notificationIds: number[],
  acceptedStatuses: string[] = ACCEPT_ANY_STATUS,
  maxretries = 1
): Record<string, unknown> {
  return {
    type: 'http',
    name,
    description: 'Auto-provisioned by the Business Lab dashboard (plan.md §443) — probes the real external path.',
    parent: null,
    url,
    method: 'GET',
    interval: 60,
    retryInterval: 60,
    resendInterval: 0,
    maxretries,
    timeout: 10,
    notificationIDList: Object.fromEntries(notificationIds.map((id) => [id, true])),
    ignoreTls: false,
    upsideDown: false,
    packetSize: 56,
    expiryNotification: false,
    maxredirects: 10,
    accepted_statuscodes: acceptedStatuses,
    dns_resolve_type: 'A',
    dns_resolve_server: '1.1.1.1',
    docker_container: '',
    docker_host: null,
    proxyId: null,
    mqttUsername: '',
    mqttPassword: '',
    mqttTopic: '',
    mqttSuccessMessage: '',
    authMethod: null,
    oauth_auth_method: 'client_secret_basic',
    httpBodyEncoding: 'json',
    kafkaProducerBrokers: [],
    kafkaProducerSaslOptions: { mechanism: 'None' },
    kafkaProducerSsl: false,
    kafkaProducerAllowAutoTopicCreation: false,
    gamedigGivenPortOnly: true,
  };
}

/**
 * A monitor's `add` handler has no server-side dedup at all (unlike
 * `addNotification`, which upserts by the id you pass it) — so this is the
 * only thing standing between a restart and a duplicate monitor. Exported
 * for the test.
 */
export function findExistingMonitorNames(monitorList: Record<string, KumaMonitorRow>): Set<string> {
  return new Set(Object.values(monitorList).map((m) => m.name).filter((name): name is string => Boolean(name)));
}

/**
 * What an existing monitor gets reconciled on: its retry count is raised to
 * `minRetries` (never lowered), and its notifications are set to exactly
 * `exactIds`. Nothing else is touched, so hand edits survive. The row
 * is monitorList's full `toJSON()`, which is exactly what Kuma's own edit
 * page sends back to `editMonitor`. Null when nothing needs changing.
 * Exported for the test.
 */
export function reconciledRow(
  row: Record<string, unknown> & KumaMonitorRow,
  minRetries: number | undefined,
  exactIds: number[]
): Record<string, unknown> | null {
  if (typeof row.id !== 'number') return null;
  const edited: Record<string, unknown> = { ...row };
  if (minRetries !== undefined && (row.maxretries ?? 0) < minRetries) edited.maxretries = minRetries;
  const current = Object.keys(row.notificationIDList ?? {}).filter((id) => row.notificationIDList?.[id]);
  if (current.sort().join() !== exactIds.map(String).sort().join()) {
    // editMonitor replaces the monitor's notification rows wholesale.
    edited.notificationIDList = Object.fromEntries(exactIds.map((id) => [String(id), true]));
  }
  return edited.maxretries === row.maxretries && edited.notificationIDList === row.notificationIDList ? null : edited;
}

async function desiredMonitors(): Promise<DesiredMonitor[]> {
  return [
    {
      name: 'Nginx Proxy Manager (public)',
      url: async () => {
        const config = await getExposureConfig();
        return config ? `https://${config.baseDomain}/` : null;
      },
      notify: 'ntfy',
    },
    {
      name: 'Authelia (public)',
      url: async () => {
        const config = await getExposureConfig();
        return config ? `https://authelia.${config.baseDomain}/api/health` : null;
      },
      notify: 'ntfy',
    },
    {
      name: 'Tailscale Funnel (also NetBird signal)',
      url: async () => {
        const host = await getSignalHostname();
        return host ? `https://${host}/` : null;
      },
      notify: 'ntfy',
      // Tailscale's DNS answers NXDOMAIN for the live Funnel name about once
      // a day, and public resolvers cache that for ts.net's 300 s negative
      // TTL (§543). 7 retries 60 s apart means DOWN only after ~7 min of
      // failure, so that blip stays silent and a real outage still alerts.
      maxretries: 7,
    },
    {
      name: 'NetBird management (public)',
      url: async () => {
        const config = await getExposureConfig();
        return config ? `https://netbird-vpn-api.${config.baseDomain}/api/networks` : null;
      },
      notify: 'ntfy',
    },
    {
      name: 'NetBird relay (public)',
      url: async () => {
        const config = await getExposureConfig();
        return config ? `https://netbird-vpn-relay.${config.baseDomain}/` : null;
      },
      notify: 'ntfy',
    },
    // The alert pipeline itself (§533): CrowdSec → n8n relay → ntfy. Any one
    // of them down means security alerts stop with nothing saying so, which
    // is how §531 went unnoticed for six days. Real health endpoints, so
    // only 2xx passes. Each is skipped when its app isn't installed.
    {
      name: 'CrowdSec (alert source)',
      // Over the crowdsec-lapi network Uptime Kuma joins; LAPI isn't published.
      url: async () => (installed(CROWDSEC_SERVICE) ? 'http://crowdsec:8080/health' : null),
      notify: 'ntfy',
      acceptedStatuses: ['200-299'],
    },
    {
      name: 'n8n (alert relay)',
      url: async () => hostPortUrl(N8N_SERVICE, '/healthz'),
      notify: 'ntfy',
      acceptedStatuses: ['200-299'],
    },
    {
      name: 'ntfy (push server)',
      url: async () => hostPortUrl(NTFY_SERVICE, '/v1/health'),
      notify: 'email',
      acceptedStatuses: ['200-299'],
    },
  ];
}

function installed(service: string): boolean {
  return Boolean(resolveComposeFile(service)?.composeFile);
}

/** An app's published port via the host gateway, the same route the ntfy notification uses. */
async function hostPortUrl(service: string, path: string): Promise<string | null> {
  const port = installed(service) ? getPublishedUpstreamPort(service) : null;
  return port ? `http://${await getHostGatewayIp()}:${port}${path}` : null;
}

/** The internal ntfy URL publishAlert() posts to — same host-gateway route, no dependency on the tunnel. */
async function ntfyServerUrl(): Promise<string | null> {
  const port = getPublishedUpstreamPort(NTFY_SERVICE);
  if (!port) return null;
  return `http://${await getHostGatewayIp()}:${port}/`;
}

type SessionOutcome = 'unreachable' | 'lists-not-seen' | 'done' | 'failed';

/**
 * One socket session: connect, wait for the server to volunteer both lists,
 * upsert the ntfy notification, create whatever monitors are missing.
 * Exported for the test — the ack-correlation/list-collection logic is the
 * part that silently breaks if the protocol shifts.
 */
export function runSession(baseWsUrl: string, notification: Record<string, unknown>, monitors: DesiredMonitor[]): Promise<SessionOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let nextAckId = 1;
    let notificationListArgs: unknown[] | undefined;
    let monitorList: Record<string, KumaMonitorRow> | null = null;
    const pending = new Map<number, (frame: DecodedFrame) => void>();
    const timers: NodeJS.Timeout[] = [];

    const socket = new WebSocket(`${baseWsUrl}/socket.io/?EIO=4&transport=websocket`);
    const finish = (outcome: SessionOutcome) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      try {
        socket.close();
      } catch {
        /* already broken; nothing to report */
      }
      resolve(outcome);
    };

    timers.push(setTimeout(() => finish('unreachable'), CONNECT_WAIT_MS + LIST_WAIT_MS + ACK_WAIT_MS));
    socket.on('error', () => finish('unreachable'));
    socket.on('close', () => finish('unreachable'));

    function call(event: string, ...args: unknown[]): Promise<DecodedFrame> {
      const ackId = nextAckId++;
      return new Promise((res) => {
        pending.set(ackId, res);
        socket.send(`42${ackId}${JSON.stringify([event, ...args])}`);
        timers.push(
          setTimeout(() => {
            if (pending.delete(ackId)) res({ kind: 'other' });
          }, ACK_WAIT_MS)
        );
      });
    }

    async function run() {
      // Both lists arrive unprompted once the server treats us as signed in
      // (disableAuth → autoLogin) — give them a real window rather than the
      // fixed single timer the sibling files use, since guessing wrong here
      // means a duplicate monitor, not a skipped no-op.
      const listDeadline = Date.now() + LIST_WAIT_MS;
      while ((notificationListArgs === undefined || monitorList === null) && Date.now() < listDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (notificationListArgs === undefined || monitorList === null) {
        finish('lists-not-seen');
        return;
      }

      const existingNotificationId = findExistingId(notificationListArgs, notification.name as string);
      const notifAck = await call('addNotification', notification, existingNotificationId);
      const notifBody = notifAck.args?.[0] as { ok?: boolean; id?: number } | undefined;
      if (!isAckOk(notifAck) || typeof notifBody?.id !== 'number') {
        finish('failed');
        return;
      }
      const notificationId = notifBody.id;
      // Created before this on the same start (executor runs the mail
      // reconcile first); null when mail isn't configured.
      const emailId = findExistingId(notificationListArgs, MAIL_NOTIFICATION_NAME);

      const existingNames = findExistingMonitorNames(monitorList);
      for (const monitor of monitors) {
        if (existingNames.has(monitor.name)) {
          const row = Object.values(monitorList).find((m) => m.name === monitor.name) as Record<string, unknown> & KumaMonitorRow;
          // Exact ids on every reconcile: the mail notification is
          // `applyExisting` (uptimeKumaMailNotification.ts) and re-attaches
          // itself to every monitor on each Kuma start (§549/§550).
          const exactIds = notificationIdsFor(monitor.notify, notificationId, emailId);
          const edited = reconciledRow(row, monitor.maxretries, exactIds);
          if (edited && !isAckOk(await call('editMonitor', edited))) {
            logger.warn(`Uptime Kuma critical monitors: failed to reconcile "${monitor.name}"`);
          }
          continue;
        }
        const url = await monitor.url();
        if (!url) continue; // that service's config isn't ready yet
        const addAck = await call(
          'add',
          defaultMonitor(
            monitor.name,
            url,
            notificationIdsFor(monitor.notify, notificationId, emailId),
            monitor.acceptedStatuses,
            monitor.maxretries
          )
        );
        if (!isAckOk(addAck)) {
          logger.warn(`Uptime Kuma critical monitors: failed to add "${monitor.name}"`, {
            error: (addAck.args?.[0] as { msg?: string } | undefined)?.msg,
          });
        }
      }

      finish('done');
    }

    socket.on('message', (data) => {
      const frame = decodeFrame(data.toString());

      if (frame.kind === 'ping') {
        socket.send('3');
        return;
      }
      if (frame.kind === 'open') {
        socket.send('40');
        return;
      }
      if (frame.kind === 'connect') {
        void run();
        return;
      }
      if (frame.kind === 'event') {
        if (frame.args?.[0] === 'notificationList' && Array.isArray(frame.args[1])) {
          notificationListArgs = frame.args;
        } else if (frame.args?.[0] === 'monitorList' && frame.args[1] && typeof frame.args[1] === 'object') {
          monitorList = frame.args[1] as Record<string, KumaMonitorRow>;
        }
        return;
      }
      if (frame.kind === 'ack' && typeof frame.ackId === 'number') {
        const resolver = pending.get(frame.ackId);
        if (resolver) {
          pending.delete(frame.ackId);
          resolver(frame);
        }
      }
    });
  });
}

export async function ensureCriticalServiceMonitors(serviceName: string): Promise<void> {
  if (serviceName !== SERVICE) return;
  if (!resolveComposeFile(SERVICE)?.composeFile) return;

  const serverUrl = await ntfyServerUrl();
  if (!serverUrl) return; // ntfy not installed on this deployment

  const { topics } = await getAlertNotifyConfig();
  const notification = {
    name: NOTIFICATION_NAME,
    type: 'ntfy',
    isDefault: true,
    applyExisting: false, // only the monitors this file owns should use it
    ntfyserverurl: serverUrl,
    ntfytopic: topics['critical-service'],
    ntfyPriority: 4,
  };

  try {
    const port = getPublishedUpstreamPort(SERVICE) ?? FALLBACK_PORT;
    const baseWsUrl = `ws://${await getHostGatewayIp()}:${port}`;
    const outcome = await runSession(baseWsUrl, notification, await desiredMonitors());

    if (outcome === 'done') {
      logger.info('Uptime Kuma: critical-service monitors reconciled');
      return;
    }
    logger.warn(`Uptime Kuma critical monitors not applied (${outcome})`);
  } catch (error) {
    logger.warn('Uptime Kuma critical monitors failed', { error: (error as Error).message });
  }
}
