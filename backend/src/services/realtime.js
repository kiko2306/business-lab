'use strict';

const { WebSocket, WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../utils/jwt');
const { getAllServiceStatus } = require('./status');

const STREAM_INTERVAL_MS = 15000;
const wsClients = new Set();

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
    const token = query.get('token');
    try {
      verifyAccessToken(token);
    } catch {
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
  initWebSocket,
  sseHandler,
};
