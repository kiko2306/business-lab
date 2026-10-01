import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { createStreamTicket, sseHandler } from './realtime';

vi.mock('./status', () => ({ getAllServiceStatus: vi.fn().mockResolvedValue({ timestamp: '', services: [] }) }));

function mockRes() {
  const listeners: Record<string, () => void> = {};
  return {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    // Not exercised here — sseHandler's caller (Express) wires req.on('close', ...).
    _listeners: listeners,
  } as unknown as Response;
}

function mockReq(ticket: string): { req: Request; close: () => void } {
  let closeHandler: (() => void) | undefined;
  const req = {
    query: { ticket },
    headers: {},
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') closeHandler = cb;
    }),
  } as unknown as Request;
  return { req, close: () => closeHandler?.() };
}

// plan.md §792: found live — nginx buffers the proxied SSE response by
// default, so the browser never sees a byte until the buffer fills, however
// promptly the backend calls res.write(). X-Accel-Buffering: no is nginx's
// own documented per-response opt-out; verifying it's set is the only way
// this bug is visible from the backend side (nginx's own behavior isn't
// unit-testable here).
describe('sseHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tells nginx not to buffer the stream', async () => {
    const { req, close } = mockReq(createStreamTicket(1));
    const res = mockRes();
    await sseHandler(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'X-Accel-Buffering': 'no' })
    );
    close(); // clears sseHandler's setInterval so it doesn't leak past this test
  });
});
