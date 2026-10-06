import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { subscribe, unsubscribeByToken, resubscribeByToken } from '../services/advertSubscribers';
import { getDashboardBaseUrl } from '../utils/generalSettings';
import router from './subscribers';

vi.mock('../services/advertSubscribers', () => ({
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribeByToken: vi.fn().mockResolvedValue(undefined),
  resubscribeByToken: vi.fn().mockResolvedValue(undefined),
  senderFromBaseUrl: (url: string | null) => (url ? new URL(url).host : null),
}));
vi.mock('../utils/generalSettings', () => ({ getDashboardBaseUrl: vi.fn() }));

const mockedSubscribe = vi.mocked(subscribe);
const mockedUnsubscribe = vi.mocked(unsubscribeByToken);

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

// plan.md §854 fix 1: opening the link must not unsubscribe anyone. Mail gateways
// (Safe Links, Proofpoint, Mimecast) open links in a browser that runs scripts, so a
// GET that mutates would remove a customer who never tapped anything.
describe('unsubscribe is a POST, never a GET', () => {
  let server: Server;
  let baseUrl: string;
  const token = 'A'.repeat(43);

  beforeEach(async () => {
    mockedUnsubscribe.mockClear();
    const app = express();
    app.use(express.json());
    app.use('/', router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('unsubscribes on POST and answers 204', async () => {
    const res = await fetch(`${baseUrl}/unsubscribe/${token}`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(mockedUnsubscribe).toHaveBeenCalledWith(token);
  });

  it('does nothing on GET, however the link is opened', async () => {
    const res = await fetch(`${baseUrl}/unsubscribe/${token}`);
    expect(res.status).toBe(404);
    expect(mockedUnsubscribe).not.toHaveBeenCalled();
  });

  it('rejects a malformed token before touching the database', async () => {
    const res = await fetch(`${baseUrl}/unsubscribe/not-a-token`, { method: 'POST' });
    expect(res.status).toBe(422);
    expect(mockedUnsubscribe).not.toHaveBeenCalled();
  });
});

// plan.md §854 fix 2.
describe('sender and resubscribe', () => {
  let server: Server;
  let baseUrl: string;
  const token = 'B'.repeat(43);

  beforeEach(async () => {
    vi.mocked(resubscribeByToken).mockClear();
    const app = express();
    app.use(express.json());
    app.use('/', router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /sender says whose emails these are, without touching any subscriber', async () => {
    vi.mocked(getDashboardBaseUrl).mockResolvedValue('https://dash.example.com');
    const res = await fetch(`${baseUrl}/sender`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sender: 'dash.example.com' });
    expect(mockedUnsubscribe).not.toHaveBeenCalled();
  });

  it('GET /sender is null, not an error, when the dashboard URL is unknown', async () => {
    vi.mocked(getDashboardBaseUrl).mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/sender`);
    expect(await res.json()).toEqual({ sender: null });
  });

  it('POST /resubscribe/:token undoes a mistaken unsubscribe: 204', async () => {
    const res = await fetch(`${baseUrl}/resubscribe/${token}`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(resubscribeByToken).toHaveBeenCalledWith(token);
  });

  it('a GET on /resubscribe does nothing, for the same scanner reason as unsubscribe', async () => {
    const res = await fetch(`${baseUrl}/resubscribe/${token}`);
    expect(res.status).toBe(404);
    expect(resubscribeByToken).not.toHaveBeenCalled();
  });

  it('rejects a malformed token on resubscribe', async () => {
    const res = await fetch(`${baseUrl}/resubscribe/nope`, { method: 'POST' });
    expect(res.status).toBe(422);
    expect(resubscribeByToken).not.toHaveBeenCalled();
  });
});
