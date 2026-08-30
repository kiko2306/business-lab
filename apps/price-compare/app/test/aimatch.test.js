/*
 * aiMatch.js — the optional Gemini last-resort matcher. Tests the plumbing
 * only (no real API call): the config guard, the request shape, and how a
 * reply is parsed into a candidate index. The model's actual judgement is
 * not something to unit-test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const NAMES = ['Chocolate em Pó Nesquik', 'Bolachas de Chocolate', 'Cacau em Pó'];

function loadFresh(env) {
  for (const k of ['GEMINI_API_KEY', 'GEMINI_MODEL']) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../aiMatch')];
  return require('../aiMatch');
}

function stubFetch(replyText, { ok = true, status = ok ? 200 : 400 } = {}) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), method: opts.method });
    return {
      ok,
      status,
      json: async () => ({ candidates: [{ content: { parts: [{ text: replyText }] } }] }),
    };
  };
  return calls;
}

// Fails with `status` for the first `failures` calls, then succeeds.
function stubFetchFlaky(failures, status, replyText) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (calls.length <= failures) return { ok: false, status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: replyText }] } }] }) };
  };
  return calls;
}

test('isConfigured reflects GEMINI_API_KEY', () => {
  assert.equal(loadFresh({}).isConfigured(), false);
  assert.equal(loadFresh({ GEMINI_API_KEY: 'k' }).isConfigured(), true);
});

test('pickCandidate: unconfigured -> -1, no fetch', async () => {
  const ai = loadFresh({});
  global.fetch = () => assert.fail('should not call the API when unconfigured');
  assert.equal(await ai.pickCandidate('Achocolatado em pó', NAMES), -1);
});

test('pickCandidate: parses "1" -> index 0, sends the right request', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'secret', GEMINI_MODEL: 'gemini-2.0-flash' });
  const calls = stubFetch('1');
  const idx = await ai.pickCandidate('Achocolatado em pó (Nesquik)', NAMES);
  assert.equal(idx, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /gemini-2\.0-flash:generateContent\?key=secret/);
  assert.equal(calls[0].method, 'POST');
  const prompt = calls[0].body.contents[0].parts[0].text;
  assert.match(prompt, /Achocolatado em pó \(Nesquik\)/);
  assert.match(prompt, /1\. Chocolate em Pó Nesquik/);
});

test('pickCandidate: "0" / no digit / out-of-range -> -1', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'k' });
  stubFetch('0');
  assert.equal(await ai.pickCandidate('x', NAMES), -1);
  stubFetch('none of these');
  assert.equal(await ai.pickCandidate('x', NAMES), -1);
  stubFetch('99');
  assert.equal(await ai.pickCandidate('x', NAMES), -1);
});

test('pickCandidate: tolerates a chatty reply, takes the first number', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'k' });
  stubFetch('The best match is 2.');
  assert.equal(await ai.pickCandidate('x', NAMES), 1);
});

test('pickCandidate: API error or throw -> -1 (never worse than no AI)', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'k' });
  stubFetch('1', { ok: false, status: 400 });
  assert.equal(await ai.pickCandidate('x', NAMES), -1);
  global.fetch = async () => {
    throw new Error('network down');
  };
  assert.equal(await ai.pickCandidate('x', NAMES), -1);
});

test('pickCandidate: retries a 429 and succeeds on the retry', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'k' });
  const calls = stubFetchFlaky(1, 429, '2');
  assert.equal(await ai.pickCandidate('x', NAMES), 1);
  assert.equal(calls.length, 2); // one rate-limited, one good
});

test('pickCandidate: gives up after the retry budget on persistent 429', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'k' });
  const calls = stubFetchFlaky(99, 429, '1');
  assert.equal(await ai.pickCandidate('x', NAMES), -1);
  assert.equal(calls.length, 3); // initial + 2 retries
});

test('pickCandidate: a non-retryable status is not retried', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'k' });
  const calls = stubFetchFlaky(99, 400, '1');
  assert.equal(await ai.pickCandidate('x', NAMES), -1);
  assert.equal(calls.length, 1);
});

test('pickCandidate: empty candidate list -> -1', async () => {
  const ai = loadFresh({ GEMINI_API_KEY: 'k' });
  global.fetch = () => assert.fail('nothing to ask about');
  assert.equal(await ai.pickCandidate('x', []), -1);
});

test.after(() => {
  delete global.fetch;
  for (const k of ['GEMINI_API_KEY', 'GEMINI_MODEL']) delete process.env[k];
  delete require.cache[require.resolve('../aiMatch')];
});
