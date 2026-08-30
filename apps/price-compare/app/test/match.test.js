/*
 * Replays scrapers.selectBestCandidate against the recorded fixture
 * (test/fixtures/candidates.json, built by test/capture.js from the live
 * store search pages) — zero network. Guards the matching heuristics
 * against regression: the labelled cases in fixtures/labels.json must hold,
 * and the overall number of matches must not collapse.
 *
 *   npm test            (from apps/price-compare/app)
 *   node --test test/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { selectBestCandidate } = require('../scrapers');

const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/candidates.json'), 'utf8'));
const labels = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/labels.json'), 'utf8'));
const STORES = ['continente', 'pingodoce', 'lidl', 'auchan'];

const fold = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

test('labelled (product, store) cases resolve as expected', () => {
  const failures = [];
  for (const [name, byStore] of Object.entries(labels)) {
    if (name.startsWith('_')) continue;
    for (const [store, want] of Object.entries(byStore)) {
      const pool = candidates[name]?.[store];
      if (!Array.isArray(pool)) {
        failures.push(`${name} / ${store}: fixture has no candidate list (recapture?)`);
        continue;
      }
      const pick = selectBestCandidate(name, pool);

      if (want.expect === 'nomatch') {
        if (pick) failures.push(`${name} / ${store}: expected NO MATCH, got "${pick.name}" (${pick.price})`);
        continue;
      }
      // expect: 'match'
      if (!pick) {
        failures.push(`${name} / ${store}: expected a match, got NO MATCH`);
        continue;
      }
      const got = fold(pick.name);
      if (want.nameIncludes && !got.includes(fold(want.nameIncludes))) {
        failures.push(`${name} / ${store}: winner "${pick.name}" should contain "${want.nameIncludes}"`);
      }
      if (want.nameExcludes && got.includes(fold(want.nameExcludes))) {
        failures.push(`${name} / ${store}: winner "${pick.name}" should NOT contain "${want.nameExcludes}"`);
      }
    }
  }
  assert.deepEqual(failures, [], `\n  - ${failures.join('\n  - ')}\n`);
});

test('overall match count stays healthy across the whole fixture', () => {
  let pairs = 0;
  let picks = 0;
  for (const [name, byStore] of Object.entries(candidates)) {
    for (const store of STORES) {
      const pool = byStore[store];
      if (!Array.isArray(pool)) continue;
      pairs++;
      if (selectBestCandidate(name, pool)) picks++;
    }
  }
  // Baseline for the current fixture: 143 / 212 (the fixture skews toward
  // hard cases — pure always-match controls were pruned). A drop well below
  // this means the heuristics turned too aggressive and are rejecting real
  // matches; investigate before lowering the floor. Re-baseline whenever
  // capture.js's NAMES list changes.
  assert.ok(picks >= 130, `only ${picks}/${pairs} pairs matched (floor 130) — heuristics too aggressive?`);
});

test('no candidate is picked for a query with nothing in common', () => {
  // "Iogurtes naturais" against a totally unrelated pool must be NO MATCH.
  const unrelated = candidates['Molas para a roupa']?.continente || [];
  assert.equal(selectBestCandidate('Iogurtes naturais', unrelated), null);
});
