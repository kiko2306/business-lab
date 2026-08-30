/*
 * Per-store price scrapers. Every store here is verified (live, against the
 * real site) to serve its price server-rendered in the initial HTML — none
 * of them need a headless browser. If a store's markup changes, the fix is
 * localized to its one function here.
 *
 * Stores intentionally NOT covered (no scraper, manual price entry only in
 * the UI instead): Recheio and Makro hide prices behind an account login
 * (B2B cash & carry) — nothing to scrape without credentials. Mercadona has
 * no Portuguese online catalog at all.
 */

const cheerio = require('cheerio');

// Thrown specifically when a store confidently doesn't carry a matching
// product (no search results at all, or every candidate tried was either
// a wrong product or a wrong size — see looksIrrelevant/
// looksLikeSizeMismatch) — as opposed to an ordinary Error for a
// transient failure (network blip, page structure change). server.js
// tells the two apart: a transient failure keeps the previously known
// price/URL (a blip shouldn't wipe out a good price), but a confident
// "this store doesn't have it" should clear them instead of silently
// keeping a stale, unrelated price around.
class NoMatchError extends Error {}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// origin: base URL to resolve a relative product link found on a search
// page against. searchUrl(query): builds that store's search-results URL.
// productLinkPattern: matches the first real product-detail link in the
// search page's raw HTML — verified live against each store (see
// plan.md §22.9c) rather than guessed.
// productLinkPattern uses the 'g' flag — searchAndScrapeStore walks every
// match in order (not just the first) so it can skip multi-pack listings
// (see looksLikeMultiPack below) and fall through to the next candidate.

// Stripped from the query text before it's sent to any store's search box
// — verified live this isn't cosmetic: Auchan's own search for "Açúcar"
// (with the accent) mixed in unrelated results (a Coca-Cola Zero listing,
// an almond milk) among the sugar products; searching "Acucar" (accents
// stripped) returned five actual sugar products, cleanly ranked. Lidl's
// result ordering shifted too. Continente and Pingo Doce were unaffected
// either way, so applying this to every store's query is safe.
function stripDiacritics(text) {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// The user's product names are free text — accents, quotes, parentheses,
// slashes, hyphens ("Champô de bebé \"não chora mais\"", "Paprika
// (colorau)", "Papos-secos"). Store search boxes choke on the punctuation
// (a parenthetical annotation was verified live to return zero results at
// Continente) and some rank worse with accents (see stripDiacritics'
// note above). Fold every character that isn't a-z/0-9 down: accents to
// their base letter, everything else to a single space. Only ever applied
// to the string handed to a store's search URL — the raw product name
// still flows unchanged to significantWords / looksLikeSizeMismatch, which
// tokenise on non-alphanumerics themselves, so "1.5L" size parsing is
// unaffected.
function sanitizeSearchQuery(text) {
  return stripDiacritics(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STORES = {
  continente: {
    label: 'Continente',
    hostSuffix: 'continente.pt',
    origin: 'https://www.continente.pt',
    searchUrl: (q) => `https://www.continente.pt/pesquisa/?q=${encodeURIComponent(sanitizeSearchQuery(q))}`,
    productLinkPattern: /href="(\/produto\/[^"?]+\.html)/g,
  },
  pingodoce: {
    label: 'Pingo Doce',
    hostSuffix: 'pingodoce.pt',
    origin: 'https://www.pingodoce.pt',
    searchUrl: (q) =>
      `https://www.pingodoce.pt/on/demandware.store/Sites-pingo-doce-Site/default/Search-Show?q=${encodeURIComponent(sanitizeSearchQuery(q))}`,
    productLinkPattern: /href="(\/home\/produtos\/[^"?]+\.html)/g,
  },
  lidl: {
    label: 'Lidl',
    hostSuffix: 'lidl.pt',
    origin: 'https://www.lidl.pt',
    searchUrl: (q) => `https://www.lidl.pt/q/search?q=${encodeURIComponent(sanitizeSearchQuery(q))}`,
    // Lidl's storefront is a client-rendered SPA — what's in the initial
    // HTML isn't real <a href> markup but an HTML-entity-escaped JSON blob
    // for hydration (paths show up as &quot;/p/...&quot;, not "/p/...").
    // Match the bare path instead of assuming real quoting around it.
    productLinkPattern: /(\/p\/[a-z0-9-]+\/p\d+)/g,
  },
  // Minipreço's own online store no longer exists — minipreco.pt now
  // redirects into Auchan.pt after Auchan absorbed the brand's
  // e-commerce, so Auchan is the closest available equivalent (verified
  // live, see plan.md §26.9).
  auchan: {
    label: 'Auchan',
    hostSuffix: 'auchan.pt',
    origin: 'https://www.auchan.pt',
    searchUrl: (q) => `https://www.auchan.pt/pt/pesquisa/?q=${encodeURIComponent(sanitizeSearchQuery(q))}`,
    productLinkPattern: /href="(\/pt\/[^"?]+\/\d+\.html)/g,
  },
};

// A search for e.g. "leite meio gordo" can rank a 6-pack above the single
// carton — comparing a pack's total price against another store's per-unit
// price is meaningless. Verified live: Continente's multi-pack size lives
// in a dedicated "emb. 6 x 1 lt" element, Pingo Doce/Lidl multi-packs say
// "pack" right in the URL slug or product name (Lidl: "Pack 8x1 L"). None
// of these signals alone covers every store, so check all of them together.
const PACK_TEXT_PATTERN = /\bemb\.?\s*\d+\s*x\s*[\d.,]+\s*(l|lt|kg|gr|g|un|ml)\b/i;
// Auchan's product-URL slugs put the pack size right in the slug with no
// "emb." prefix and no "pack" word at all (e.g. .../meio-gordo-6x1l/...,
// .../meio-gordo-3x200ml/...) — PACK_TEXT_PATTERN and the "pack" checks
// below both miss this, so check for the bare NxSIZE shape too.
const URL_PACK_SIZE_PATTERN = /\b\d+\s*x\s*[\d.,]+\s*(l|lt|kg|gr|g|un|ml)\b/i;

// Separate from multi-pack detection: a store can return the *right*
// product at the *wrong* size — verified live: searching "Açúcar 1 kg"
// on Lidl matched a real Sidul sugar (not a different product, so
// looksIrrelevant below doesn't catch it), but the page's own "Emb. 2 kg"
// label shows it's actually a 2kg bag at €1.69 (€0.85/kg) — a materially
// different price point than the 1kg bags the other three stores
// matched, silently shown as if directly comparable. Only ever compared
// when the user's own product name states a size, and only skips a
// candidate when both sizes are known and clearly different — no size
// stated, or size not found on the candidate page, means nothing to
// compare against, so it's left alone rather than guessed at.
// "gr" verified live as a real, distinct abbreviation from "g" — not a
// typo to normalize away. Continente's own "Creme Vegetal Culinário
// Vaqueiro" page states "Emb. 250 gr", and the old (kg|g|lt|l|ml)
// alternation never matched it: a bare "g" alternative can't satisfy the
// trailing \b when the next character is "r" (both word characters, no
// boundary between them), so the whole size lookup silently found
// nothing and the unit-price feature had no size to show at all —
// reported as "the €/kg or €/L price should show all the time".
const SIZE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml)\b/i;
const UNIT_TO_GRAMS_OR_ML = { kg: 1000, g: 1, gr: 1, l: 1000, lt: 1000, ml: 1 };
// Mass and volume are different physical quantities — a "500g" candidate
// isn't the same size as a "500ml" one just because they multiply out to
// the same base-unit number. Kept separate from UNIT_TO_GRAMS_OR_ML so
// looksLikeSizeMismatch and the unit-price display (server.js/app.js)
// both know which of "€/kg" or "€/L" applies, and so a mass/volume pair
// is never silently compared as if they were the same axis.
const UNIT_KIND = { kg: 'mass', g: 'mass', gr: 'mass', l: 'volume', lt: 'volume', ml: 'volume' };

function parseSize(text) {
  if (!text) return null;
  const m = SIZE_PATTERN.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  return { value: value * UNIT_TO_GRAMS_OR_ML[unit], kind: UNIT_KIND[unit] };
}

// A raw page's HTML is too noisy to scan for "any number followed by a
// unit" — verified live: Lidl's own per-kg unit-price label ("1 kg =
// 0.85") sits right next to the real "Emb. 2 kg" package-size label, and
// a generic scan matches whichever comes first, which isn't reliably the
// package size. Deliberately restricted to the same "Emb. N unit" shape
// multi-pack detection already looks for (just without requiring the
// "x" multiplier), so it only ever reads the actual package-size label.
const EMB_SIZE_PATTERN = /\bemb\.?\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml)\b/i;
function parseEmbSize(html) {
  if (!html) return null;
  const m = EMB_SIZE_PATTERN.exec(html);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  return { value: value * UNIT_TO_GRAMS_OR_ML[unit], kind: UNIT_KIND[unit] };
}

// Looks for the size stated directly on the candidate's own product name
// first (most reliable — e.g. Auchan states it right there), then the
// page's "Emb. N kg" label (Lidl/Continente); never the raw URL or a
// generic page scan, both too noisy (see EMB_SIZE_PATTERN above).
// A store's schema.org JSON-LD "description" field, when there is one —
// verified live: a bug report insisted Pingo Doce's "Água sem Gás
// Garrafão" (matched against a 1.5L query) was actually 6L, not a
// mismeasurement. Its displayed name really is just "Água sem Gás
// Garrafão" (no size), and it has no "Emb. N unit" label either — but its
// JSON-LD Product block carries `"description":"ÁGUA SEM GÁS PD 6L"`,
// never read anywhere before this. Only used as a last-resort fallback,
// after the name and the Emb. label — a free-text description field is
// more likely than either to contain an unrelated number (marketing
// copy), so it's trusted least.
function extractJsonLdDescription(html) {
  if (!html) return null;
  const scriptPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(scriptPattern)) {
    let data;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (item['@type'] === 'Product' && typeof item.description === 'string') return item.description;
    }
  }
  return null;
}

// Loose fruit/veg/meat sold by the kilo: the store's price IS the €/kg, so
// "1,69 €" for "Laranja" isn't missing a unit — it's already per-kg. We
// detect it from an explicit "kg" with no quantity (Pingo Doce's "Laranja"
// page carries JSON-LD description "LARANJA KG"; Auchan names it "LARANJA
// AUCHAN KG") or "granel". Only consulted after the real "N unit" parses
// fail, so "Açúcar 1 kg" is unaffected. From user bug reports on
// "Laranjas" at Pingo Doce and Auchan ("Missing €/kg").
const SOLD_BY_KG_PATTERN = /\b(?:granel|kg)\b/i;
function soldByWeight(text) {
  return text && !parseSize(text) && SOLD_BY_KG_PATTERN.test(text)
    ? { value: 1000, kind: 'mass' }
    : null;
}

function candidateSize({ html, name }) {
  const desc = extractJsonLdDescription(html);
  return (
    parseSize(name) ??
    parseEmbSize(html) ??
    parseSize(desc) ??
    soldByWeight(name) ??
    soldByWeight(desc)
  );
}

// Verified live: a "Reportar" note flagged Continente's "Água sem Gás
// Caramulo" at €2.94 as "showing the pack price as if it were the unit
// price" — the page's own "Emb. 6 x 1,5 lt" label shows it's genuinely a
// 6-bottle pack (9L total), correctly used as the multi-pack fallback
// (no single-unit alternative existed for that search), but with no size
// captured at all — parseEmbSize's pattern deliberately doesn't match an
// "N x SIZE" shape (see its own comment), so the unit-price feature had
// nothing to show and the raw €2.94 looked like a wildly overpriced
// single bottle instead of what it actually is (€0.33/L — in line with
// Auchan's single-bottle price at the same per-litre rate). Deliberately
// kept separate from candidateSize/looksLikeSizeMismatch above: this
// total is only meaningful for an entry already confirmed to be a pack
// (see looksLikeMultiPack) — feeding a 9L total into the single-unit size
// comparison there would make every legitimate multi-pack fallback look
// like a size mismatch against a 1.5L query and get rejected outright,
// losing the only price the store had.
const PACK_TOTAL_SIZE_PATTERN = /\bemb\.?\s*(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|lt|l|ml)\b/i;
function parsePackTotalSize(html) {
  if (!html) return null;
  const m = PACK_TOTAL_SIZE_PATTERN.exec(html);
  if (!m) return null;
  const count = Number(m[1]);
  const perUnit = Number(m[2].replace(',', '.'));
  const unit = m[3].toLowerCase();
  if (!Number.isFinite(count) || !Number.isFinite(perUnit)) return null;
  return { value: count * perUnit * UNIT_TO_GRAMS_OR_ML[unit], kind: UNIT_KIND[unit] };
}

// A generous tolerance (±20%) since package sizes aren't perfectly
// standardized across brands (e.g. 900g vs 1kg bags of the same staple
// are common) — this is only meant to catch a clearly different size
// (1kg vs 2kg), not penalize minor real-world packaging variance.
function looksLikeSizeMismatch(query, candidate) {
  const expected = parseSize(query);
  if (!expected) return false; // user's own product name doesn't state a size — nothing to check against
  const actual = candidateSize(candidate);
  if (!actual) return false; // couldn't determine this candidate's size — don't block on missing data
  if (actual.kind !== expected.kind) return false; // mass vs volume — not comparable, not a "mismatch" to flag
  const ratio = actual.value / expected.value;
  return ratio < 0.8 || ratio > 1.2;
}

function looksLikeMultiPack({ html, name, url }) {
  if (name && /\bpack\b/i.test(name)) return true;
  if (url && (/\bpack\b/i.test(url) || URL_PACK_SIZE_PATTERN.test(url))) return true;
  if (html && PACK_TEXT_PATTERN.test(html)) return true;
  return false;
}

// A store's search can rank a completely different product first when it
// simply doesn't carry the thing being searched for — verified live:
// Lidl (a private-label discount retailer) doesn't stock Danone's Activia
// yogurt at all, so searching "Iogurte Activia aveia e nozes pack 8"
// there returned an unrelated Mimosa lactose-free yogurt as the top
// result. looksLikeMultiPack alone doesn't catch this (nothing about it
// looks like a pack) — this is a distinct problem: not "right product,
// wrong size" but "wrong product entirely".
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents so "açúcar"/"acucar" compare equal
    .replace(/[^a-z0-9]+/g, ' ') // fold every other non-alphanumeric to a space ("sem-glúten" → "sem gluten", "c/pimento" → "c pimento")
    .trim();
}

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'e', 'ou', 'para', 'em', 'no', 'na']);

// Verified live: a query for "Bananas" (plural — how the user's own
// grocery list writes fruit/veg names) found zero matches at Continente
// even though its own top search result was "Banana Continente" — every
// relevance check compares words by exact string equality, and Portuguese
// regular plurals just add "s" to the singular, so "bananas" !== "banana"
// word-for-word. Stripping one trailing "s" (only past 3 letters, so
// short words like "gas" aren't mangled) turns both into the same stem
// for every regular case in the product list (bananas/batatas/cebolas/
// tomates/cenouras/pimentos/...).
//
// Two irregular plural shapes verified live to still fail after that
// simple strip: words ending "-ão" pluralize to "-ões" or "-ães", not
// "-ãos" ("limão"→"limões", "pão"→"pães") — after accent-stripping that's
// "limao"→"limoes" and "pao"→"paes", so a plain trailing-"s" strip leaves
// "limoe"/"pae", neither matching the singular. "Limões" was one of the
// 300-item list's real entries and scored 0/4 stores for exactly this
// reason. Reduce "-oes"/"-aes" back to "-ao" first, before the general
// case.
function stemWord(word) {
  if (word.length > 3 && word.endsWith('oes')) return word.slice(0, -3) + 'ao';
  if (word.length > 3 && word.endsWith('aes')) return word.slice(0, -3) + 'ao';
  // Words ending "-al" pluralize to "-ais", not "-als" — verified live:
  // "Iogurtes naturais" still scored 0/4 stores after the -ão fix above,
  // since "naturais" didn't reduce to "natural" (the word every store's
  // own listing actually uses).
  if (word.length > 3 && word.endsWith('ais')) return word.slice(0, -3) + 'al';
  // "-z" words pluralize to "-zes" (noz→nozes, raiz→raízes, vez→vezes) —
  // the plain trailing-"s" strip leaves "noze", which matches nothing.
  // ("-m"→"-ns" deliberately NOT handled: "amendoim"→"amendoins" wants it,
  // but "muffins" is an English loanword whose singular is "muffin", and
  // no suffix test tells the two apart — net-negative for this list.)
  if (word.length > 4 && word.endsWith('zes')) return word.slice(0, -3) + 'z';
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

function significantWords(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stemWord);
}

// A plain word-overlap check can't tell "açúcar" (the query) from "sem
// açúcar" (a candidate explicitly saying it has *none*) — both contain
// the word. Verified live: searching "Açúcar 1 kg" on Pingo Doce matched
// an unsweetened almond milk ("Bebida Vegetal de Amêndoa sem Açúcar") as
// relevant purely because "açúcar" appears in its own name, and its
// price (irrelevant either way, but it happened to be higher) skewed the
// pool enough to make the real sugar's genuinely correct price look like
// a statistical outlier in cheapestPlausible. Checked directly on the
// normalized-but-unsplit text (not significantWords, which already
// strips "sem" as a stopword) so the "sem X" bigram itself survives to
// be matched against.
function negatedWords(text) {
  const set = new Set();
  for (const m of normalizeText(text).matchAll(/\bsem\s+([a-z0-9]+)/g)) set.add(m[1]);
  return set;
}

// A candidate negating one of the query's own words is only a conflict if
// the *query* doesn't negate that same word too — verified live: "Leite
// magro sem lactose" (a query that deliberately wants lactose-free milk)
// was rejecting its own correct match, since "Leite UHT Magro sem Lactose
// Mimosa" negates "lactose" exactly like the query does. Only "Açúcar 1
// kg" (a query with no negation of its own) should reject a candidate
// that negates "açúcar".
function hasNegatedQueryWord(query, candidateName) {
  const queryWords = new Set(significantWords(query));
  if (!queryWords.size) return false;
  const queryNegated = negatedWords(query);
  for (const w of negatedWords(candidateName)) {
    if (queryWords.has(w) && !queryNegated.has(w)) return true;
  }
  return false;
}

// A fixed-floor word-overlap threshold, tuned against real live cases
// rather than a ratio — two earlier versions of this check both broke on
// real data: excluding the query's first word (its usual "category",
// e.g. "iogurte") let a wrong product through whenever a query happened
// to have only one significant word (e.g. "Açúcar 1 kg" → just "açúcar"
// once the size is stripped out — nothing left to exclude *from*, so
// every candidate passed unchecked, and Lidl's search matched rice).
// Requiring a ratio of ALL significant words including the first one
// broke a real match the other way: Continente's own listing for a
// tracked yogurt never says "iogurte" at all ("Bifidus Pedaços Aveia e
// Noz Activia Danone" — Danone's product line name, not the generic
// category), so a 5-word query needing a 3-word majority rejected a
// listing that only shared 2 ("activia", "aveia"). A flat floor of 2
// matches (or all of it, for a 1-word query) passes every real case
// checked so far: rejects rice for a sugar search (0 shared), rejects an
// unrelated yogurt/baby-food product that only coincidentally shares one
// word, and accepts the Bifidus/Activia match that a ratio rejected.

// A word-overlap floor alone isn't enough once picking the *cheapest*
// candidate (see searchAndScrapeStore) rather than just the first one —
// verified live, repeatedly: a query fully contained inside a longer
// candidate name still gets picked whenever the extra words happen to
// make it cheaper, even though those extra words describe a materially
// different product (a lactose-free variant, a Greek-style yogurt, a
// flavoured or "Sport" bottled water, a hazelnut-filled croissant instead
// of plain). A first attempt tried hand-listing every such qualifier word
// as it was found live (VARIANT_MARKERS: "lactose", "grego", "skyr",
// "sport", "fruta", "avela"...) — abandoned because that list only grows,
// one live-tested mismatch at a time, and can never be complete. Rejecting
// outright on *any* unrequested extra word was tried next and is even
// worse: replayed against the 294 matches already on file, it rejected
// 188 of them, because ordinary store-added text (brand names, "UHT",
// the store's own name, size units) is the norm on every real listing,
// not the exception.
//
// What actually distinguishes "Sport"/"Fruta"/"Avelã" from harmless
// extras like "Mimosa" or "UHT" isn't the words themselves — it's that
// within *one store's own* set of search candidates for the same query,
// the plain/correct listing has fewer unaccounted-for words than the
// flavoured/variant one does. So instead of judging any single candidate
// name in isolation, count each candidate's unmatched words and use that
// count to *rank* candidates from the same store's pool — closest name
// match wins, price only breaks ties within that closest tier (see
// pickClosestNameMatches in searchAndScrapeStore). No word list, no
// accept/reject threshold: "Água sem Gás Luso" (0 extra words) beats
// "...Luso Sport" (1) and "...Luso Fruta Limão" (2) purely because it's
// textually closer, even when a flavoured variant happens to be cheaper.
// Packaging-container nouns, exempted from the extra-word count below —
// verified live this exemption is needed, not just theoretical: Pingo
// Doce's own candidates for "Água sem Gás Luso" were "...Sport" and
// "...Box" (a multi-bottle pack, still plain water), both scoring 1 extra
// word with nothing to break the tie but price, so the €0.84 flavoured
// bottle beat the €4.19 correct pack. Unlike VARIANT_MARKERS (abandoned
// above for growing without bound — every manufacturer can invent a new
// flavour or formula name), packaging containers are a small, closed,
// real-world set: a store sells things in a bottle, a box, a can, a bag,
// a jar, a tray, or loose units, and nothing else.
const NEUTRAL_PACKAGING_WORDS = new Set([
  'pack', 'embalagem', 'garrafa', 'garrafao', 'lata', 'uni', 'unidade',
  'unidades', 'caixa', 'saco', 'frasco', 'tabuleiro', 'bandeja', 'box',
  'tetra', 'pet', 'vidro', 'dose', 'doses',
  // Every store's own-brand product repeats the store's name in its own
  // title (e.g. "Cebola Roxa Continente") — near-universal on that
  // store's listings, so it never actually distinguishes one candidate
  // from another within the same store's pool.
  'continente', 'pingodoce', 'lidl', 'auchan',
]);

function countExtraWords(queryWords, candidateWords) {
  const queryWordSet = new Set(queryWords);
  let count = 0;
  for (const w of candidateWords) {
    if (queryWordSet.has(w)) continue;
    if (GENERIC_CATEGORY_WORDS.has(w)) continue;
    if (NEUTRAL_PACKAGING_WORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue; // stray size/quantity digits, not a product qualifier
    count++;
  }
  return count;
}

// A candidate whose name says it's a *processed form* the query never
// asked for — a juice, jelly, pouch, sorbet, purée — of the query's
// ingredient. countExtraWords can't catch these: "Bolsa de Fruta Pêra"
// (a fruit pouch, €0.67) scores fewer extra words than the plain "Pera
// Rocha DOP Oeste" (€2.49) because "rocha/DOP/oeste" are three descriptors
// while "bolsa/fruta" are only two — so ranking by closeness alone picks
// the pouch. Same shape verified live: "Morangos"→"Gelatina de Morango",
// "Melão"→"Sangria Melão", "Tangerinas"→"Sumo 100% Tangerina",
// "Cenouras"→"Farinha Láctea ... Cenoura". Used only to *rank* (a
// candidate with an unrequested form word sorts below every candidate
// without one — see pickClosestNameMatches), never to reject: if every
// candidate a store returns is a processed form, the least-bad one is
// still shown. Bounded and closed the same way NEUTRAL_PACKAGING_WORDS is
// — the set of culinary forms (juice/nectar/purée/jelly/jam/ice-cream/
// sorbet/pouch/shake/broth/flour) is enumerable; flavours are not.
const PROCESSED_FORM_WORDS = new Set([
  'sumo', 'sumos', 'nectar', 'nectars', 'pure', 'pures', 'gelatina', 'gelatinas',
  'compota', 'compotas', 'doce', 'doces', 'sorbet', 'gelado', 'gelados',
  'sangria', 'mocktail', 'cocktail', 'bolsa', 'bolsas', 'batido', 'batidos',
  'farinha', 'polpa', 'concentrado', 'refrigerante',
]);

// The same idea one step over: a preparation / cut / state that changes
// what you'd actually buy for a *plain* query — boiled eggs for "Ovos",
// grated carrot for "Cenouras", frozen strawberries for "Morangos",
// breaded fish for "Filetes". countExtraWords weights "cozido" the same as
// "UHT" or a brand, so "Ovos Cozidos" (1 extra word) beats "Ovos de Solo
// Classe M" (2) and wins on price. Demote (never reject) a candidate that
// adds one of these unless the query asked for it ("Batatas fritas
// congeladas" keeps "congelada" — it's in the query). Gendered/plural
// forms listed explicitly since stemWord doesn't normalise -o/-a. Closed,
// enumerable set (kitchen preparations + cuts), same footing as
// PROCESSED_FORM_WORDS / NEUTRAL_PACKAGING_WORDS.
const PREPARATION_WORDS = new Set([
  'cozido', 'cozida', 'cozidos', 'cozidas',
  'frito', 'frita', 'fritos', 'fritas',
  'assado', 'assada', 'grelhado', 'grelhada',
  'panado', 'panada', 'panados', 'panadas',
  'ralado', 'ralada', 'fatiado', 'fatiada', 'fatias',
  'picado', 'picada', 'laminado', 'laminada',
  'moido', 'moida', 'desfiado', 'desfiada',
  'congelado', 'congelada', 'congelados', 'congeladas',
  'demolhado', 'demolhada', 'torrado', 'torrada',
  'fumado', 'fumada', 'defumado', 'defumada',
]);

function hasUnrequestedFormWord(queryWords, candidateWords) {
  const queryWordSet = new Set(queryWords);
  for (const w of candidateWords) {
    if (queryWordSet.has(w)) continue;
    if (PROCESSED_FORM_WORDS.has(w) || PREPARATION_WORDS.has(w)) return true;
  }
  return false;
}

// Verified live: "Cebolas" at Continente had three candidates all tied at
// 1 extra word — "Cebola Picada" (chopped), "Cebola Roxa" (red), and
// "Sopa de Cebola" (onion *soup*, a fundamentally different product that
// only shares the word "cebola"). countExtraWords alone can't tell these
// apart since each adds exactly one word the query didn't. What does
// distinguish them: Portuguese product titles put the actual item first
// ("Cebola Roxa" — an onion, described as red) and a *different* item
// second when it's not what's being sold ("Sopa de Cebola" — a soup,
// happening to be onion-flavoured). Only used to break ties in
// extraWordCount, never as a standalone filter — with a real brand-name
// head word (e.g. "Bifidus Pedaços..." for a tracked yogurt) this would
// incorrectly flag a correct match, but by then it's usually the only
// candidate left in the pool, so the tiebreak never fires against it.
function headWordMismatch(queryWords, candidateWords) {
  const [firstCandidateWord] = candidateWords;
  if (!firstCandidateWord) return false;
  return !queryWords.includes(firstCandidateWord);
}

// Category-noun words so generic they appear in nearly every candidate a
// search for that category turns up (e.g. "leite" in every milk
// listing) — satisfying the required-match floor with these alone let
// real mismatches straight through, since the word that actually
// distinguishes one product from another (almost always a brand) never
// had to match at all. Verified live, all sharing this exact shape:
// "Cerveja com Álcool Alhambra" matched Sagres at two different stores
// (shared "cerveja"+"álcool"), "Água sem Gás Luso" matched a different
// water brand entirely (shared "água"+"gás"), "Pilhas AAA Boost" matched
// an unrelated own-brand pack (shared "pilhas"+"aaa"), "Detergente
// Manual Loiça..." repeatedly matched dishwasher tablets at Lidl (shared
// "detergente"+"loiça", the query's own "manual" never required against
// the candidate's "máquina"). Kept deliberately small and conservative —
// only unambiguous top-level category nouns, not anything that could
// itself be part of what makes two products different.
const GENERIC_CATEGORY_WORDS = new Set([
  'iogurte', 'leite', 'agua', 'cerveja', 'pilhas', 'detergente', 'gel',
  'queijo', 'massa', 'azeite', 'arroz', 'sumo', 'croissant', 'pao',
  'presunto', 'fiambre', 'champo', 'banho', 'roupa', 'loica',
  'refrigerante', 'sacos', 'guardanapos', 'chourico', 'chouricao',
  'bolo', 'gelado', 'bacalhau', 'maquina', 'liquido',
  // Added after the test/ replay: a query's leading category noun that a
  // wrong candidate didn't carry — "Vinagre de vinho branco" → Lidl's
  // "3 Castas Vinho Branco/ Tinto" (a wine).
  'vinagre',
]);

function looksIrrelevant(query, candidateName) {
  if (!candidateName) return false; // nothing to judge against — don't block on missing data
  const queryWords = significantWords(query);
  if (!queryWords.length) return false;
  if (hasNegatedQueryWord(query, candidateName)) return true;
  const candidateWordList = significantWords(candidateName);
  const candidateWords = new Set(candidateWordList);

  // Check against the query's more distinguishing (non-generic) words
  // when there are any — falls back to the full word list for a query
  // that's nothing *but* a generic word (e.g. "Açúcar 1 kg" once its
  // size is stripped out leaves only "açúcar"), so that case still
  // requires its one real word rather than passing everything.
  //
  // Tried also excluding NEUTRAL_PACKAGING_WORDS here (to fix "Sardinhas
  // em lata" — real listings say "Sardinha em Azeite/Tomate" without ever
  // literally saying "lata", since canned is implied) — reverted after
  // replaying it against the full 300-item pool's recorded matches:
  // it broke more than it fixed. For "Água mineral sem gás (garrafão
  // 5L)", "Sacos do lixo de 30L", and "Gelo em cubo (saco)", the
  // packaging word *is* the actual product ("garrafão"/"saco" aren't
  // incidental there, they're what's being sold — a jerry-can, a trash
  // bag), so treating them as neutral broke those correct matches. Same
  // lesson as GENERIC_CATEGORY_WORDS and VARIANT_MARKERS before it:
  // whether a word is "just packaging" depends on the product, not just
  // the word itself, so a fixed exemption list can't get this right in
  // both directions at once. "Sardinhas em lata" stays a known gap.
  const specificWords = queryWords.filter((w) => !GENERIC_CATEGORY_WORDS.has(w));
  const genericWords = queryWords.filter((w) => GENERIC_CATEGORY_WORDS.has(w));

  // (1) When the query *leads* with a category noun ("Iogurtes naturais",
  // "Queijo da Serra", "Cerveja sem álcool"), that noun must actually
  // appear in the candidate — not just the more specific words. Without
  // this, a query whose only specific word is a weak modifier matches
  // whichever candidate happens to carry it: Lidl returns no plain natural
  // yogurt for "Iogurtes naturais", so the one candidate past the
  // specific-word floor was "Atum ao Natural" (tuna); "Queijo da Serra"
  // landed on "Serra Grande de Jardinagem" (a garden tool). Gated on the
  // *first* word specifically, so a trailing incidental category word
  // doesn't trigger it — "Fermento em pó para bolos" leads with "fermento",
  // and stores list it without ever saying "bolo". Historically avoided
  // (plan.md §30.2) over a brand-named yogurt ("Bifidus … Activia") that
  // never says "iogurte"; not present in the current generic-worded
  // 300-item list — re-validated net-positive against it (test/).
  if (GENERIC_CATEGORY_WORDS.has(queryWords[0]) && specificWords.length) {
    if (!candidateWords.has(queryWords[0])) return true;
  }

  // (2) For a short query with no category noun at all (≤2 significant
  // words: "Mel de abelha", "Canela em pó", "Tangerinas"), the candidate's
  // own first word must be one of the query's words. Portuguese product
  // titles lead with what the thing *is*; a candidate that leads with a
  // different noun — "Desodorizante … Mel", "Café Solúvel … Canela", "Água
  // com Gás Tangerina" — is a different product that merely mentions the
  // query term. Only applied when there's no category noun to fall back on:
  // the §38-documented false rejects of a head-word rule ("Postas de
  // Bacalhau", "Folha de Massa Fresca", "Detergente Máquina …") are all
  // category-noun queries, which skip this. Needs ≥1 shared word first
  // (otherwise the floor below already rejects it).
  if (
    !genericWords.length &&
    queryWords.length <= 2 &&
    candidateWordList.length &&
    candidateWordList.some((w) => queryWords.includes(w)) &&
    !queryWords.includes(candidateWordList[0])
  ) {
    return true;
  }

  const wordsToCheck = specificWords.length ? specificWords : queryWords;
  const required = wordsToCheck.length === 1 ? 1 : 2;
  const matches = wordsToCheck.filter((w) => candidateWords.has(w)).length;

  // Tried also gating on headWordMismatch here when only one fragile
  // specific word is left (e.g. "Iogurtes naturais" → just "natural" once
  // "iogurte" is excluded as generic). Reverted: replaying it against the
  // 300-item pool's recorded matches caught 6 genuine mismatches but also
  // rejected 6 *correct* ones — "Postas de Bacalhau Seco", "Lombos de
  // Bacalhau Demolhado", "Folha de Massa Fresca para Lasanha", real
  // dishwasher-tablet listings — because Portuguese product names routinely
  // lead with a cut/format word ("Postas de", "Lombos de", "Detergente")
  // before the category noun, not the noun itself. headWordMismatch stays
  // useful only as a tiebreaker between candidates from one store
  // (pickClosestNameMatches below). The Atum/Iogurte case is now caught by
  // the require-the-generic-word gate above instead.
  return matches < required;
}

function detectStore(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const [key, def] of Object.entries(STORES)) {
    if (hostname === def.hostSuffix || hostname.endsWith('.' + def.hostSuffix)) return key;
  }
  return null;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Both Continente and Lidl embed a standard schema.org Product/Offer block.
function extractJsonLdPrice(html) {
  const scriptPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(scriptPattern)) {
    let data;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (item['@type'] !== 'Product') continue;
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      if (offer && offer.price != null) {
        return { price: Number(offer.price), currency: offer.priceCurrency || 'EUR', name: item.name };
      }
    }
  }
  return null;
}

// Each scraper returns the raw html alongside the parsed fields so the
// caller can run looksLikeMultiPack() against it — never stored, stripped
// before the result reaches an API response.
async function scrapeContinente(url) {
  const html = await fetchHtml(url);
  const result = extractJsonLdPrice(html);
  if (!result) throw new Error('preço não encontrado na página');
  return { ...result, html };
}

// The product `name` from a schema.org Product block, even when its Offer
// carries no price (Lidl's in-store-only produce).
function extractJsonLdProductName(html) {
  for (const m of (html || '').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      if (item && item['@type'] === 'Product' && typeof item.name === 'string') return item.name;
    }
  }
  return null;
}

// Lidl's storefront is a Qwik SPA. For most items the price is in the
// schema.org Offer, but fresh produce is listed availability:"InStoreOnly"
// with no Offer price — the number still ships in the Qwik hydration
// state, an index-referenced flat JSON array
// (`{"price":45,"oldPrice":42,...}` where 45/42 are positions in the same
// array, so `arr[45]` is the actual €1.49). Verified live against
// "Laranja - Citrinos do Algarve IGP". Guarded: a serializer change just
// yields null, i.e. the same NoMatch as today.
function extractLidlStatePrice(html) {
  for (const m of (html || '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1].trim();
    if (body[0] !== '[' || !body.includes('"oldPrice"')) continue;
    let arr;
    try {
      arr = JSON.parse(body);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const o of arr) {
      if (o && typeof o === 'object' && !Array.isArray(o) && typeof o.price === 'number' && ('oldPrice' in o || 'basePrice' in o)) {
        const v = arr[o.price];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
      }
    }
  }
  return null;
}

async function scrapeLidl(url) {
  const html = await fetchHtml(url);
  const result = extractJsonLdPrice(html);
  if (result && result.price != null) return { ...result, html };
  // in-store-only produce: no Offer price, dig it out of the Qwik state
  const price = extractLidlStatePrice(html);
  if (price != null) {
    return { price, currency: 'EUR', name: extractJsonLdProductName(html), html };
  }
  throw new Error('preço não encontrado na página');
}

// Pingo Doce's JSON-LD block doesn't include the offer/price — the
// storefront renders it as <span class="value" content="X.XX"> inside the
// ".sales" price block instead (Salesforce Commerce Cloud's standard price
// template markup).
async function scrapePingoDoce(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const content = $('.sales .value').first().attr('content');
  const price = Number(content);
  if (!content || !Number.isFinite(price)) throw new Error('preço não encontrado na página');
  const name = $('h1.product-name, h1').first().text().trim() || undefined;
  return { price, currency: 'EUR', name, html };
}

// Same schema.org JSON-LD Product/Offer block as Continente/Lidl (Auchan
// runs on the same Salesforce Commerce Cloud platform as Pingo Doce, but
// unlike Pingo Doce it does include price in the JSON-LD — verified live).
async function scrapeAuchan(url) {
  const html = await fetchHtml(url);
  const result = extractJsonLdPrice(html);
  if (!result) throw new Error('preço não encontrado na página');
  return { ...result, html };
}

const SCRAPERS = {
  continente: scrapeContinente,
  pingodoce: scrapePingoDoce,
  lidl: scrapeLidl,
  auchan: scrapeAuchan,
};

async function scrapeUrl(url) {
  const store = detectStore(url);
  if (!store) throw new Error('unsupported store (not Continente, Pingo Doce, Lidl, or Auchan)');
  const { html, ...result } = await SCRAPERS[store](url);
  return { store, ...result };
}

// Every real product-detail link in a search page's HTML, in order,
// deduped, resolved to an absolute URL.
function extractCandidateUrls(def, searchHtml) {
  const seen = new Set();
  const urls = [];
  for (const match of searchHtml.matchAll(def.productLinkPattern)) {
    const absolute = new URL(match[1], def.origin).toString();
    if (!seen.has(absolute)) {
      seen.add(absolute);
      urls.push(absolute);
    }
  }
  return urls;
}

// Given a product name, searches the store and scrapes whichever product
// its search results ranks first — no product URL needed from the user at
// all. Less precise than a hand-picked product link (the top search result
// isn't guaranteed to be the exact product meant), but that trade-off is
// deliberate: see plan.md §22.9c.
//
// Evaluates every candidate in the first page of results (not just the
// first one that looks valid) and returns the *cheapest* one that passes
// looksIrrelevant/looksLikeSizeMismatch — verified live this matters:
// Pingo Doce's own search ranked a €1.64 "Arroz Agulha Cigala" first for
// "Arroz agulha", but five cheaper equivalents (down to €1.15) sat lower
// in the same results. A price-comparison app returning whichever brand a
// store's search happens to rank first, rather than the actual best price
// available there, defeats the point. Single-unit matches are preferred
// over multi-packs when both exist; multi-packs are only used if nothing
// single-unit passed at all. The cost is real: this always fetches up to
// MAX_CANDIDATES_TRIED pages now (it used to stop at the first valid
// single-unit match), trading more requests per store per refresh for
// actually finding the best price.
//
// Raised 5 → 8: several wrong picks were "the right product was result #6"
// (fresh produce, less-common brands). +3 product-page fetches per store
// per refresh, worst case — acceptable for a low-frequency personal tool.
const MAX_CANDIDATES_TRIED = 8;

// One candidate's product page, parsed down to the JSON-serialisable facts
// selectBestCandidate needs. Everything that requires the raw HTML — price,
// multi-pack detection, size, and whether the size disagrees with a size
// stated in the query — is resolved here; the word-overlap ranking is
// deliberately left to selectBestCandidate so it stays tunable against
// recorded fixtures (test/) without re-scraping. `scraped` is the
// `{ html, name, price, currency }` a SCRAPERS[store] call returns.
function parseCandidate(store, url, scraped, query) {
  const { html, ...result } = scraped;
  const isPack = looksLikeMultiPack({ html, name: result.name, url });
  // A pack's €N.NN is for the whole pack, not one unit — use its total
  // size, not the single-unit size (see parsePackTotalSize's comment for
  // why the two are kept separate).
  const size = isPack
    ? (parsePackTotalSize(html) ?? candidateSize({ html, name: result.name }))
    : candidateSize({ html, name: result.name });
  return {
    store,
    url,
    name: result.name || null,
    price: result.price ?? null,
    currency: result.currency || 'EUR',
    isPack,
    unitSizeValue: size?.value ?? null,
    unitSizeKind: size?.kind ?? null,
    sizeMismatch: looksLikeSizeMismatch(query, { html, name: result.name, url }),
  };
}

// The whole matching decision, pure: given the query and a list of parsed
// candidates (see parseCandidate), return the winning entry (with the
// ranking fields attached) or null if none is usable. No network, no HTML —
// test/match.test.js replays exactly this against recorded fixtures.
//
// Evaluates every candidate (not just the first that looks valid) and
// returns the *cheapest* that passes looksIrrelevant/size-mismatch —
// verified live this matters: Pingo Doce ranked a €1.64 "Arroz Agulha
// Cigala" first for "Arroz agulha" with five cheaper equivalents (down to
// €1.15) lower in the same results. Single-unit matches beat multi-packs;
// packs are a fallback only when nothing single-unit passed.
function selectBestCandidate(query, candidates) {
  const queryWords = significantWords(query);
  const usable = [];
  for (const c of candidates) {
    if (c.price == null || !c.name) continue;
    // A wrong product entirely, or the right product at a clearly wrong
    // size, is never usable — not even as a last-resort fallback: showing
    // it at all is a misleading price, worse than showing none.
    if (looksIrrelevant(query, c.name) || c.sizeMismatch) continue;
    const candidateWords = significantWords(c.name);
    usable.push({
      ...c,
      extraWordCount: countExtraWords(queryWords, new Set(candidateWords)),
      headMismatch: headWordMismatch(queryWords, candidateWords),
      formMismatch: hasUnrequestedFormWord(queryWords, candidateWords),
    });
  }
  const singleUnit = usable.filter((e) => !e.isPack);
  const packs = usable.filter((e) => e.isPack);
  const pool = singleUnit.length ? singleUnit : packs;
  if (!pool.length) return null;
  return cheapestPlausible(pickClosestNameMatches(pool));
}

// Given a product name, searches the store and scrapes whichever product
// its search results rank first — no product URL needed from the user at
// all. Less precise than a hand-picked product link (see plan.md §22.9c),
// which is what the "corrigir correspondência" override (listStoreCandidates
// below) exists to fix. Fetches up to MAX_CANDIDATES_TRIED product pages.
// `excludeUrls` (optional): candidate URLs to skip during selection — used
// by server.js's cross-store outlier retry (this store's first pick was a
// gross price outlier vs the others; try again without it).
// `ai` (optional, { isConfigured, pickCandidate } — server.js passes
// aiMatch.js): a last-resort matcher asked *only* when the deterministic
// selection finds nothing but candidates do exist, for the vocabulary /
// synonym cases word-overlap can't reach. Off unless GEMINI_API_KEY is set.
// `prevAiUrl` (optional): the URL this store's entry was last AI-matched
// to — if it's still in the results, reuse it without spending an API
// call (a confirmed synonym match stays confirmed).
async function searchAndScrapeStore(store, query, excludeUrls, ai, prevAiUrl) {
  const def = STORES[store];
  if (!def) throw new Error(`unknown store: ${store}`);

  const searchHtml = await fetchHtml(def.searchUrl(query));
  const candidateUrls = extractCandidateUrls(def, searchHtml);
  if (!candidateUrls.length) throw new NoMatchError(`sem resultados de pesquisa em ${def.label}`);

  const candidates = [];
  for (const productUrl of candidateUrls.slice(0, MAX_CANDIDATES_TRIED)) {
    let scraped;
    try {
      scraped = await SCRAPERS[store](productUrl);
    } catch {
      continue; // this candidate's page didn't yield a price — try the next
    }
    if (scraped.price == null) continue;
    candidates.push(parseCandidate(store, productUrl, scraped, query));
  }

  const pool = excludeUrls ? candidates.filter((c) => !excludeUrls.has(c.url)) : candidates;
  const best = selectBestCandidate(query, pool);
  if (best) return best;

  if (pool.length && ai && ai.isConfigured()) {
    const cached = prevAiUrl && pool.find((c) => c.url === prevAiUrl);
    if (cached) return { ...cached, aiMatched: true };
    const idx = await ai.pickCandidate(query, pool.map((c) => c.name));
    if (idx >= 0 && pool[idx]) return { ...pool[idx], aiMatched: true };
  }
  throw new NoMatchError(`não foi possível obter um produto em ${def.label}`);
}

// The parsed candidate list for one store's search, no selection applied.
// Backs both the "corrigir correspondência" UI (server.js
// GET /api/products/:id/candidates, where the user picks the right result
// when the automatic pick is wrong) and the offline test harness
// (test/capture.js records exactly this, test/match.test.js replays
// selectBestCandidate against it). `query` is passed through to
// parseCandidate for its size-vs-query check.
async function listStoreCandidates(store, query, limit = 8) {
  const def = STORES[store];
  if (!def) throw new Error(`unknown store: ${store}`);
  const searchHtml = await fetchHtml(def.searchUrl(query));
  const candidateUrls = extractCandidateUrls(def, searchHtml);
  const out = [];
  for (const productUrl of candidateUrls.slice(0, limit)) {
    let scraped;
    try {
      scraped = await SCRAPERS[store](productUrl);
    } catch {
      continue;
    }
    if (scraped.price == null) continue;
    out.push(parseCandidate(store, productUrl, scraped, query || ''));
  }
  return out;
}

// Scrape one specific product URL the user pinned as the correct match for
// a store (server.js PUT /api/products/:id/override) — bypasses search and
// selection, but still resolves pack/size so the unit-price display keeps
// working.
async function scrapeChosenUrl(store, url) {
  const def = STORES[store];
  if (!def) throw new Error(`unknown store: ${store}`);
  if (detectStore(url) !== store) throw new Error('URL não pertence a esta loja');
  const scraped = await SCRAPERS[store](url);
  if (scraped.price == null) throw new Error('preço não encontrado na página');
  const c = parseCandidate(store, url, scraped, '');
  return {
    store: c.store, url: c.url, name: c.name, price: c.price, currency: c.currency,
    isPack: c.isPack, unitSizeValue: c.unitSizeValue, unitSizeKind: c.unitSizeKind,
  };
}

// Narrows a store's candidate pool before price is ever considered — the
// closest name match, not the cheapest name match, is the right product.
// Order: plain products before unrequested processed forms
// (hasUnrequestedFormWord), then fewest query-unaccounted-for words
// (countExtraWords), then head-word agreement (headWordMismatch). Each
// stage only narrows; it never empties a non-empty pool.
function pickClosestNameMatches(entries) {
  const plain = entries.filter((e) => !e.formMismatch);
  const tier = plain.length ? plain : entries;
  const minExtra = Math.min(...tier.map((e) => e.extraWordCount));
  const closest = tier.filter((e) => e.extraWordCount === minExtra);
  const headMatched = closest.filter((e) => !e.headMismatch);
  return headMatched.length ? headMatched : closest;
}

// The quantity to minimise when choosing between a store's remaining
// candidates: the unit price (€ per kg / per L) when *every* candidate has
// a comparable size, the raw total otherwise. Ranking a lactose-free-milk
// search by total would pick a 200 ml bottle over a 1 L carton that's
// cheaper per litre — "cheapest" has to mean cheapest per unit. Falls back
// to the total the moment one candidate's size is unknown (nothing to
// divide by) or the sizes are different kinds (mass vs volume).
function rankMetric(entries) {
  const kinds = new Set(entries.map((e) => e.unitSizeKind));
  const allSized = entries.every((e) => e.unitSizeValue > 0 && e.unitSizeKind) && kinds.size === 1;
  return allSized ? (e) => e.price / e.unitSizeValue : (e) => e.price;
}

// Picking the outright cheapest candidate trusts every store's own price
// data completely — verified live that's not always safe: one of Pingo
// Doce's own "Leite UHT Magro sem Lactose" listings showed €0.44 (a
// near-identical listing of the same product, same brand, same name,
// sat at €1.08) — almost certainly a stale/glitched price on their own
// site, not a real bargain. Genuinely different single-unit options for
// the same search (verified live: Pingo Doce's six-way "Arroz agulha"
// results, €1.15–€1.64 across different brands) aren't outliers of each
// other — they're a normal price spread the app exists to surface. The
// distinction: drop only a candidate priced far below the *median* of
// its own pool (a below-half-price listing is far more likely a data
// error than a real deal), which only ever fires with 3+ candidates —
// not enough data points below that to tell a true bargain from a glitch.
// All of this runs on rankMetric (unit price where possible), not the raw
// total.
function cheapestPlausible(entries) {
  const value = rankMetric(entries);
  if (entries.length < 3) return entries.reduce((best, e) => (value(e) < value(best) ? e : best));
  const sorted = entries.map(value).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const plausible = entries.filter((e) => value(e) >= median * 0.5);
  return plausible.reduce((best, e) => (value(e) < value(best) ? e : best));
}

// `selectBestCandidate` is per-store and blind to what the other stores
// matched. Once all 4 store entries are in (server.js searchAllStores),
// this flags any whose *unit* price is more than 3x the cheapest of the
// others — a strong "wrong product / wrong grade" signal when it's the
// same physical quantity (€/kg or €/L): a 20 kg dry-food bag matched to
// "ração húmida", a 36 g bacalhau snack, Água das Pedras at €5.39/L.
// Only fires when 3+ store entries have a comparable unit price of ONE
// kind — total-vs-total across stores is too noisy (pack sizes differ).
// server.js then re-runs the flagged store without its outlier pick.
const CROSS_STORE_OUTLIER_RATIO = 3;
function findCrossStoreOutliers(entries) {
  const sized = entries
    .filter((e) => e.price != null && !e.isPack && !e.excluded && e.unitSizeValue > 0 && e.unitSizeKind)
    .map((e) => ({ store: e.store, kind: e.unitSizeKind, u: (e.price * 1000) / e.unitSizeValue }));
  if (sized.length < 3 || new Set(sized.map((s) => s.kind)).size !== 1) return new Set();
  const out = new Set();
  for (const s of sized) {
    const minOther = Math.min(...sized.filter((o) => o.store !== s.store).map((o) => o.u));
    if (minOther > 0 && s.u > CROSS_STORE_OUTLIER_RATIO * minOther) out.add(s.store);
  }
  return out;
}

module.exports = {
  STORES,
  detectStore,
  scrapeUrl,
  searchAndScrapeStore,
  listStoreCandidates,
  scrapeChosenUrl,
  selectBestCandidate,
  parseCandidate,
  findCrossStoreOutliers,
  NoMatchError,
  // Pure helpers, exposed for the test suite (test/heuristics.test.js).
  // Not part of the app's public surface — nothing in server.js uses these.
  _test: {
    sanitizeSearchQuery,
    normalizeText,
    stemWord,
    significantWords,
    negatedWords,
    hasNegatedQueryWord,
    looksIrrelevant,
    looksLikeMultiPack,
    looksLikeSizeMismatch,
    parseSize,
    parseEmbSize,
    parsePackTotalSize,
    candidateSize,
    countExtraWords,
    headWordMismatch,
    hasUnrequestedFormWord,
    pickClosestNameMatches,
    rankMetric,
    cheapestPlausible,
    GENERIC_CATEGORY_WORDS,
    PROCESSED_FORM_WORDS,
    PREPARATION_WORDS,
    NEUTRAL_PACKAGING_WORDS,
  },
};
