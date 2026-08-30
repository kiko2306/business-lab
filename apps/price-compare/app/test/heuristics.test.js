/*
 * Unit tests for the pure matching/pricing helpers in scrapers.js — no
 * network, no fixture. Covers the requirements the search has to meet:
 *   - the item returned is actually the queried product (relevance)
 *   - its description / size is parsed correctly
 *   - "cheapest" means cheapest per unit, then cheapest in the store
 *
 *   npm test   (from apps/price-compare/app)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { selectBestCandidate, _test: H } = require('../scrapers');

// --- query sanitization ---------------------------------------------------
test('sanitizeSearchQuery folds accents and punctuation to spaces, keeps digits', () => {
  assert.equal(H.sanitizeSearchQuery('Açúcar'), 'acucar');
  assert.equal(H.sanitizeSearchQuery('Champô de bebé "não chora mais"'), 'champo de bebe nao chora mais');
  assert.equal(H.sanitizeSearchQuery('Paprika (colorau)'), 'paprika colorau');
  assert.equal(H.sanitizeSearchQuery('Papos-secos'), 'papos secos');
  assert.equal(H.sanitizeSearchQuery('Coca-Cola Zero 1,5L'), 'coca cola zero 1 5l');
  assert.equal(H.sanitizeSearchQuery('  leading/trailing  '), 'leading trailing');
});

test('normalizeText lowercases, strips accents, folds punctuation', () => {
  assert.equal(H.normalizeText('Iogurte Grego / Natural'), 'iogurte grego natural');
  assert.equal(H.normalizeText('sem-glúten'), 'sem gluten');
});

// --- Portuguese plural stemming -----------------------------------------
test('stemWord reduces regular and irregular Portuguese plurals', () => {
  assert.equal(H.stemWord('bananas'), 'banana');
  assert.equal(H.stemWord('tomates'), 'tomate');
  assert.equal(H.stemWord('limoes'), 'limao'); // limões, accent already stripped
  assert.equal(H.stemWord('paes'), 'pao'); // pães
  assert.equal(H.stemWord('naturais'), 'natural');
  assert.equal(H.stemWord('gas'), 'gas'); // <=3 letters: left alone
  assert.equal(H.stemWord('arroz'), 'arroz'); // ends in z, not touched
  // Known limitation: a longer singular ending in "s" ("lápis", "atum" is
  // fine, "lápis" is not) still loses the "s" — no dictionary. None such
  // in the grocery list; documented in plan.md §36.
  assert.equal(H.stemWord('lapis'), 'lapi');
});

test('significantWords drops stopwords and short words, then stems', () => {
  assert.deepEqual(H.significantWords('Iogurtes naturais sem açúcar'), ['iogurte', 'natural', 'acucar']);
  assert.deepEqual(H.significantWords('Pão de forma'), ['pao', 'forma']);
  assert.deepEqual(H.significantWords('1,5 L'), []); // nothing significant
});

// --- negation awareness ------------------------------------------------
test('negatedWords / hasNegatedQueryWord', () => {
  assert.deepEqual([...H.negatedWords('bebida sem açúcar')], ['acucar']);
  // "Açúcar" query must reject a "sem açúcar" candidate...
  assert.equal(H.hasNegatedQueryWord('Açúcar branco', 'Bebida Vegetal sem Açúcar'), true);
  // ...but "Leite sem lactose" must NOT reject its own "sem lactose" match.
  assert.equal(H.hasNegatedQueryWord('Leite sem lactose', 'Leite UHT Magro sem Lactose Mimosa'), false);
});

// --- relevance filter -------------------------------------------------
test('looksIrrelevant: lead-with-a-category-noun gate', () => {
  // "Iogurtes naturais" -> the category noun "iogurte" must appear.
  assert.equal(H.looksIrrelevant('Iogurtes naturais', 'Atum ao Natural'), true);
  assert.equal(H.looksIrrelevant('Iogurtes naturais', 'Iogurte Natural Continente'), false);
  assert.equal(H.looksIrrelevant('Queijo da Serra', 'Serra Grande de Jardinagem'), true);
  assert.equal(H.looksIrrelevant('Vinagre de vinho branco', '3 Castas Vinho Branco/ Tinto'), true);
  // trailing incidental generic word must NOT be required
  assert.equal(H.looksIrrelevant('Fermento em pó para bolos', 'Fermento em Pó Royal'), false);
});

test('looksIrrelevant: head-word rule for short category-less queries', () => {
  assert.equal(H.looksIrrelevant('Mel de abelha', 'DESODORIZANTE WILD ABELHAS MEL FLOR E CACTO'), true);
  assert.equal(H.looksIrrelevant('Canela em pó', 'Café Solúvel com Canela Delta'), true);
  assert.equal(H.looksIrrelevant('Tangerinas', 'Água com Gás Tangerina Pedras Salgadas'), true);
  // a candidate that leads with the query's own word passes
  assert.equal(H.looksIrrelevant('Peito de frango', 'Peito de Frango Continente'), false);
  // cut-word-led candidate for a category-noun query still passes (bacalhau is generic)
  assert.equal(H.looksIrrelevant('Bacalhau seco', 'Postas de Bacalhau Seco'), false);
});

test('looksIrrelevant: pure-generic query still requires its one real word', () => {
  assert.equal(H.looksIrrelevant('Açúcar 1 kg', 'Arroz Agulha'), true);
  assert.equal(H.looksIrrelevant('Açúcar 1 kg', 'Açúcar Amarelo 1 kg'), false);
});

test('looksIrrelevant: nothing to judge -> not irrelevant', () => {
  assert.equal(H.looksIrrelevant('X', ''), false);
  assert.equal(H.looksIrrelevant('', 'anything'), false);
});

// --- size / pack parsing --------------------------------------------
test('parseSize reads value + unit into base units and a kind', () => {
  assert.deepEqual(H.parseSize('Açúcar 1 kg'), { value: 1000, kind: 'mass' });
  assert.deepEqual(H.parseSize('Creme Vegetal 250 gr'), { value: 250, kind: 'mass' });
  assert.deepEqual(H.parseSize('Água 1,5 L'), { value: 1500, kind: 'volume' });
  assert.deepEqual(H.parseSize('Natas 200ml'), { value: 200, kind: 'volume' });
  assert.equal(H.parseSize('sem tamanho'), null);
});

test('parseEmbSize only reads the "Emb. N unit" package label', () => {
  assert.deepEqual(H.parseEmbSize('<span>Emb. 2 kg</span> ... 1 kg = 0.85'), { value: 2000, kind: 'mass' });
  assert.equal(H.parseEmbSize('per-kg unit price 1 kg = 0.85 only'), null);
});

test('parsePackTotalSize multiplies count x per-unit size', () => {
  assert.deepEqual(H.parsePackTotalSize('Emb. 6 x 1,5 lt'), { value: 9000, kind: 'volume' });
  assert.deepEqual(H.parsePackTotalSize('emb. 8 x 125 g'), { value: 1000, kind: 'mass' });
  assert.equal(H.parsePackTotalSize('Emb. 1 kg'), null); // not an N x SIZE shape
});

test('looksLikeMultiPack detects packs from name, url or Emb. text', () => {
  assert.equal(H.looksLikeMultiPack({ name: 'Leite Pack 8x1 L', url: '', html: '' }), true);
  assert.equal(H.looksLikeMultiPack({ name: '', url: '/p/leite-meio-gordo-6x1l/p123', html: '' }), true);
  assert.equal(H.looksLikeMultiPack({ name: 'Leite Meio Gordo', url: '', html: '<div>Emb. 6 x 1 lt</div>' }), true);
  assert.equal(H.looksLikeMultiPack({ name: 'Leite Meio Gordo Mimosa', url: '/produto/x.html', html: 'Emb. 1 lt' }), false);
});

test('looksLikeSizeMismatch: only fires when both sizes known and clearly differ, same kind', () => {
  assert.equal(H.looksLikeSizeMismatch('Açúcar 1 kg', { name: 'Açúcar 2 kg', html: '', url: '' }), true);
  assert.equal(H.looksLikeSizeMismatch('Açúcar 1 kg', { name: 'Açúcar 900 g', html: '', url: '' }), false); // within 20%
  assert.equal(H.looksLikeSizeMismatch('Açúcar 1 kg', { name: 'Açúcar Amarelo', html: '', url: '' }), false); // candidate size unknown
  assert.equal(H.looksLikeSizeMismatch('Leite 1 L', { name: 'Leite 1 kg', html: '', url: '' }), false); // mass vs volume, not comparable
  assert.equal(H.looksLikeSizeMismatch('Açúcar branco', { name: 'Açúcar 2 kg', html: '', url: '' }), false); // query states no size
});

// --- candidate ranking ---------------------------------------------
test('countExtraWords ignores generic / packaging / store-name / digit words', () => {
  const q = H.significantWords('Água sem Gás Luso');
  assert.equal(H.countExtraWords(q, new Set(H.significantWords('Água sem Gás Luso'))), 0);
  assert.equal(H.countExtraWords(q, new Set(H.significantWords('Água sem Gás Luso Sport'))), 1); // "sport"
  assert.equal(H.countExtraWords(q, new Set(H.significantWords('Água sem Gás Luso Continente'))), 0); // store name is neutral
});

test('hasUnrequestedFormWord flags a processed form the query did not ask for', () => {
  const q = H.significantWords('Pêras');
  assert.equal(H.hasUnrequestedFormWord(q, H.significantWords('Bolsa de Fruta Pêra')), true); // "bolsa"
  assert.equal(H.hasUnrequestedFormWord(q, H.significantWords('Néctar de Pera Rocha')), true); // "nectar"
  assert.equal(H.hasUnrequestedFormWord(q, H.significantWords('Pera Rocha DOP Oeste')), false);
  // ...unless the query IS that form
  assert.equal(H.hasUnrequestedFormWord(H.significantWords('Sumo de laranja'), H.significantWords('Sumo Laranja 100%')), false);
});

test('pickClosestNameMatches: plain product beats an unrequested form, then fewest extra words', () => {
  const mk = (name, extra, form, head) => ({ name, extraWordCount: extra, formMismatch: form, headMismatch: head, price: 1 });
  const chosen = H.pickClosestNameMatches([
    mk('Bolsa de Fruta Pêra', 2, true, true),
    mk('Pera Rocha DOP Oeste', 3, false, true),
    mk('Néctar de Pera', 1, true, true),
  ]);
  assert.deepEqual(chosen.map((e) => e.name), ['Pera Rocha DOP Oeste']); // the only non-form one
});

// --- pricing: cheapest per unit, then cheapest in the store -----------
test('rankMetric uses unit price when every entry is comparably sized, else total', () => {
  const sized = [
    { price: 1.89, unitSizeValue: 250, unitSizeKind: 'mass' },
    { price: 3.2, unitSizeValue: 500, unitSizeKind: 'mass' },
  ];
  const m = H.rankMetric(sized);
  assert.ok(m(sized[1]) < m(sized[0])); // 6.40/kg < 7.56/kg

  const mixed = [
    { price: 1.0, unitSizeValue: 1000, unitSizeKind: 'volume' },
    { price: 0.6, unitSizeValue: null, unitSizeKind: null },
  ];
  const m2 = H.rankMetric(mixed);
  assert.equal(m2(mixed[0]), 1.0); // fell back to raw total
  assert.equal(m2(mixed[1]), 0.6);

  const crossKind = [
    { price: 1.0, unitSizeValue: 500, unitSizeKind: 'mass' },
    { price: 1.0, unitSizeValue: 500, unitSizeKind: 'volume' },
  ];
  assert.equal(H.rankMetric(crossKind)(crossKind[0]), 1.0); // total, not unit
});

test('cheapestPlausible drops a sub-half-median outlier only with 3+ entries', () => {
  const glitch = [
    { name: 'A', price: 1.2, unitSizeValue: 1000, unitSizeKind: 'mass' },
    { name: 'B', price: 1.4, unitSizeValue: 1000, unitSizeKind: 'mass' },
    { name: 'C', price: 0.3, unitSizeValue: 1000, unitSizeKind: 'mass' }, // 0.30/kg << 0.5 * median(1.20)
  ];
  assert.equal(H.cheapestPlausible(glitch).name, 'A');

  const twoOnly = [
    { name: 'A', price: 1.2, unitSizeValue: 1000, unitSizeKind: 'mass' },
    { name: 'C', price: 0.3, unitSizeValue: 1000, unitSizeKind: 'mass' },
  ];
  assert.equal(H.cheapestPlausible(twoOnly).name, 'C'); // <3 entries: no guard
});

// synthetic candidate pools through the whole selector
const C = (name, price, size = null, kind = null, isPack = false) => ({
  store: 'x', url: 'u/' + name, name, price, currency: 'EUR',
  isPack, unitSizeValue: size, unitSizeKind: kind, sizeMismatch: false,
});

test('selectBestCandidate: picks the lowest unit price, not the lowest total', () => {
  const best = selectBestCandidate('Manteiga', [
    C('Manteiga 250g', 1.89, 250, 'mass'),
    C('Manteiga 500g', 3.2, 500, 'mass'),
  ]);
  assert.equal(best.name, 'Manteiga 500g'); // 6.40/kg beats 7.56/kg
});

test('selectBestCandidate: single-unit beats a cheaper multi-pack', () => {
  const best = selectBestCandidate('Leite meio gordo', [
    C('Leite Meio Gordo 1L', 1.0, 1000, 'volume', false),
    C('Leite Meio Gordo Pack 6x1L', 0.9 * 6, 6000, 'volume', true), // 0.90/L, cheaper per litre
  ]);
  assert.equal(best.isPack, false);
});

test('selectBestCandidate: falls back to total when a size is unknown', () => {
  const best = selectBestCandidate('Azeite', [
    C('Azeite Virgem Extra 750ml', 3.99, 750, 'volume'),
    C('Azeite Virgem Extra Garrafa', 3.5, null, null),
  ]);
  assert.equal(best.name, 'Azeite Virgem Extra Garrafa'); // 3.50 < 3.99, no unit price to compare
});

test('selectBestCandidate: returns null when every candidate is irrelevant', () => {
  assert.equal(selectBestCandidate('Mel de abelha', [
    C('DESODORIZANTE WILD ABELHAS MEL FLOR E CACTO 40G', 16.99),
    C('DESODORIZANTE ROLL-ON WILD ABELHAS MEL', 16.99),
  ]), null);
});

test('selectBestCandidate: a size-mismatched candidate is never used', () => {
  const best = selectBestCandidate('Açúcar 1 kg', [
    { ...C('Açúcar 2 kg', 1.69, 2000, 'mass'), sizeMismatch: true },
    C('Açúcar Branco 1 kg', 1.15, 1000, 'mass'),
  ]);
  assert.equal(best.name, 'Açúcar Branco 1 kg');
});
