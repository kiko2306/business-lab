/*
 * Dev tool, NOT run by `npm test`. Hits the live store search pages once
 * for a curated set of product names and records every candidate they
 * return (parsed down to the JSON-serialisable fields selectBestCandidate
 * needs — see scrapers.parseCandidate) into fixtures/candidates.json.
 *
 * match.test.js then replays selectBestCandidate against that snapshot with
 * zero network, so the matching heuristics can be tuned and regression-
 * checked without re-scraping. Re-run this only to refresh the snapshot
 * (a store changed its markup, or the curated list changed):
 *
 *   node test/capture.js
 *
 * Sequential across products, parallel across a product's 4 stores — same
 * shape as the app's own refresh, to keep the load on the store sites the
 * same as a normal run.
 */
const fs = require('fs');
const path = require('path');
const { STORES, listStoreCandidates } = require('../scrapers');

// Curated to cover every failure class found live (wrong product class,
// processed-form-beats-plain, size/unit-basis, punctuation in the name,
// store-vocabulary gaps) plus a spread of known-good controls that must
// keep matching. Names are verbatim from the real 300-item list.
const NAMES = [
  // --- known or suspected mismatches ---
  'Iogurtes naturais', 'Iogurtes gregos', 'Iogurtes líquidos',
  'Queijo da Serra', 'Queijo da Beira Baixa', 'Mel de abelha',
  'Canela em pó', 'Tangerinas', 'Pêras', 'Morangos', 'Melão', 'Alface',
  'Cenouras', 'Vinagre de vinho branco', 'Peito de frango', 'Sal fino',
  'Café solúvel', 'Café em cápsulas', 'Molho de soja', 'Bacalhau seco',
  'Papel higiénico (rolo duplo)', 'Ração húmida para cão em lata',
  'Bombons', 'Cerveja sem álcool', 'Pasta de dentes whitening',
  'Sardinhas em lata', 'Passas de uva', 'Muffins', 'Queques',
  'Azeitonas pretas galegas', 'Espuma de barbear', 'Molas para a roupa',
  'Champô de bebé "não chora mais"', 'Paprika (colorau)', 'Papos-secos',
  'Gelo em cubo (saco)', 'Achocolatado em pó (Nesquik)',
  // --- known-good controls (must stay matched / must not regress) ---
  'Bananas', 'Maçãs Gala', 'Maçãs Fuji', 'Leite meio gordo',
  'Leite sem lactose', 'Açúcar branco', 'Arroz agulha', 'Massa esparguete',
  'Massa para lasanha', 'Fermento em pó para bolos', 'Caldos de galinha',
  'Bolachas Maria', 'Postas de salmão', 'Natas para bater', 'Cebolas',
  'Tomates', 'Manteiga com sal', 'Cerveja em lata', 'Pão de forma integral',
  'Óleo de girassol', 'Ketchup', 'Amaciador de roupa', 'Coca-Cola Zero',
  'Detergente manual para a loiça (Fairy)', 'Ovos', 'Azeite virgem extra',
];

const SLEEP_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const out = {};
  let i = 0;
  for (const name of NAMES) {
    i++;
    const byStore = {};
    await Promise.all(
      Object.keys(STORES).map(async (store) => {
        try {
          byStore[store] = await listStoreCandidates(store, name, 8);
        } catch (err) {
          byStore[store] = { error: String(err && err.message) };
        }
      })
    );
    out[name] = byStore;
    const counts = Object.entries(byStore)
      .map(([s, v]) => `${s}:${Array.isArray(v) ? v.length : 'ERR'}`)
      .join(' ');
    console.log(`[${i}/${NAMES.length}] ${name}  ${counts}`);
    await sleep(SLEEP_MS);
  }
  const dir = path.join(__dirname, 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify(out, null, 1));
  console.log(`\nwrote ${path.join(dir, 'candidates.json')}  (${NAMES.length} products)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
