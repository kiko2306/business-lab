import type { IncomingMessage, Server } from 'http';
import crypto from 'crypto';
import type { Pool } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import { hash } from './tokens';

/**
 * The live connections from shop agents (plan.md §627).
 *
 * Direction is the whole point. The legacy design had each shop listen on a
 * public port and publish its IP every 30 seconds so the cloud could call in
 * (§622) — an unauthenticated POS on the open internet. Here the agent dials
 * out and holds the connection, and the cloud asks questions down a socket it
 * never opened. Nothing at the shop listens, and nothing at the shop needs a
 * router change.
 *
 * Requests are multiplexed: each carries an id, and the agent echoes it back,
 * so one socket serves concurrent browsers without a queue.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  socket: WebSocket;
  storeId: string;
  agentId: string;
  pending: Map<string, Pending>;
  /** Cleared on pong; a connection still unacknowledged at the next sweep is dead. */
  awaitingPong: boolean;
}

/** How long to wait for an agent to answer before giving up on a request. */
const ASK_TIMEOUT_MS = 20_000;

/**
 * Ping interval. A tunnel or a NAT will drop an idle connection silently and
 * leave a socket that looks open from here, so liveness has to be proven
 * rather than assumed.
 */
const HEARTBEAT_MS = 30_000;

export class AgentHub {
  /** By store: one live agent per shop, matching the schema's partial unique index. */
  private connections = new Map<string, Connection>();
  private heartbeat?: NodeJS.Timeout;

  constructor(private pool: Pool) {}

  isConnected(storeId: string): boolean {
    return this.connections.has(storeId);
  }

  connectedStoreIds(): string[] {
    return [...this.connections.keys()];
  }

  /**
   * Ask the shop's agent a question and wait for its reply.
   *
   * Throws rather than returning a placeholder when the shop is not connected:
   * a dashboard showing stale or empty figures as though they were real is
   * worse than one that says the shop is offline.
   */
  async ask(storeId: string, method: string, params?: unknown): Promise<unknown> {
    const conn = this.connections.get(storeId);
    if (!conn) throw new AgentOfflineError(storeId);

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new AgentTimeoutError(method));
      }, ASK_TIMEOUT_MS);
      conn.pending.set(id, { resolve, reject, timer });
      conn.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Attach to the HTTP server. The upgrade is handled manually rather than by
   * `WebSocketServer({ server })` so authentication can refuse the handshake
   * outright — an unauthenticated client never becomes a WebSocket at all.
   */
  attach(server: Server): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/agent/connect') {
        socket.destroy();
        return;
      }
      void this.authenticate(req).then((agent) => {
        if (!agent) {
          // A plain 401 before the upgrade completes: the agent sees a normal
          // HTTP failure and can log it, rather than a socket that opens and
          // closes for no stated reason.
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => this.register(ws, agent));
      });
    });

    this.heartbeat = setInterval(() => this.sweep(), HEARTBEAT_MS);
    // Never hold the process open for the heartbeat alone.
    this.heartbeat.unref();
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const conn of this.connections.values()) conn.socket.terminate();
    this.connections.clear();
  }

  private async authenticate(req: IncomingMessage): Promise<{ agentId: string; storeId: string } | null> {
    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return null;
    // Same query as the HTTP middleware: revoked agents are refused here too,
    // so revocation drops a *connecting* agent as well as a calling one.
    const { rows } = await this.pool.query(
      `UPDATE agents SET last_seen_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING id, store_id`,
      [hash(token)]
    );
    return rows.length ? { agentId: rows[0].id, storeId: rows[0].store_id } : null;
  }

  private register(socket: WebSocket, agent: { agentId: string; storeId: string }): void {
    // A reconnect after a network blip leaves the old socket looking healthy
    // from here, so the newest connection wins and the stale one is dropped.
    // Otherwise a shop could become permanently unreachable behind a zombie.
    this.connections.get(agent.storeId)?.socket.terminate();

    const conn: Connection = {
      socket,
      storeId: agent.storeId,
      agentId: agent.agentId,
      pending: new Map(),
      awaitingPong: false,
    };
    this.connections.set(agent.storeId, conn);

    socket.on('pong', () => {
      conn.awaitingPong = false;
      // Cheap liveness record: one write per shop per heartbeat.
      void this.pool
        .query(`UPDATE agents SET last_seen_at = now() WHERE id = $1`, [conn.agentId])
        .catch(() => undefined);
    });

    socket.on('message', (raw) => this.onMessage(conn, raw.toString()));

    socket.on('close', () => {
      // Only clear the slot if it is still ours — a replaced connection must
      // not evict the socket that replaced it.
      if (this.connections.get(conn.storeId) === conn) this.connections.delete(conn.storeId);
      for (const pending of conn.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new AgentOfflineError(conn.storeId));
      }
      conn.pending.clear();
    });

    socket.on('error', () => socket.terminate());
  }

  private onMessage(conn: Connection, raw: string): void {
    let frame: { id?: string; ok?: boolean; data?: unknown; error?: string };
    try {
      frame = JSON.parse(raw);
    } catch {
      // A malformed frame is the agent's bug, not a reason to drop a working
      // connection: every in-flight request would fail with it.
      return;
    }
    if (!frame.id) return;
    const pending = conn.pending.get(frame.id);
    if (!pending) return;
    conn.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.ok === false) {
      pending.reject(new AgentError(frame.error ?? 'the shop agent reported an error'));
      return;
    }
    pending.resolve(frame.data);
  }

  private sweep(): void {
    for (const conn of this.connections.values()) {
      if (conn.awaitingPong) {
        // Missed a full interval: the socket is open here but nothing is on
        // the other end. Terminating triggers 'close', which frees the slot.
        conn.socket.terminate();
        continue;
      }
      conn.awaitingPong = true;
      conn.socket.ping();
    }
  }
}

export class AgentOfflineError extends Error {
  constructor(storeId: string) {
    super(`no agent connected for store ${storeId}`);
    this.name = 'AgentOfflineError';
  }
}

export class AgentTimeoutError extends Error {
  constructor(method: string) {
    super(`the shop agent did not answer "${method}" in time`);
    this.name = 'AgentTimeoutError';
  }
}

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}
