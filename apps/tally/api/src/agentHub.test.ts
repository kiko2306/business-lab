import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'path';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { AgentHub } from './agentHub';
import { createApp } from './app';
import { migrate } from './migrate';

// NOTE: this suite and api.test.ts share one database and truncate between
// tests, so package.json runs the files serially (--test-concurrency=1).
// In parallel they delete each other's rows and fail in ways that look like
// logic bugs.
//
// Stands in for the .NET shop agent, which needs Windows and the x86 Wintouch
// assemblies to build (plan.md §629) — the wire protocol is what is tested
// here, and it is the same protocol either client speaks.
const skip = !process.env.DATABASE_URL;

let pool: Pool;
let hub: AgentHub;
let server: http.Server;
let base: string;
let wsBase: string;

const ADMIN = { 'Remote-User': 'alice', 'Remote-Groups': 'admins' };

async function call(method: string, p: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** An enrolled shop plus its token, the state every test below starts from. */
async function enrolledStore(name: string): Promise<{ id: string; token: string }> {
  const store = (await call('POST', '/api/stores', { headers: ADMIN, body: { name } })).body;
  const code = (await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN })).body;
  const agent = (await call('POST', '/agent/enrol', { body: { code: code.code } })).body;
  return { id: store.id, token: agent.token };
}

/**
 * Connects a fake agent that answers every request with `reply(method)`.
 * Resolves once the socket is open *and* the hub has registered it, so a test
 * never races the registration.
 */
async function connectAgent(
  token: string,
  reply: (method: string) => { ok: boolean; data?: unknown; error?: string }
): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}/agent/connect`, { headers: { Authorization: `Bearer ${token}` } });
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    const answer = reply(frame.method);
    ws.send(JSON.stringify({ id: frame.id, ...answer }));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  for (let i = 0; i < 100 && hub.connectedStoreIds().length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return ws;
}

before(async () => {
  if (skip) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool, path.join(__dirname, 'migrations'));
  hub = new AgentHub(pool);
  server = http.createServer(createApp(pool, hub));
  hub.attach(server);
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

after(async () => {
  if (skip) return;
  await hub.close();
  await new Promise((r) => server.close(r));
  await pool.end();
});

beforeEach(async () => {
  if (skip) return;
  await hub.close();
  await pool.query('DELETE FROM stores');
});

test('an agent with a valid token connects and answers questions', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  const ws = await connectAgent(store.token, () => ({ ok: true, data: { tables: 7 } }));

  assert.equal(hub.isConnected(store.id), true);
  const res = await call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { tables: 7 });

  // The relayed method is the one the route names, not the URL segment.
  const sold = await connectAgentEcho(store, ws);
  assert.deepEqual(sold, ['overview', 'sold_items', 'tables']);
});

/** Drives all three relays and returns the methods the agent was asked for. */
async function connectAgentEcho(store: { id: string }, ws: WebSocket): Promise<string[]> {
  const seen: string[] = [];
  ws.removeAllListeners('message');
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    seen.push(frame.method);
    ws.send(JSON.stringify({ id: frame.id, ok: true, data: {} }));
  });
  await call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN });
  await call('GET', `/api/stores/${store.id}/sold-items`, { headers: ADMIN });
  await call('GET', `/api/stores/${store.id}/tables`, { headers: ADMIN });
  return seen;
}

test('the handshake is refused without a valid token', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  for (const headers of [{}, { Authorization: 'Bearer nonsense' }]) {
    const ws = new WebSocket(`${wsBase}/agent/connect`, { headers });
    const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
    // Refused before the upgrade completes, so the agent sees a plain 401
    // rather than a socket that opens and closes for no stated reason.
    assert.match(err.message, /401/);
  }
  assert.equal(hub.isConnected(store.id), false);
});

test('a revoked agent cannot reconnect', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  await call('DELETE', `/api/stores/${store.id}/agent`, { headers: ADMIN });
  const ws = new WebSocket(`${wsBase}/agent/connect`, { headers: { Authorization: `Bearer ${store.token}` } });
  const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
  assert.match(err.message, /401/);
});

test('an offline shop is a 503 that says so, not empty data', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  const res = await call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN });
  // Zeroes that look like real takings are worse than an honest failure.
  assert.equal(res.status, 503);
  assert.equal(res.body.offline, true);
});

test('an error from the agent is relayed as a 502', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  await connectAgent(store.token, () => ({ ok: false, error: 'SQL Server unreachable' }));
  const res = await call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /SQL Server unreachable/);
});

test('a reconnect replaces the old socket rather than being refused', { skip }, async () => {
  // A shop that loses its network leaves a socket that still looks healthy
  // here; without replacement it would be unreachable behind that zombie.
  const store = await enrolledStore('Baixa');
  const first = await connectAgent(store.token, () => ({ ok: true, data: { from: 'first' } }));
  const firstClosed = new Promise<void>((resolve) => first.once('close', () => resolve()));

  const second = new WebSocket(`${wsBase}/agent/connect`, {
    headers: { Authorization: `Bearer ${store.token}` },
  });
  second.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    second.send(JSON.stringify({ id: frame.id, ok: true, data: { from: 'second' } }));
  });
  await new Promise((r) => second.once('open', r));
  await firstClosed;

  const res = await call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN });
  assert.deepEqual(res.body, { from: 'second' });
  assert.equal(hub.connectedStoreIds().length, 1);
});

test('one socket serves concurrent requests', { skip }, async () => {
  // Each request carries an id the agent echoes, so replies cannot be crossed.
  const store = await enrolledStore('Baixa');
  const ws = new WebSocket(`${wsBase}/agent/connect`, {
    headers: { Authorization: `Bearer ${store.token}` },
  });
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    // Answer out of order, slowest first, to prove ids are matched not queued.
    const delay = frame.method === 'overview' ? 120 : 10;
    setTimeout(() => ws.send(JSON.stringify({ id: frame.id, ok: true, data: { method: frame.method } })), delay);
  });
  await new Promise((r) => ws.once('open', r));
  for (let i = 0; i < 100 && !hub.isConnected(store.id); i++) await new Promise((r) => setTimeout(r, 10));

  const [overview, tables] = await Promise.all([
    call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN }),
    call('GET', `/api/stores/${store.id}/tables`, { headers: ADMIN }),
  ]);
  assert.deepEqual(overview.body, { method: 'overview' });
  assert.deepEqual(tables.body, { method: 'tables' });
});

test('a dropped socket fails in-flight requests instead of hanging', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  const ws = new WebSocket(`${wsBase}/agent/connect`, {
    headers: { Authorization: `Bearer ${store.token}` },
  });
  // Never answers: the shop went away mid-question.
  ws.on('message', () => ws.terminate());
  await new Promise((r) => ws.once('open', r));
  for (let i = 0; i < 100 && !hub.isConnected(store.id); i++) await new Promise((r) => setTimeout(r, 10));

  const res = await call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN });
  assert.equal(res.status, 503);
});

test('a viewer cannot read a shop they were not granted', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  await connectAgent(store.token, () => ({ ok: true, data: { tables: 1 } }));
  const VIEWER = { 'Remote-User': 'bob', 'Remote-Groups': 'app-tally' };

  // 404, not 403 — a 403 would confirm the shop exists and let a viewer
  // enumerate shops by id.
  assert.equal((await call('GET', `/api/stores/${store.id}/overview`, { headers: VIEWER })).status, 404);

  await call('PUT', `/api/stores/${store.id}/access/bob`, { headers: ADMIN });
  assert.equal((await call('GET', `/api/stores/${store.id}/overview`, { headers: VIEWER })).status, 200);

  // A deactivated shop drops out for the viewer but not for an admin.
  await call('PATCH', `/api/stores/${store.id}`, { headers: ADMIN, body: { isActive: false } });
  assert.equal((await call('GET', `/api/stores/${store.id}/overview`, { headers: VIEWER })).status, 404);
  assert.equal((await call('GET', `/api/stores/${store.id}/overview`, { headers: ADMIN })).status, 200);
});

test('the store list reports connected separately from enrolled', { skip }, async () => {
  const store = await enrolledStore('Baixa');
  let list = (await call('GET', '/api/stores', { headers: ADMIN })).body;
  assert.equal(list[0].agentEnrolled, true);
  assert.equal(list[0].connected, false);

  await connectAgent(store.token, () => ({ ok: true, data: {} }));
  list = (await call('GET', '/api/stores', { headers: ADMIN })).body;
  assert.equal(list[0].connected, true);
});
