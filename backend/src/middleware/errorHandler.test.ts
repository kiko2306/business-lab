import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { errorHandler } from './errorHandler';

function capture() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, sent };
}

const handle = (error: unknown) => {
  const { res, sent } = capture();
  errorHandler(error as Error, {} as Request, res, (() => {}) as NextFunction);
  return sent;
};

describe('errorHandler', () => {
  it('answers 413 for a body over the limit, not 500', () => {
    // plan.md §884 item 4. body-parser throws this when a request exceeds
    // REQUEST_BODY_LIMIT (32 kb). It used to fall through to the generic 500,
    // so a client could not tell "you sent too much" from "the server broke".
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    expect(handle(tooLarge)).toEqual({
      status: 413,
      body: { error: 'That request was too large. Send less data.' },
    });
  });

  it('answers 400 for a body that is not valid JSON', () => {
    const malformed = Object.assign(new SyntaxError('Unexpected token } in JSON at position 4'), {
      type: 'entity.parse.failed',
      status: 400,
    });
    expect(handle(malformed)).toEqual({
      status: 400,
      body: { error: 'That request body could not be read as JSON.' },
    });
  });

  it('keeps the CORS denial on 403', () => {
    expect(handle(new Error('Origin not allowed by CORS policy'))).toEqual({
      status: 403,
      body: { error: 'CORS origin denied' },
    });
  });

  it('answers 500 for anything else, and logs it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handle(new Error('pool exhausted'))).toEqual({
      status: 500,
      body: { error: 'Internal server error' },
    });
    expect(logged.mock.calls.flat().join(' ')).toContain('pool exhausted');
    logged.mockRestore();
  });

  it('does not leak a client error into the log, only a real one', () => {
    // A 32 kb upload and a bad paste are the caller's business, not a fault
    // worth a line in the backend log on every occurrence.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    handle(Object.assign(new Error('request entity too large'), { type: 'entity.too.large' }));
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
