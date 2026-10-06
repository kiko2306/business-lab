import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { addSubscriber, listAllSubscribers, removeSubscriber } from '../services/advertSubscribers';
import router from './subscriberAdmin';

vi.mock('../services/advertSubscribers', () => ({
  listAllSubscribers: vi.fn(),
  addSubscriber: vi.fn(),
  removeSubscriber: vi.fn(),
}));

const mockedList = vi.mocked(listAllSubscribers);
const mockedAdd = vi.mocked(addSubscriber);
const mockedRemove = vi.mocked(removeSubscriber);

// plan.md §847 / §845 fix 2: the dashboard's subscriber list. Capability gating
// (`settings:manage`) is applied where the router is mounted in index.ts.
describe('subscriber admin routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
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

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('lists everyone, with their status', async () => {
    mockedList.mockResolvedValueOnce([{ id: 1, email: 'a@example.com', subscribedAt: 'x', unsubscribedAt: null }]);
    const res = await send('GET', '/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscribers: [{ id: 1, email: 'a@example.com', subscribedAt: 'x', unsubscribedAt: null }] });
  });

  it('adds an address: 201 when new, 200 when already there', async () => {
    mockedAdd.mockResolvedValueOnce('added');
    expect((await send('POST', '/', { email: 'new@example.com' })).status).toBe(201);
    mockedAdd.mockResolvedValueOnce('exists');
    expect((await send('POST', '/', { email: 'new@example.com' })).status).toBe(200);
    expect(mockedAdd).toHaveBeenCalledWith('new@example.com');
  });

  it('refuses to resubscribe someone who opted out, and says why', async () => {
    mockedAdd.mockResolvedValueOnce('unsubscribed');
    const res = await send('POST', '/', { email: 'gone@example.com' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/unsubscribed/i);
  });

  it('rejects a malformed address before touching the database', async () => {
    const res = await send('POST', '/', { email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('removes one subscriber: 204, or 404 when it is gone already', async () => {
    mockedRemove.mockResolvedValueOnce(true);
    expect((await send('DELETE', '/4')).status).toBe(204);
    expect(mockedRemove).toHaveBeenCalledWith(4);
    mockedRemove.mockResolvedValueOnce(false);
    expect((await send('DELETE', '/4')).status).toBe(404);
  });

  it('rejects a non-numeric id', async () => {
    expect((await send('DELETE', '/abc')).status).toBe(422);
    expect(mockedRemove).not.toHaveBeenCalled();
  });
});
