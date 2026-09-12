/**
 * Create (and keep in step) Uptime Kuma's SMTP notification from the global
 * mail settings, so "one mailbox entered once" covers it like every other app
 * (plan.md §427, §416.5).
 *
 * Uptime Kuma is the awkward case the mail docs called out: an email alert is
 * not configuration, it is a *notification object* in its own database, with
 * no environment variable anywhere. Two things made it doable now — §421 gave
 * it an admin account, and the Socket.IO client written for that bootstrap is
 * reused here rather than a second transport.
 *
 * Authentication is free: this app runs with `disableAuth` (§227/§216) so
 * Authelia is the only gate, and the server therefore sends `autoLogin` and
 * treats the socket as signed in. Without that, this would need the admin
 * password over the wire.
 *
 * Idempotent through Uptime Kuma's own API rather than a local marker: the
 * server sends `notificationList` on login, so an existing notification of
 * the same name is *updated* by passing its id back to `addNotification`.
 * Creating a duplicate on every start would be the obvious failure here.
 */

import WebSocket from 'ws';
import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getMailConfig } from '../utils/mailSettings';
import { decodeFrame, isAckOk } from './uptimeKumaAdminBootstrap';

const SERVICE = 'uptime-kuma';
const FALLBACK_PORT = 10370;
/** Stable name: it is also how an existing notification is recognised. */
export const NOTIFICATION_NAME = 'Email (dashboard mail settings)';

const CONNECT_WAIT_MS = 6000;
const ACK_WAIT_MS = 15_000;
const ADD_ACK_ID = 7;

export interface KumaNotification {
  id?: number;
  name: string;
  type: string;
}

/**
 * Uptime Kuma sends `notificationList` as an array of rows whose `config` is
 * a JSON *string*. Only the id and name matter here. Exported for the test:
 * failing to find an existing entry means a duplicate notification per start.
 */
export function findExistingId(frameArgs: unknown[] | undefined, name: string): number | null {
  if (!Array.isArray(frameArgs) || frameArgs[0] !== 'notificationList') return null;
  const rows = frameArgs[1];
  if (!Array.isArray(rows)) return null;
  for (const row of rows as { id?: number; name?: string }[]) {
    if (row?.name === name && typeof row.id === 'number') return row.id;
  }
  return null;
}

/**
 * The notification payload. `smtpSecure` is implicit TLS (port 465) only —
 * STARTTLS is negotiated on a plain connection, so setting it for `tls` would
 * make nodemailer speak TLS to a plaintext port and fail. `isDefault` +
 * `applyExisting` are what make this cover monitors that already exist rather
 * than only new ones.
 */
export function buildSmtpNotification(
  mail: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    smtpEncryption: string;
    fromAddress: string;
    fromName: string;
  },
  recipient: string
): Record<string, unknown> {
  return {
    name: NOTIFICATION_NAME,
    type: 'smtp',
    isDefault: true,
    applyExisting: true,
    smtpHost: mail.smtpHost,
    smtpPort: mail.smtpPort,
    smtpSecure: mail.smtpEncryption === 'ssl',
    smtpIgnoreTLSError: false,
    smtpUsername: mail.smtpUser,
    smtpPassword: mail.smtpPassword,
    smtpFrom: mail.fromName ? `${mail.fromName} <${mail.fromAddress}>` : mail.fromAddress,
    smtpTo: recipient,
  };
}

type Outcome = 'unreachable' | 'created' | 'updated' | 'failed';

function send(baseWsUrl: string, notification: Record<string, unknown>): Promise<Outcome> {
  return new Promise((resolve) => {
    let settled = false;
    let sent = false;
    let existingId: number | null = null;
    const timers: NodeJS.Timeout[] = [];

    const socket = new WebSocket(`${baseWsUrl}/socket.io/?EIO=4&transport=websocket`);
    const finish = (outcome: Outcome) => {
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

    timers.push(setTimeout(() => finish(sent ? 'failed' : 'unreachable'), CONNECT_WAIT_MS + ACK_WAIT_MS));
    socket.on('error', () => finish('unreachable'));
    socket.on('close', () => finish(sent ? 'failed' : 'unreachable'));

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
        // notificationList arrives on its own once the server considers us
        // signed in; give it a moment, then write whether or not it came.
        timers.push(
          setTimeout(() => {
            if (sent) return;
            sent = true;
            socket.send(`42${ADD_ACK_ID}${JSON.stringify(['addNotification', notification, existingId])}`);
          }, CONNECT_WAIT_MS)
        );
        return;
      }
      if (frame.kind === 'event') {
        const found = findExistingId(frame.args, NOTIFICATION_NAME);
        if (found !== null) existingId = found;
        return;
      }
      if (frame.kind === 'ack' && frame.ackId === ADD_ACK_ID) {
        finish(isAckOk(frame) ? (existingId === null ? 'created' : 'updated') : 'failed');
      }
    });
  });
}

export async function reconcileUptimeKumaMailNotification(serviceName: string): Promise<void> {
  if (serviceName !== SERVICE) return;
  if (!resolveComposeFile(SERVICE)?.composeFile) return;

  const mail = await getMailConfig().catch(() => null);
  if (!mail) return; // no global mail settings yet — nothing to mirror

  // Uptime Kuma needs somewhere to send to, and the Authelia admin's address
  // is the same identity every other bootstrap here uses.
  const recipient = getAutheliaAdminUser()?.email?.trim();
  if (!recipient) {
    logger.warn('Uptime Kuma mail notification skipped: no Authelia admin email yet');
    return;
  }

  try {
    const port = getPublishedUpstreamPort(SERVICE) ?? FALLBACK_PORT;
    const baseWsUrl = `ws://${await getHostGatewayIp()}:${port}`;
    const outcome = await send(baseWsUrl, buildSmtpNotification(mail, recipient));

    if (outcome === 'created' || outcome === 'updated') {
      logger.info(`Uptime Kuma SMTP notification ${outcome}`, { name: NOTIFICATION_NAME, recipient });
      return;
    }
    logger.warn(`Uptime Kuma mail notification not applied (${outcome})`);
  } catch (error) {
    logger.warn('Uptime Kuma mail notification failed', { error: (error as Error).message });
  }
}
