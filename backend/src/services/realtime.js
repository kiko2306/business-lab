'use strict';

const { WebSocket, WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../utils/jwt');
const { getAllServiceStatus } = require('./status');

const STREAM_INTERVAL_MS = 15000;
const wsClients = new Set();
const streamTickets = new Map();

function createStreamTicket(userId) {
  for (const [key, value] of streamTickets.entries()) {
    if (value.expiresAt <= Date.now()) {
      streamTickets.delete(key);
    }
  }
  const ticket = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  streamTickets.set(ticket, { userId, expiresAt: Date.now() + 60 * 1000 });
  return ticket;
}

function getTokenFromRequest(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (typeof req.query?.token === 'string') {
    return req.query.token;
  }
  return null;
}

function authenticateStreamRequest(req) {
  if (typeof req.query?.ticket === 'string') {
    const ticket = streamTickets.get(req.query.ticket);
    if (ticket && ticket.expiresAt > Date.now()) {
      return { id: ticket.userId };
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

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

async function getStatusPayload() {
  return getAllServiceStatus();
}

function startStatusBroadcaster() {
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

function initWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws/services' });
  const broadcaster = startStatusBroadcaster();

  wss.on('connection', async (socket, req) => {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const ticket = query.get('ticket');
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

async function sseHandler(req, res) {
  if (!authenticateStreamRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized stream access.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const sendEvent = (payload) => {
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

module.exports = {
  createStreamTicket,
  initWebSocket,
  sseHandler,
};
