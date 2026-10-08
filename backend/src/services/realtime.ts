import crypto from 'crypto';
import { Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import { getAllServiceStatus } from './status';
import { ServiceStatusResponse } from '../types';

const STREAM_INTERVAL_MS = 15000;
const streamTickets = new Map<string, { userId: number; expiresAt: number }>();

type StatusSubscriber = (payload: ServiceStatusResponse) => void;

/**
 * Every open stream, WebSocket and SSE alike. They share one ticker and one
 * status build per cycle: a full build costs one `docker ps` and one exposure
 * read across ~50 apps, and SSE used to run that per client — three open tabs
 * on the SSE fallback cost three times as much as one, for identical bytes.
 */
const subscribers = new Set<StatusSubscriber>();
let ticker: ReturnType<typeof setInterval> | null = null;

/** Builds the payload once and hands it to every live stream. */
export async function broadcastStatusTick(
  build: () => Promise<ServiceStatusResponse> = getAllServiceStatus
): Promise<void> {
  if (!subscribers.size) {
    return;
  }
  let payload: ServiceStatusResponse;
  try {
    payload = await build();
  } catch {
    return; // keep every stream alive even if one status cycle fails
  }
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(payload);
    } catch {
      // A socket that died between the build and the write must not cost the
      // rest of the clients their update.
    }
  }
}

/** The ticker only runs while something is listening, so an idle box is idle. */
export function addStatusSubscriber(subscriber: StatusSubscriber): void {
  subscribers.add(subscriber);
  if (!ticker) {
    ticker = setInterval(() => void broadcastStatusTick(), STREAM_INTERVAL_MS);
  }
}

export function removeStatusSubscriber(subscriber: StatusSubscriber): void {
  subscribers.delete(subscriber);
  if (!subscribers.size && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

export function createStreamTicket(userId: number): string {
  for (const [key, value] of streamTickets.entries()) {
    if (value.expiresAt <= Date.now()) {
      streamTickets.delete(key);
    }
  }
  // A ticket is an auth credential: it opens the live status stream for 60 s
  // without an Authorization header. It used to be `Date.now().toString(36)`
  // plus `Math.random().toString(36).slice(2, 14)` — Math.random() is not a
  // CSPRNG (V8's generator state is recoverable from a handful of outputs, so
  // one observed ticket predicts the next), and the timestamp prefix both
  // shrank the guessing space and said when it was issued (plan.md §879 item 2).
  const ticket = crypto.randomUUID();
  streamTickets.set(ticket, { userId, expiresAt: Date.now() + 60 * 1000 });
  return ticket;
}

/**
 * The access token from the Authorization header, and only from there. It used
 * to fall back to `?token=…`, which wrote access tokens into nginx's access log
 * on every stream request — and nothing needed it: a browser that cannot set a
 * header on an `EventSource` uses `?ticket=` instead, which is what both the
 * frontend and the startup-log stream pass (plan.md §879 item 2).
 */
function getTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

/**
 * Resolve a stream ticket (issued by createStreamTicket) to its user id, or
 * null if it's unknown or expired. Tickets aren't consumed on use — they're
 * short-lived (60s) and a client may open more than one stream with one.
 */
export function resolveStreamTicketUser(ticket: string | null | undefined): number | null {
  if (!ticket) {
    return null;
  }
  const entry = streamTickets.get(ticket);
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.userId;
}

function authenticateStreamRequest(req: Request): { id: number } | null {
  if (typeof req.query?.ticket === 'string') {
    const userId = resolveStreamTicketUser(req.query.ticket);
    if (userId !== null) {
      return { id: userId };
    }
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }

  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

function sendJson(socket: WebSocket, payload: ServiceStatusResponse): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function initWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws/services' });

  wss.on('connection', async (socket: WebSocket, req) => {
    const searchParams = new URL(req.url || '', 'http://localhost').searchParams;
    if (resolveStreamTicketUser(searchParams.get('ticket')) === null) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    const subscriber: StatusSubscriber = (payload) => sendJson(socket, payload);
    addStatusSubscriber(subscriber);
    socket.on('close', () => removeStatusSubscriber(subscriber));

    try {
      sendJson(socket, await getAllServiceStatus());
    } catch {
      removeStatusSubscriber(subscriber);
      socket.close(1011, 'Unable to fetch status');
    }
  });
}

export async function sseHandler(req: Request, res: Response): Promise<Response | void> {
  if (!authenticateStreamRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized stream access.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // nginx buffers a proxied response by default, so a stream of small
    // writes can sit in that buffer indefinitely instead of reaching the
    // browser — found live (plan.md §792): the frontend's WebSocket fallback
    // to this endpoint connected (200 OK) but never received a single event.
    // This is nginx's own documented per-response opt-out.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const sendEvent = (payload: ServiceStatusResponse) => {
    res.write(`event: status\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    sendEvent(await getAllServiceStatus());
  } catch {
    res.write(`event: error\ndata: {"error":"Unable to fetch status"}\n\n`);
  }

  addStatusSubscriber(sendEvent);
  req.on('close', () => removeStatusSubscriber(sendEvent));
}
