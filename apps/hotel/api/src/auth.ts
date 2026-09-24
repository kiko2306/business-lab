import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { hash } from './tokens';

/**
 * Two callers, authenticating completely differently (plan.md §629, §631).
 *
 * **Admins** arrive through Authelia, which forwards the result as
 * `Remote-User` / `Remote-Groups`; the app keeps no accounts of its own. That
 * trust is bounded by the deployment rather than by this code — the app
 * publishes a host port, so anyone already on the host or LAN could set those
 * headers and skip Authelia. True of every Authelia-only app here, and a
 * property of the model rather than something one app can fix.
 *
 * **The property agent** never passes through Authelia at all: `/agent` is
 * bypassed (§628, §637), because a service cannot follow a redirect to a login
 * form. It carries the token enrolment issued.
 */

export interface Identity {
  user: string;
  groups: string[];
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: Identity;
      agentId?: string;
    }
  }
}

export function readIdentity(req: Request): Identity | null {
  const user = req.header('Remote-User')?.trim();
  if (!user) return null;
  const groups = (req.header('Remote-Groups') ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  return { user, groups, isAdmin: groups.includes('admins') };
}

export function requireIdentity(req: Request, res: Response, next: NextFunction): void {
  const identity = readIdentity(req);
  if (!identity) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }
  req.identity = identity;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const identity = readIdentity(req);
  if (!identity) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }
  if (!identity.isAdmin) {
    res.status(403).json({ error: 'admin only' });
    return;
  }
  req.identity = identity;
  next();
}

/**
 * Authenticates the property agent and records that it called.
 *
 * Unlike tally's, this token is not scoped to one site: the hotel agent
 * iterates every unit itself (§620), so there is one agent per deployment.
 *
 * `last_seen_at` is updated here rather than on a dedicated heartbeat route,
 * so every authenticated call counts as liveness — what replaces the legacy
 * single-row `conn_logs` and its 15-minute alert (§627).
 */
export function requireAgent(pool: Pool) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'missing agent token' });
      return;
    }
    // Clearing down_alert_sent_at here, not just bumping last_seen_at, is what
    // lets the agent-down alert (emailSchedule.ts) fire again on the *next*
    // outage rather than staying silent forever after the first one.
    const { rows } = await pool.query(
      `UPDATE agents SET last_seen_at = now(), down_alert_sent_at = NULL
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING id`,
      [hash(token)]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'unknown or revoked agent token' });
      return;
    }
    req.agentId = rows[0].id;
    next();
  };
}
