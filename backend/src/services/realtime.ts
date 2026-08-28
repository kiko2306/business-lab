import { Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import { getAllServiceStatus } from './status';
import { ServiceStatusResponse } from '../types';

const STREAM_INTERVAL_MS = 15000;
const wsClients = new Set<WebSocket>();
const streamTickets = new Map<string, { userId: number; expiresAt: number }>();

export function createStreamTicket(userId: number): string {
  for (const [key, value] of streamTickets.entries()) {
    if (value.expiresAt <= Date.now()) {
      streamTickets.delete(key);
    }
  }
  const ticket = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  streamTickets.set(ticket, { userId, expiresAt: Date.now() + 60 * 1000 });
  return ticket;
}

function getTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (typeof req.query?.token === 'string') {
    return req.query.token;
  }
  return null;
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

async function getStatusPayload(): Promise<ServiceStatusResponse> {
  return getAllServiceStatus();
}

function startStatusBroadcaster(): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    if (!wsClients.size) {
      return;
    }
    try {
      const payload = await getStatusPayload();
      for (const socket of wsClients) {
        sendJson(socket, payload);
      }
    } catch {
      // Keep stream alive even if one status cycle fails.
    }
  }, STREAM_INTERVAL_MS);
}

export function initWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws/services' });
  const broadcaster = startStatusBroadcaster();

  wss.on('connection', async (socket: WebSocket, req) => {
    const searchParams = new URL(req.url || '', 'http://localhost').searchParams;
    const ticket = searchParams.get('ticket');
    const ticketPayload = ticket ? streamTickets.get(ticket) : null;
    if (!ticketPayload || ticketPayload.expiresAt <= Date.now()) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    wsClients.add(socket);
    socket.on('close', () => wsClients.delete(socket));

    try {
      sendJson(socket, await getStatusPayload());
    } catch {
      socket.close(1011, 'Unable to fetch status');
    }
  });

  wss.on('close', () => {
    clearInterval(broadcaster);
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
  });
  res.flushHeaders?.();

  const sendEvent = (payload: ServiceStatusResponse) => {
    res.write(`event: status\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    sendEvent(await getStatusPayload());
  } catch {
    res.write(`event: error\ndata: {"error":"Unable to fetch status"}\n\n`);
  }

  const interval = setInterval(async () => {
    try {
      sendEvent(await getStatusPayload());
    } catch {
      res.write(`event: error\ndata: {"error":"Unable to fetch status"}\n\n`);
    }
  }, STREAM_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(interval);
  });
}
