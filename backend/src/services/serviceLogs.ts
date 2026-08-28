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

// Portainer et al. colorize their output; strip it so the popup shows clean
// text (same approach as services/setupToken.ts).
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

const POLL_INTERVAL_MS = 2000;
const MAX_STREAM_MS = 180_000;
// `docker compose up -d` returns quickly, so if nothing is up after this
// long the start almost certainly errored out before any container ran.
const STOPPED_GRACE_MS = 12_000;

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
  let child: ChildProcessWithoutNullStreams | undefined;
  let spawnAttempts = 0;
  let sawRunning = false;
  const startedAt = Date.now();
  let poll: ReturnType<typeof setInterval> | undefined;
  let hardStop: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (poll) {
      clearInterval(poll);
      poll = undefined;
    }
    if (hardStop) {
      clearTimeout(hardStop);
      hardStop = undefined;
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
    send('done', info);
    cleanup();
    res.end();
  };

  const emitLines = (chunk: Buffer) => {
    const text = chunk.toString('utf8').replace(ANSI_PATTERN, '');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (line) {
        send('log', { line });
      }
    }
  };

  const spawnLogs = () => {
    spawnAttempts += 1;
    child = spawn(
      'docker',
      ['compose', '-p', projectName, '-f', composeFile, 'logs', '--follow', '--no-color', '--tail', '120'],
      { env: process.env }
    );
    child.stdout.on('data', emitLines);
    child.stderr.on('data', emitLines);
    child.on('error', (err) => {
      send('log', { line: `Could not read container logs: ${err.message}` });
    });
    child.on('exit', () => {
      if (finished) {
        return;
      }
      // `logs --follow` exits right away when the project has no containers
      // yet — retry a few times while `compose up` is still creating them.
      if (spawnAttempts < 4 && Date.now() - startedAt < 15_000) {
        setTimeout(() => {
          if (!finished) {
            spawnLogs();
          }
        }, 1500);
      }
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

    if (state === 'running') {
      sawRunning = true;
      if (healthy) {
        finish({ state: 'running', healthy: true });
      }
      return;
    }

    if (state === 'error') {
      finish({ state: 'error', healthy: false });
      return;
    }

    // stopped / unknown
    if (sawRunning || Date.now() - startedAt > STOPPED_GRACE_MS) {
      finish({ state, healthy: false });
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
