/**
 * Create Uptime Kuma's admin account on start, so reaching it lands on a
 * login page instead of a "create your admin user" setup form (§421,
 * principle 3).
 *
 * Uptime Kuma has no OIDC, so its own login is the only gate, and until an
 * admin exists anyone who reaches it can claim the instance.
 *
 * Unlike every sibling bootstrap, Uptime Kuma has **no REST API for this** —
 * setup is a Socket.IO event. Rather than add a socket.io-client dependency
 * for one call, this speaks the handful of Socket.IO v4 frames involved over
 * the `ws` client the backend already depends on. The exchange, as observed
 * against the running app:
 *
 *   → connect  /socket.io/?EIO=4&transport=websocket
 *   ← 0{"sid":…}                 engine.io OPEN
 *   → 40                         socket.io CONNECT (default namespace)
 *   ← 40{"sid":…}                CONNECT ack
 *   ← 42["setup"]                *only* sent when no user exists yet
 *   ← 42["info",{…}] / 42["autoLogin"]
 *   → 421["setup","<user>","<pw>"]
 *   ← 431[{"ok":true,…}]
 *
 * `42["setup"]` is therefore the state signal, and its **absence** means
 * already set up — which is the safe direction: a missed signal skips the
 * bootstrap rather than firing setup at a live instance.
 */

import WebSocket from 'ws';
import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { readAppEnvValue } from './appEnv';

export const UPTIME_KUMA_SERVICE = 'uptime-kuma';
export const UPTIME_KUMA_ADMIN_PASSWORD_KEY = 'UPTIME_KUMA_ADMIN_PASSWORD';
// Compose always sets ${UPTIME_KUMA_PORT:-10370}; this only covers a parse miss.
const FALLBACK_PORT = 10370;

const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
// How long to wait for the server to volunteer 42["setup"] after CONNECT. It
// arrived immediately in every observed run; this is slack, not a guess at a
// slow path.
const SETUP_SIGNAL_WAIT_MS = 4000;
const ACK_WAIT_MS = 10_000;
const ACK_ID = 1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DecodedFrame {
  kind: 'open' | 'connect' | 'event' | 'ack' | 'ping' | 'other';
  ackId?: number;
  args?: unknown[];
}

/**
 * Decode one Socket.IO v4 frame. Exported because this — not the socket
 * plumbing — is the part that silently breaks if the protocol shifts, and a
 * misread frame would mean either firing setup at a live instance or never
 * firing it at all.
 */
export function decodeFrame(raw: string): DecodedFrame {
  if (raw === '2') return { kind: 'ping' };
  if (raw.startsWith('0')) return { kind: 'open' };
  if (raw.startsWith('40')) return { kind: 'connect' };
  for (const [prefix, kind] of [
    ['42', 'event'],
    ['43', 'ack'],
  ] as const) {
    if (!raw.startsWith(prefix)) continue;
    const rest = raw.slice(prefix.length);
    const bracket = rest.indexOf('[');
    if (bracket === -1) return { kind: 'other' };
    const ackId = bracket > 0 ? Number(rest.slice(0, bracket)) : undefined;
    try {
      const args = JSON.parse(rest.slice(bracket));
      if (!Array.isArray(args)) return { kind: 'other' };
      return { kind, ackId: Number.isFinite(ackId) ? ackId : undefined, args };
    } catch {
      return { kind: 'other' };
    }
  }
  return { kind: 'other' };
}

/** True only for the server's explicit `42["setup"]` announcement. */
export function isSetupSignal(frame: DecodedFrame): boolean {
  return frame.kind === 'event' && frame.args?.[0] === 'setup';
}

/** `{ok:true}` in an ack payload, per Uptime Kuma's own callback shape. */
export function isAckOk(frame: DecodedFrame): boolean {
  const body = frame.args?.[0] as { ok?: boolean } | undefined;
  return frame.kind === 'ack' && body?.ok === true;
}

type Outcome = 'unreachable' | 'already-setup' | 'created' | 'failed';

function runSetup(baseWsUrl: string, username: string, password: string): Promise<Outcome> {
  return new Promise((resolve) => {
    let settled = false;
    let sawSetupSignal = false;
    let sentSetup = false;
    const timers: NodeJS.Timeout[] = [];

    const socket = new WebSocket(`${baseWsUrl}/socket.io/?EIO=4&transport=websocket`);
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      try {
        socket.close();
      } catch {
        /* closing a socket that already failed is not an error worth reporting */
      }
      resolve(outcome);
    };

    timers.push(setTimeout(() => finish(sentSetup ? 'failed' : 'unreachable'), ACK_WAIT_MS + SETUP_SIGNAL_WAIT_MS));

    socket.on('error', () => finish('unreachable'));
    socket.on('close', () => finish(sentSetup ? 'failed' : 'already-setup'));

    socket.on('message', (data) => {
      const frame = decodeFrame(data.toString());

      if (frame.kind === 'ping') {
        socket.send('3'); // engine.io pong; the server drops us otherwise
        return;
      }
      if (frame.kind === 'open') {
        socket.send('40'); // CONNECT to the default namespace
        return;
      }
      if (frame.kind === 'connect') {
        // The server volunteers 42["setup"] within moments if no user exists.
        // Nothing arriving means there is one — so this window decides
        // "already set up", and erring long is the safe side.
        timers.push(setTimeout(() => !sawSetupSignal && finish('already-setup'), SETUP_SIGNAL_WAIT_MS));
        return;
      }
      if (isSetupSignal(frame) && !sentSetup) {
        sawSetupSignal = true;
        sentSetup = true;
        socket.send(`42${ACK_ID}${JSON.stringify(['setup', username, password])}`);
        return;
      }
      if (frame.kind === 'ack' && frame.ackId === ACK_ID) {
        finish(isAckOk(frame) ? 'created' : 'failed');
      }
    });
  });
}

export async function reconcileUptimeKumaFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== UPTIME_KUMA_SERVICE) return;
  if (!resolveComposeFile(UPTIME_KUMA_SERVICE)?.composeFile) return;

  const password = readAppEnvValue(UPTIME_KUMA_SERVICE, UPTIME_KUMA_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`Uptime Kuma admin bootstrap skipped: ${UPTIME_KUMA_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const username = getAutheliaAdminUser()?.username?.trim();
  if (!username) {
    logger.warn('Uptime Kuma admin bootstrap skipped: no Authelia admin yet — complete the dashboard /setup first.');
    return;
  }

  try {
    const port = getPublishedUpstreamPort(UPTIME_KUMA_SERVICE) ?? FALLBACK_PORT;
    const baseWsUrl = `ws://${await getHostGatewayIp()}:${port}`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const outcome = await runSetup(baseWsUrl, username, password);

      if (outcome === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('Uptime Kuma admin bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (outcome === 'already-setup') {
        logger.info('Uptime Kuma already has an admin account; nothing to bootstrap');
        return;
      }
      if (outcome === 'created') {
        logger.info('Uptime Kuma admin account created', { username });
        return;
      }
      logger.warn('Uptime Kuma admin bootstrap failed: setup was rejected');
      return;
    }
  } catch (error) {
    logger.warn('Uptime Kuma admin bootstrap failed', { error: (error as Error).message });
  }
}
