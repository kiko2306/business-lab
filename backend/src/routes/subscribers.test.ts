import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { subscribe } from '../services/advertSubscribers';
import router from './subscribers';

vi.mock('../services/advertSubscribers', () => ({
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribeByToken: vi.fn().mockResolvedValue(undefined),
}));

const mockedSubscribe = vi.mocked(subscribe);

// Regression test for the real bug found in plan.md §702: the route is
// built for a plain HTML <form method="post">, whose default enctype is
// urlencoded, not JSON — but only express.json() was registered, so a real
// form submit got back "email is required" no matter what was typed in.
describe('POST /subscribers with a urlencoded body (as a real HTML form sends it)', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    mockedSubscribe.mockClear();
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use('/', router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('parses the email field instead of rejecting it as missing', async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'guest@example.com' }).toString(),
    });

    expect(res.status).toBe(200);
    expect(mockedSubscribe).toHaveBeenCalledWith('guest@example.com');
  });
});
