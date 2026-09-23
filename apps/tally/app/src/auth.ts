import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { hash } from './tokens';

/**
 * Two callers reach this API, and they authenticate completely differently.
 *
 * **Admins** arrive through Authelia, which authenticates them and forwards the
 * result as `Remote-User` / `Remote-Groups` (plan.md §629 — the app keeps no
 * accounts of its own). We trust those headers.
 *
 * That trust is bounded by the deployment, not by this code: the app's host
 * port is published, so anyone already on the host or LAN could set the headers
 * themselves and skip Authelia. That is true of every Authelia-only app on the
 * box and is an accepted property of the model, not something this app can fix
 * alone — the gate is the network, and the tunnel is the only way in from
 * outside.
 *
 * **Agents** never pass through Authelia at all: their paths bypass it (§628)
 * because a service cannot follow a redirect to a login form. They carry a
 * bearer token issued at enrolment instead.
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
      agent?: { id: string; storeId: string };
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

/** Any signed-in Authelia user. */
export function requireIdentity(req: Request, res: Response, next: NextFunction): void {
  const identity = readIdentity(req);
  if (!identity) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }
  req.identity = identity;
  next();
}

/**
 * Administration — creating stores, granting access, issuing enrolment codes.
 * Deliberately not something an ordinary store viewer can do: a viewer who
 * could mint an enrolment code could enrol an agent of their own.
 */
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
 * Authenticates a shop agent by its bearer token and records that it called.
 *
 * `last_seen_at` is updated here rather than on a dedicated heartbeat route, so
 * every authenticated call counts as liveness — this is what replaces the
 * legacy single-row `conn_logs` (§627).
 */
export function requireAgent(pool: Pool) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'missing agent token' });
      return;
    }
    // Revoked agents are rejected here, so revocation takes effect on the
    // agent's very next call with no restart or cache to wait for.
    const { rows } = await pool.query(
      `UPDATE agents SET last_seen_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING id, store_id`,
      [hash(token)]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'unknown or revoked agent token' });
      return;
    }
    req.agent = { id: rows[0].id, storeId: rows[0].store_id };
    next();
  };
}
