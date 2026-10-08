import { NextFunction, Request, Response } from 'express';

/**
 * The last middleware in the stack: anything thrown or passed to `next(err)`
 * lands here.
 *
 * Client faults get their own status and are not logged — a 32 kb paste and a
 * malformed body are the caller's business, and logging them on every
 * occurrence buries the faults that are ours. Everything else is a 500 with the
 * message in the log and nothing but "Internal server error" on the wire.
 *
 * `entity.too.large` used to fall through to that 500 (plan.md §884 item 4), so
 * exceeding `REQUEST_BODY_LIMIT` looked to a client exactly like a broken
 * server. body-parser's `type` is what names these: it is a stable part of its
 * API, unlike the message text.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  const type = (err as Error & { type?: string }).type;

  if (type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request was too large. Send less data.' });
  }
  if (type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'That request body could not be read as JSON.' });
  }
  if (err?.message === 'Origin not allowed by CORS policy') {
    return res.status(403).json({ error: 'CORS origin denied' });
  }

  console.error('Unhandled error:', err?.message);
  return res.status(500).json({ error: 'Internal server error' });
}
