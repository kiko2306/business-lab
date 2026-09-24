import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Pool } from 'pg';
import { AgentHub } from './agentHub';
import { createApp } from './app';
import { migrate } from './migrate';

// Exercises the real routes against a real Postgres. Skipped with no database
// wired up so `npm test` still runs standalone; CI always provides one.
const skip = !process.env.DATABASE_URL;

let pool: Pool;
let server: Server;
let base: string;

const ADMIN = { 'Remote-User': 'alice', 'Remote-Groups': 'admins,app-tally' };
const VIEWER = { 'Remote-User': 'bob', 'Remote-Groups': 'app-tally' };

async function call(
  method: string,
  path_: string,
  opts: { headers?: Record<string, string>; body?: unknown; token?: string } = {}
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path_}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const createStore = async (name: string) =>
  (await call('POST', '/api/stores', { headers: ADMIN, body: { name } })).body;

before(async () => {
  if (skip) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool, path.join(__dirname, 'migrations'));
  // A stand-in for the setup exe the Dockerfile builds into the image (plan.md §670).
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-agent-'));
  fs.writeFileSync(path.join(agentDir, 'Tally.Agent-Setup-1.0.0-abcd1234.exe'), 'MZ-fake');
  fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify({ version: '1.0.0-abcd1234', file: 'Tally.Agent-Setup-1.0.0-abcd1234.exe' }));
  process.env.AGENT_DIST = agentDir;
  // No hub.attach here: these tests never open a socket, and the store list
  // only asks it whether one is connected.
  server = createApp(pool, new AgentHub(pool)).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (skip) return;
  await new Promise((r) => server.close(r));
  await pool.end();
});

beforeEach(async () => {
  if (skip) return;
  // stores cascades to access, agents and codes.
  await pool.query('DELETE FROM stores');
  await pool.query('DELETE FROM smtp_settings');
});

test('unauthenticated callers get nothing', { skip }, async () => {
  assert.equal((await call('GET', '/api/stores')).status, 401);
  assert.equal((await call('POST', '/api/stores', { body: { name: 'x' } })).status, 401);
});

test('/api/me reports who you are and whether you administer', { skip }, async () => {
  // The UI uses this to decide what to render; the server still enforces every
  // admin route, so this is only ever about what to show.
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.deepEqual((await call('GET', '/api/me', { headers: ADMIN })).body, { user: 'alice', isAdmin: true });
  assert.deepEqual((await call('GET', '/api/me', { headers: VIEWER })).body, { user: 'bob', isAdmin: false });
});

test('a viewer cannot administer', { skip }, async () => {
  // The important one: a viewer who could mint an enrolment code could enrol
  // an agent of their own and read a shop they were never granted.
  const store = await createStore('Baixa');
  assert.equal((await call('POST', '/api/stores', { headers: VIEWER, body: { name: 'x' } })).status, 403);
  assert.equal((await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: VIEWER })).status, 403);
  assert.equal((await call('DELETE', `/api/stores/${store.id}`, { headers: VIEWER })).status, 403);
});

test('store create, rename, deactivate, delete', { skip }, async () => {
  const store = await createStore('Baixa');
  assert.equal(store.name, 'Baixa');
  assert.equal(store.isActive, true);

  assert.equal((await call('POST', '/api/stores', { headers: ADMIN, body: { name: 'Baixa' } })).status, 409);
  assert.equal((await call('POST', '/api/stores', { headers: ADMIN, body: { name: '  ' } })).status, 400);

  const renamed = await call('PATCH', `/api/stores/${store.id}`, { headers: ADMIN, body: { name: 'Baixa 2' } });
  assert.equal(renamed.body.name, 'Baixa 2');
  // A partial update must not null the field it did not mention.
  assert.equal(renamed.body.isActive, true);

  const off = await call('PATCH', `/api/stores/${store.id}`, { headers: ADMIN, body: { isActive: false } });
  assert.equal(off.body.isActive, false);
  assert.equal(off.body.name, 'Baixa 2');

  assert.equal((await call('DELETE', `/api/stores/${store.id}`, { headers: ADMIN })).status, 204);
  assert.equal((await call('DELETE', `/api/stores/${store.id}`, { headers: ADMIN })).status, 404);
});

test('a viewer sees only granted, active stores', { skip }, async () => {
  const granted = await createStore('Granted');
  await createStore('Not granted');
  const hidden = await createStore('Granted but off');

  await call('PUT', `/api/stores/${granted.id}/access/bob`, { headers: ADMIN });
  await call('PUT', `/api/stores/${hidden.id}/access/bob`, { headers: ADMIN });
  await call('PATCH', `/api/stores/${hidden.id}`, { headers: ADMIN, body: { isActive: false } });

  const mine = await call('GET', '/api/stores', { headers: VIEWER });
  assert.deepEqual(mine.body.map((s: { name: string }) => s.name), ['Granted']);

  // An admin still sees the deactivated one, or it could never be turned back on.
  const all = await call('GET', '/api/stores', { headers: ADMIN });
  assert.equal(all.body.length, 3);
});

test('granting access twice is not an error', { skip }, async () => {
  const store = await createStore('Baixa');
  assert.equal((await call('PUT', `/api/stores/${store.id}/access/bob`, { headers: ADMIN })).status, 204);
  assert.equal((await call('PUT', `/api/stores/${store.id}/access/bob`, { headers: ADMIN })).status, 204);
  assert.deepEqual((await call('GET', `/api/stores/${store.id}/access`, { headers: ADMIN })).body, ['bob']);

  await call('DELETE', `/api/stores/${store.id}/access/bob`, { headers: ADMIN });
  assert.deepEqual((await call('GET', `/api/stores/${store.id}/access`, { headers: ADMIN })).body, []);
});

test('an agent enrols with a code and learns its own store', { skip }, async () => {
  const store = await createStore('Baixa');
  const issued = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  assert.equal(issued.status, 201);

  const enrolled = await call('POST', '/agent/enrol', { body: { code: issued.body.code } });
  assert.equal(enrolled.status, 201);
  assert.equal(enrolled.body.store.name, 'Baixa');

  // The store is derived from the token, never configured on the agent (§627).
  const me = await call('GET', '/agent/me', { token: enrolled.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.store.id, store.id);

  // Calling refreshes last_seen_at, which is what replaced conn_logs.
  const seen = await pool.query('SELECT last_seen_at FROM agents WHERE id = $1', [enrolled.body.agentId]);
  assert.ok(seen.rows[0].last_seen_at instanceof Date);
});

test('a code works once, and typos in spacing or case still work', { skip }, async () => {
  const store = await createStore('Baixa');
  const { body } = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });

  const messy = ` ${body.code.toLowerCase().slice(0, 4)}-${body.code.toLowerCase().slice(4)} `;
  assert.equal((await call('POST', '/agent/enrol', { body: { code: messy } })).status, 201);
  // Second use of the same code is refused — this is what stops a code leaking
  // from an email or a screen share enrolling a second machine.
  assert.equal((await call('POST', '/agent/enrol', { body: { code: body.code } })).status, 401);
});

test('an expired code is refused', { skip }, async () => {
  const store = await createStore('Baixa');
  const { body } = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  await pool.query(`UPDATE enrolment_codes SET expires_at = now() - interval '1 minute'`);
  assert.equal((await call('POST', '/agent/enrol', { body: { code: body.code } })).status, 401);
});

test('re-issuing a code kills the previous one', { skip }, async () => {
  const store = await createStore('Baixa');
  const first = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  const second = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  // Otherwise an admin who re-issues after a mistype leaves a live code adrift.
  assert.equal((await call('POST', '/agent/enrol', { body: { code: first.body.code } })).status, 401);
  assert.equal((await call('POST', '/agent/enrol', { body: { code: second.body.code } })).status, 201);
});

test('revoking stops the agent on its very next call', { skip }, async () => {
  const store = await createStore('Baixa');
  const { body: code } = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  const { body: agent } = await call('POST', '/agent/enrol', { body: { code: code.code } });
  assert.equal((await call('GET', '/agent/me', { token: agent.token })).status, 200);

  assert.equal((await call('DELETE', `/api/stores/${store.id}/agent`, { headers: ADMIN })).status, 204);
  assert.equal((await call('GET', '/agent/me', { token: agent.token })).status, 401);
  // Nothing left to revoke.
  assert.equal((await call('DELETE', `/api/stores/${store.id}/agent`, { headers: ADMIN })).status, 404);
});

test('a store can be re-enrolled after revocation', { skip }, async () => {
  // The case a plain UNIQUE(store_id) would have broken for ever: the revoked
  // row stays for history, so only *active* agents are constrained.
  const store = await createStore('Baixa');
  const c1 = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  const a1 = await call('POST', '/agent/enrol', { body: { code: c1.body.code } });
  await call('DELETE', `/api/stores/${store.id}/agent`, { headers: ADMIN });

  const c2 = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  const a2 = await call('POST', '/agent/enrol', { body: { code: c2.body.code } });
  assert.equal(a2.status, 201);
  assert.equal((await call('GET', '/agent/me', { token: a2.body.token })).status, 200);
  assert.equal((await call('GET', '/agent/me', { token: a1.body.token })).status, 401);
});

test('re-enrolling without revoking first replaces the old agent', { skip }, async () => {
  // The rebuilt-machine case: the admin issues a new code rather than thinking
  // to revoke. The old token must stop working at that moment regardless.
  const store = await createStore('Baixa');
  const c1 = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  const a1 = await call('POST', '/agent/enrol', { body: { code: c1.body.code } });
  const c2 = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  const a2 = await call('POST', '/agent/enrol', { body: { code: c2.body.code } });

  assert.equal((await call('GET', '/agent/me', { token: a2.body.token })).status, 200);
  assert.equal((await call('GET', '/agent/me', { token: a1.body.token })).status, 401);
});

test('a bad or missing agent token is refused', { skip }, async () => {
  assert.equal((await call('GET', '/agent/me')).status, 401);
  assert.equal((await call('GET', '/agent/me', { token: 'nonsense' })).status, 401);
  // An agent token is not an admin credential.
  assert.equal((await call('GET', '/api/stores')).status, 401);
});

test('deleting a store takes its agent and grants with it', { skip }, async () => {
  const store = await createStore('Baixa');
  await call('PUT', `/api/stores/${store.id}/access/bob`, { headers: ADMIN });
  const { body: code } = await call('POST', `/api/stores/${store.id}/enrolment-code`, { headers: ADMIN });
  const { body: agent } = await call('POST', '/agent/enrol', { body: { code: code.code } });

  await call('DELETE', `/api/stores/${store.id}`, { headers: ADMIN });
  assert.equal((await call('GET', '/agent/me', { token: agent.token })).status, 401);
  const left = await pool.query('SELECT count(*)::int AS n FROM store_access WHERE store_id = $1', [store.id]);
  assert.equal(left.rows[0].n, 0);
});

test('a malformed id is a 404, not a 500', { skip }, async () => {
  assert.equal((await call('PATCH', '/api/stores/not-a-uuid', { headers: ADMIN, body: { name: 'x' } })).status, 404);
  assert.equal((await call('DELETE', '/api/stores/not-a-uuid', { headers: ADMIN })).status, 404);
  assert.equal((await call('POST', '/api/stores/not-a-uuid/enrolment-code', { headers: ADMIN })).status, 404);
});

test('a viewer cannot see or change the SMTP sender', { skip }, async () => {
  assert.equal((await call('GET', '/api/smtp')).status, 401);
  assert.equal((await call('GET', '/api/smtp', { headers: VIEWER })).status, 403);
  assert.equal(
    (await call('PUT', '/api/smtp', { headers: VIEWER, body: { host: 'x', fromAddress: 'a@b.c' } })).status,
    403
  );
});

test('an admin saves the SMTP sender, and a blank password keeps the stored one', { skip }, async () => {
  const unset = await call('GET', '/api/smtp', { headers: ADMIN });
  assert.equal(unset.body.configured, false);

  const saved = await call('PUT', '/api/smtp', {
    headers: ADMIN,
    body: { host: 'smtp.example.com', username: 'shop', password: 'secret', fromAddress: 'shop@example.com' },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.passwordConfigured, true);
  assert.equal(saved.body.port, 587);
  assert.equal(saved.body.encryption, 'tls');

  // Re-saving without a password must not blank out the one already stored.
  const resaved = await call('PUT', '/api/smtp', {
    headers: ADMIN,
    body: { host: 'smtp.example.com', username: 'shop', fromAddress: 'shop@example.com', fromName: 'The Shop' },
  });
  assert.equal(resaved.body.passwordConfigured, true);
  assert.equal(resaved.body.fromName, 'The Shop');
  const { rows } = await pool.query('SELECT password FROM smtp_settings WHERE id = 1');
  assert.equal(rows[0].password, 'secret');
});

test('SMTP settings reject a missing host or from address', { skip }, async () => {
  assert.equal((await call('PUT', '/api/smtp', { headers: ADMIN, body: { fromAddress: 'a@b.c' } })).status, 400);
  assert.equal((await call('PUT', '/api/smtp', { headers: ADMIN, body: { host: 'smtp.example.com' } })).status, 400);
});

test('testing an unconfigured SMTP sender fails without dialing anywhere', { skip }, async () => {
  const result = await call('POST', '/api/smtp/test', { headers: ADMIN });
  assert.equal(result.status, 400);
});

test('the agent package is admin-only and downloads the built setup exe', { skip }, async () => {
  assert.equal((await call('GET', '/api/agent-package')).status, 401);
  assert.equal((await call('GET', '/api/agent-package', { headers: VIEWER })).status, 403);
  assert.equal((await call('GET', '/api/agent-package/download', { headers: VIEWER })).status, 403);

  const meta = await call('GET', '/api/agent-package', { headers: ADMIN });
  assert.equal(meta.body.version, '1.0.0-abcd1234');

  const res = await fetch(`${base}/api/agent-package/download`, { headers: ADMIN });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /Tally\.Agent-Setup-1\.0\.0-abcd1234\.exe/);
  assert.equal(await res.text(), 'MZ-fake');
});
