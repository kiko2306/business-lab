/**
 * Live "what happened when I hit Start" log stream.
 *
 * The dashboard opens this as an SSE connection the moment a start is fired
 * and shows the container logs in a popup until the service is reported
 * running + healthy (or clearly failed), so a crash-on-boot is visible
 * instead of just a red toast.
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { Request, Response } from 'express';
import { getProjectName, isValidServiceName, resolveComposeFile } from '../config/services';
import { getServiceStatus } from './status';
import { resolveStreamTicketUser } from './realtime';
import logger from '../utils/logger';

// Strip ANSI CSI escapes (colors, but also cursor moves / erase-line that
// `docker compose` itself emits around "container exited" notices) so the
// popup shows clean text — same idea as services/setupToken.ts.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const POLL_INTERVAL_MS = 2000;
const MAX_STREAM_MS = 180_000;
// `docker compose up -d` returns quickly, so if the container is still
// missing/stopped this long after, the start almost certainly errored out
// before anything ran.
const STOPPED_GRACE_MS = 12_000;
// A container that's been created/health-starting but never reached
// "running" for this long is treated as a failed start (crash loop, stuck
// entrypoint, failing health check).
const STARTING_GRACE_MS = 90_000;
// Once a terminal state (running+healthy / failed) is detected, keep the log
// stream open this much longer so the container's boot output actually
// reaches the popup — a fast, healthy start would otherwise be cut off
// before `docker compose logs` has flushed a single line.
const DRAIN_MS = 4000;

interface DoneInfo {
  state: string;
  healthy: boolean;
  timedOut?: boolean;
}

/**
 * GET /services/:name/startup-logs?ticket=... — ticket-authenticated (an
 * EventSource can't send an Authorization header), registered before the
 * JWT gate in index.ts alongside the status stream.
 */
export function startupLogsHandler(req: Request, res: Response): void {
  const serviceName = req.params.name;
  if (!isValidServiceName(serviceName)) {
    res.status(400).json({ error: 'Invalid service name' });
    return;
  }

  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : null;
  if (resolveStreamTicketUser(ticket) === null) {
    res.status(401).json({ error: 'Unauthorized stream access.' });
    return;
  }

  streamStartupLogs(serviceName, res);
}

function streamStartupLogs(serviceName: string, res: Response): void {
  const resolved = resolveComposeFile(serviceName);
  const projectName = getProjectName(serviceName);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Tell nginx (dashboard proxy) not to buffer the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!resolved?.composeFile || !projectName) {
    send('log', { line: `${serviceName} is not installed — no compose file found.` });
    send('done', { state: 'error', healthy: false } as DoneInfo);
    res.end();
    return;
  }
  const composeFile = resolved.composeFile;

  let finished = false;
  let draining = false;
  let sawOutput = false;
  let spawnAttempts = 0;
  let child: ChildProcessWithoutNullStreams | undefined;
  let sawRunning = false;
  const startedAt = Date.now();
  let poll: ReturnType<typeof setInterval> | undefined;
  let hardStop: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let respawnTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (poll) {
      clearInterval(poll);
      poll = undefined;
    }
    if (hardStop) {
      clearTimeout(hardStop);
      hardStop = undefined;
    }
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = undefined;
    }
    if (respawnTimer) {
      clearTimeout(respawnTimer);
      respawnTimer = undefined;
    }
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    child = undefined;
  };

  const finish = (info: DoneInfo) => {
    if (finished) {
      return;
    }
    finished = true;
    if (!sawOutput) {
      send('log', {
        line:
          info.state === 'running'
            ? '— no log output was captured —'
            : '— no log output was captured; the container may not have started —',
      });
    }
    send('done', info);
    cleanup();
    res.end();
  };

  // Stop polling for state but keep the log child streaming for a moment so
  // the boot output lands in the popup before it closes.
  const finishAfterDrain = (info: DoneInfo) => {
    if (finished || draining) {
      return;
    }
    draining = true;
    if (poll) {
      clearInterval(poll);
      poll = undefined;
    }
    if (info.state === 'running' && info.healthy) {
      send('log', { line: `— ${serviceName} is running and healthy —` });
    }
    drainTimer = setTimeout(() => finish(info), DRAIN_MS);
  };

  const emitLines = (chunk: Buffer) => {
    const text = chunk.toString('utf8').replace(ANSI_PATTERN, '').replace(/\r/g, '');
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (line) {
        sawOutput = true;
        send('log', { line });
      }
    }
  };

  const spawnLogs = () => {
    if (finished || spawnAttempts >= 60) {
      return;
    }
    spawnAttempts += 1;
    child = spawn(
      'docker',
      ['compose', '-p', projectName, '-f', composeFile, 'logs', '--follow', '--no-color', '--tail', '200'],
      { env: process.env }
    );
    child.stdout.on('data', emitLines);
    child.stderr.on('data', emitLines);
    child.on('error', (err) => {
      send('log', { line: `Could not read container logs: ${err.message}` });
    });
    child.on('exit', () => {
      child = undefined;
      if (finished) {
        return;
      }
      // `logs --follow` exits immediately while the project still has no
      // containers (compose is mid `up`); once it attaches it stays alive.
      // Keep retrying until we're done — cheap, and the only way slow /
      // image-pulling starts ever get their logs shown.
      respawnTimer = setTimeout(() => spawnLogs(), 1500);
    });
  };

  poll = setInterval(async () => {
    // Comment line keeps intermediary proxies from dropping an idle stream.
    res.write(': keep-alive\n\n');

    let state = 'unknown';
    let healthy = false;
    try {
      const status = await getServiceStatus(serviceName);
      state = status.state ?? 'unknown';
      healthy = Boolean(status.healthy);
    } catch {
      return; // transient docker error — retry next tick
    }

    const elapsed = Date.now() - startedAt;

    if (state === 'running') {
      sawRunning = true;
      if (healthy) {
        finishAfterDrain({ state: 'running', healthy: true });
      }
      return; // running but health check not passing yet — keep waiting
    }

    if (sawRunning) {
      // came up, then left 'running' → it crashed / is restarting
      finishAfterDrain({ state, healthy: false });
      return;
    }

    if (state === 'starting') {
      // multi-container app still bringing its peers up: long runway before
      // giving up
      if (elapsed > STARTING_GRACE_MS) {
        finishAfterDrain({ state: 'starting', healthy: false });
      }
      return;
    }

    // 'error' (crash loop, or a container that was created but never started),
    // 'stopped' or 'unknown', and it never came up. Right after the click this
    // can just be a start still in flight, so hold for the short grace while
    // the logs stream; past that it's a failed start.
    if (elapsed > STOPPED_GRACE_MS) {
      finishAfterDrain({ state, healthy: false });
    }
  }, POLL_INTERVAL_MS);

  hardStop = setTimeout(() => {
    finish({ state: sawRunning ? 'running' : 'unknown', healthy: false, timedOut: true });
  }, MAX_STREAM_MS);
  hardStop.unref?.();

  res.on('close', () => {
    if (!finished) {
      finished = true;
      cleanup();
    }
  });

  logger.info(`Streaming startup logs: ${serviceName}`);
  send('log', { line: `Attaching to ${serviceName} logs…` });
  spawnLogs();
}
