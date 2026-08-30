/*
 * Replays scrapers.selectBestCandidate against the recorded fixture
 * (test/fixtures/candidates.json, built by tools/capture-fixtures.js from the live
 * store search pages) — zero network. Two layers:
 *   1. every labelled (product, store) in fixtures/labels.json resolves as
 *      expected (a "todo" label is tracked but does not fail the suite);
 *   2. fixture-wide invariants that must hold for *every* pick:
 *      - the winner is relevance-valid (right product, right size)
 *      - its description shares a real word with the query
 *      - for two listings of the same product, the cheaper *per unit* wins
 *      - the overall match count does not collapse.
 *
 *   npm test   (from apps/price-compare/app)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { selectBestCandidate, _test: H } = require('../scrapers');

const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/candidates.json'), 'utf8'));
const labels = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/labels.json'), 'utf8'));
const STORES = ['continente', 'pingodoce', 'lidl', 'auchan'];

const fold = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function checkLabel(name, store, want) {
  const pool = candidates[name]?.[store];
  assert.ok(Array.isArray(pool), `${name} / ${store}: fixture has no candidate list (recapture?)`);
  const pick = selectBestCandidate(name, pool);

  if (want.expect === 'nomatch') {
    assert.equal(pick, null, `${name} / ${store}: expected NO MATCH, got "${pick && pick.name}"`);
    return;
  }
  assert.ok(pick, `${name} / ${store}: expected a match, got NO MATCH`);
  const got = fold(pick.name);
  if (want.nameIncludes) {
    assert.ok(got.includes(fold(want.nameIncludes)), `${name} / ${store}: winner "${pick.name}" should contain "${want.nameIncludes}"`);
  }
  if (want.nameExcludes) {
    assert.ok(!got.includes(fold(want.nameExcludes)), `${name} / ${store}: winner "${pick.name}" should NOT contain "${want.nameExcludes}"`);
  }
}

test('labelled (product, store) cases resolve as expected', async (t) => {
  for (const [name, byStore] of Object.entries(labels)) {
    if (name.startsWith('_')) continue;
    for (const [store, want] of Object.entries(byStore)) {
      await t.test(`${name} @ ${store}`, { todo: want.todo || undefined }, () => checkLabel(name, store, want));
    }
  }
});

// --- fixture-wide invariants -------------------------------------------
function eachPick(fn) {
  for (const [name, byStore] of Object.entries(candidates)) {
    for (const store of STORES) {
      const pool = byStore[store];
      if (!Array.isArray(pool)) continue;
      const pick = selectBestCandidate(name, pool);
      if (pick) fn(name, store, pick, pool);
    }
  }
}

test('every winner is relevance- and size-valid', () => {
  const bad = [];
  eachPick((name, store, pick) => {
    if (H.looksIrrelevant(name, pick.name)) bad.push(`${name} / ${store}: winner "${pick.name}" fails looksIrrelevant`);
    if (pick.sizeMismatch) bad.push(`${name} / ${store}: winner "${pick.name}" is a size mismatch`);
  });
  assert.deepEqual(bad, []);
});

test('every winner shares a real word with the query (description sanity)', () => {
  const bad = [];
  eachPick((name, store, pick) => {
    const q = H.significantWords(name);
    const c = H.significantWords(pick.name);
    const shared = c.some((w) => q.includes(w));
    const headMatch = c.length && q.includes(c[0]);
    if (!shared && !headMatch) bad.push(`${name} / ${store}: "${pick.name}" shares nothing with the query`);
  });
  assert.deepEqual(bad, []);
});

test('for two listings of the same product, the cheaper per unit wins', () => {
  // "same product" = identical set of significant words. Among a store's
  // candidates that are relevance-valid, same pack tier, and name-identical
  // to the winner, none may have a strictly better rankMetric (unit price
  // where sized, else total) — barring a sub-half-median glitch price.
  const bad = [];
  eachPick((name, store, pick, pool) => {
    const key = (s) => H.significantWords(s).slice().sort().join(' ');
    const winnerKey = key(pick.name);
    const siblings = pool.filter(
      (c) =>
        c.price != null &&
        c.name &&
        c.url !== pick.url &&
        Boolean(c.isPack) === Boolean(pick.isPack) &&
        key(c.name) === winnerKey &&
        !H.looksIrrelevant(name, c.name) &&
        !c.sizeMismatch
    );
    if (!siblings.length) return;
    const value = H.rankMetric([pick, ...siblings]);
    const prices = [pick, ...siblings].map(value).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    for (const s of siblings) {
      if (value(s) < value(pick) && value(s) >= median * 0.5) {
        bad.push(
          `${name} / ${store}: picked "${pick.name}" @ ${value(pick).toFixed(4)} but "${s.name}" is cheaper per unit @ ${value(s).toFixed(4)}`
        );
      }
    }
  });
  assert.deepEqual(bad, []);
});

test('a pack is never chosen while a valid single-unit candidate exists', () => {
  const bad = [];
  eachPick((name, store, pick, pool) => {
    if (!pick.isPack) return;
    const validSingle = pool.some(
      (c) => c.price != null && c.name && !c.isPack && !H.looksIrrelevant(name, c.name) && !c.sizeMismatch
    );
    if (validSingle) bad.push(`${name} / ${store}: picked pack "${pick.name}" despite a valid single-unit option`);
  });
  assert.deepEqual(bad, []);
});

test('overall match count stays healthy across the whole fixture', () => {
  let pairs = 0;
  let picks = 0;
  eachPick(() => picks++);
  for (const byStore of Object.values(candidates)) for (const s of STORES) if (Array.isArray(byStore[s])) pairs++;
  // Baseline for the current fixture: ~140 / 212. A drop well below this
  // means the heuristics turned too aggressive; re-baseline whenever
  // capture.js's NAMES list changes.
  assert.ok(picks >= 128, `only ${picks}/${pairs} pairs matched (floor 128) — heuristics too aggressive?`);
});
