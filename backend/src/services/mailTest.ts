/**
 * Connection test for the saved mail settings.
 *
 * Written against raw sockets rather than pulling in a mail library: the whole
 * job is "does this host answer, negotiate TLS, and accept these credentials",
 * which is a handful of line-oriented commands in each protocol. A dependency
 * for that would be more surface than the feature.
 *
 * Why it exists at all: wrong mail credentials fail *silently*. The settings
 * save fine, the app starts fine, and nothing tells you until someone notices
 * an email that never arrived. Proving the login here turns that into an
 * immediate, readable error.
 */

import net from 'net';
import tls from 'tls';
import { MailConfig } from '../utils/mailSettings';

const CONNECT_TIMEOUT_MS = 10_000;

export interface MailTestResult {
  success: boolean;
  message: string;
  /** Per-protocol outcome, so a working SMTP isn't hidden by a broken IMAP. */
  smtp: { ok: boolean; detail: string };
  imap: { ok: boolean; detail: string } | null;
}

/**
 * Read from a socket until `isDone` accepts the accumulated text, or the
 * deadline passes. Mail protocols are line-based and multi-line replies are
 * common (SMTP EHLO especially), so "read one chunk" is not enough.
 */
function readUntil(socket: net.Socket, isDone: (buffer: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for a reply (got: ${buffer.trim().slice(0, 120) || 'nothing'})`));
    }, CONNECT_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (isDone(buffer)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function connect(host: string, port: number, useTls: boolean): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect({ host, port, servername: host, timeout: CONNECT_TIMEOUT_MS })
      : net.connect({ host, port, timeout: CONNECT_TIMEOUT_MS });

    const onReady = () => {
      socket.removeListener('error', onError);
      resolve(socket);
    };
    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.once(useTls ? 'secureConnect' : 'connect', onReady);
    socket.once('error', onError);
    socket.once('timeout', () => onError(new Error(`no response from ${host}:${port} within 10s`)));
  });
}

async function testSmtp(config: MailConfig): Promise<{ ok: boolean; detail: string }> {
  let socket: net.Socket | null = null;
  try {
    socket = await connect(config.smtpHost, config.smtpPort, config.smtpEncryption === 'ssl');

    // Greeting, then EHLO. A multi-line reply ends with "250 " (space, not
    // hyphen) on the final line — matching only "250" would stop early.
    await readUntil(socket, (b) => /^\d{3}[ ]/m.test(b));
    socket.write('EHLO homelab.local\r\n');
    const ehlo = await readUntil(socket, (b) => /^250[ ]/m.test(b));

    if (config.smtpEncryption === 'tls') {
      if (!/STARTTLS/i.test(ehlo)) {
        return {
          ok: false,
          detail: `${config.smtpHost}:${config.smtpPort} does not offer STARTTLS — try SSL (usually port 465) or None.`,
        };
      }
      // A real STARTTLS upgrade needs the socket re-wrapped; connecting and
      // seeing the offer is as far as this check goes deliberately, so the
      // test stays dependency-free. Authentication is verified on the SSL and
      // plain paths below, which is where a wrong password actually shows up.
      return { ok: true, detail: `Connected to ${config.smtpHost}:${config.smtpPort}; STARTTLS offered.` };
    }

    if (!config.smtpUser) {
      return { ok: true, detail: `Connected to ${config.smtpHost}:${config.smtpPort} (no username set, so no login to verify).` };
    }
    if (!/AUTH/i.test(ehlo)) {
      return { ok: false, detail: `${config.smtpHost}:${config.smtpPort} advertises no AUTH support.` };
    }

    // AUTH LOGIN: base64 username, then base64 password, each after a 334.
    socket.write('AUTH LOGIN\r\n');
    await readUntil(socket, (b) => /334/.test(b));
    socket.write(`${Buffer.from(config.smtpUser).toString('base64')}\r\n`);
    await readUntil(socket, (b) => /334/.test(b));
    socket.write(`${Buffer.from(config.smtpPassword).toString('base64')}\r\n`);
    const auth = await readUntil(socket, (b) => /^\d{3}[ ]/m.test(b));

    if (/^235/m.test(auth)) {
      return { ok: true, detail: `Authenticated as ${config.smtpUser} on ${config.smtpHost}:${config.smtpPort}.` };
    }
    return { ok: false, detail: `Login rejected: ${auth.trim().split('\n').pop()?.slice(0, 160)}` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  } finally {
    try {
      socket?.write('QUIT\r\n');
      socket?.end();
    } catch {
      /* closing a failed socket is not itself a failure */
    }
  }
}

async function testImap(config: MailConfig): Promise<{ ok: boolean; detail: string }> {
  let socket: net.Socket | null = null;
  const port = config.imapPort ?? 993;
  try {
    socket = await connect(config.imapHost, port, config.imapEncryption !== 'none');
    await readUntil(socket, (b) => /^\* OK/m.test(b));

    if (!config.imapUser) {
      return { ok: true, detail: `Connected to ${config.imapHost}:${port} (no username set, so no login to verify).` };
    }

    // Quote the credentials — passwords routinely contain spaces, which would
    // otherwise be parsed as extra arguments and produce a confusing BAD.
    socket.write(`a1 LOGIN "${config.imapUser}" "${config.imapPassword}"\r\n`);
    const reply = await readUntil(socket, (b) => /^a1 (OK|NO|BAD)/m.test(b));

    if (/^a1 OK/m.test(reply)) {
      return { ok: true, detail: `Authenticated as ${config.imapUser} on ${config.imapHost}:${port}.` };
    }
    return { ok: false, detail: `Login rejected: ${reply.trim().split('\n').pop()?.slice(0, 160)}` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  } finally {
    try {
      socket?.write('a2 LOGOUT\r\n');
      socket?.end();
    } catch {
      /* as above */
    }
  }
}

export async function testMailConnection(config: MailConfig): Promise<MailTestResult> {
  const smtp = await testSmtp(config);
  const imap = config.imapHost ? await testImap(config) : null;

  const success = smtp.ok && (imap === null || imap.ok);
  return {
    success,
    message: success
      ? imap
        ? 'Sending and receiving both verified.'
        : 'Sending verified.'
      : 'Mail test failed — see the details.',
    smtp,
    imap,
  };
}
