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
const STORES = {
  continente: {
    label: 'Continente',
    hostSuffix: 'continente.pt',
    origin: 'https://www.continente.pt',
    searchUrl: (q) => `https://www.continente.pt/pesquisa/?q=${encodeURIComponent(q)}`,
    productLinkPattern: /href="(\/produto\/[^"?]+\.html)/g,
  },
  pingodoce: {
    label: 'Pingo Doce',
    hostSuffix: 'pingodoce.pt',
    origin: 'https://www.pingodoce.pt',
    searchUrl: (q) =>
      `https://www.pingodoce.pt/on/demandware.store/Sites-pingo-doce-Site/default/Search-Show?q=${encodeURIComponent(q)}`,
    productLinkPattern: /href="(\/home\/produtos\/[^"?]+\.html)/g,
  },
  lidl: {
    label: 'Lidl',
    hostSuffix: 'lidl.pt',
    origin: 'https://www.lidl.pt',
    searchUrl: (q) => `https://www.lidl.pt/q/search?q=${encodeURIComponent(q)}`,
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
    searchUrl: (q) => `https://www.auchan.pt/pt/pesquisa/?q=${encodeURIComponent(q)}`,
    productLinkPattern: /href="(\/pt\/[^"?]+\/\d+\.html)/g,
  },
};

// A search for e.g. "leite meio gordo" can rank a 6-pack above the single
// carton — comparing a pack's total price against another store's per-unit
// price is meaningless. Verified live: Continente's multi-pack size lives
// in a dedicated "emb. 6 x 1 lt" element, Pingo Doce/Lidl multi-packs say
// "pack" right in the URL slug or product name (Lidl: "Pack 8x1 L"). None
// of these signals alone covers every store, so check all of them together.
const PACK_TEXT_PATTERN = /\bemb\.?\s*\d+\s*x\s*[\d.,]+\s*(l|lt|kg|g|un|ml)\b/i;
// Auchan's product-URL slugs put the pack size right in the slug with no
// "emb." prefix and no "pack" word at all (e.g. .../meio-gordo-6x1l/...,
// .../meio-gordo-3x200ml/...) — PACK_TEXT_PATTERN and the "pack" checks
// below both miss this, so check for the bare NxSIZE shape too.
const URL_PACK_SIZE_PATTERN = /\b\d+\s*x\s*[\d.,]+\s*(l|lt|kg|g|un|ml)\b/i;

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
const SIZE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(kg|g|lt|l|ml)\b/i;
const UNIT_TO_GRAMS_OR_ML = { kg: 1000, g: 1, l: 1000, lt: 1000, ml: 1 };

function parseSize(text) {
  if (!text) return null;
  const m = SIZE_PATTERN.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  return value * UNIT_TO_GRAMS_OR_ML[unit];
}

// A raw page's HTML is too noisy to scan for "any number followed by a
// unit" — verified live: Lidl's own per-kg unit-price label ("1 kg =
// 0.85") sits right next to the real "Emb. 2 kg" package-size label, and
// a generic scan matches whichever comes first, which isn't reliably the
// package size. Deliberately restricted to the same "Emb. N unit" shape
// multi-pack detection already looks for (just without requiring the
// "x" multiplier), so it only ever reads the actual package-size label.
const EMB_SIZE_PATTERN = /\bemb\.?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lt|l|ml)\b/i;
function parseEmbSize(html) {
  if (!html) return null;
  const m = EMB_SIZE_PATTERN.exec(html);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  return value * UNIT_TO_GRAMS_OR_ML[unit];
}

// Looks for the size stated directly on the candidate's own product name
// first (most reliable — e.g. Auchan states it right there), then the
// page's "Emb. N kg" label (Lidl/Continente); never the raw URL or a
// generic page scan, both too noisy (see EMB_SIZE_PATTERN above).
function candidateSize({ html, name }) {
  return parseSize(name) ?? parseEmbSize(html);
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
  const ratio = actual / expected;
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
    .replace(/[̀-ͯ]/g, ''); // strip accents so "açúcar"/"acucar" compare equal
}

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'e', 'ou', 'para', 'em', 'no', 'na']);
function significantWords(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
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
// Word-overlap alone isn't enough once picking the *cheapest* candidate
// (see searchAndScrapeStore) rather than just the first one — verified
// live: "Leite meio gordo" shares 3 of 3 words with "Leite Magro/
// Meio-gordo sem Lactose" (a lactose-free variant) and that variant
// happened to be a few cents cheaper, so it won purely on price despite
// being a materially different product. These marker words each signal a
// distinct product variant regardless of how many other words overlap —
// a candidate carrying one that the query didn't ask for is rejected
// outright, not just down-weighted.
const VARIANT_MARKERS = [
  'lactose',
  'gluten',
  'proteina',
  'proteico',
  'proteica',
  'integral',
  'organico',
  'biologico',
  'zero',
  'light',
  'diet',
  'descafeinado',
  // Verified live: "Iogurte Natural Danone" (€1.29) matched Pingo Doce's
  // "Iogurte Grego Natural Oikos Danone" (€4.79, ~3.7x) — "grego" (Greek
  // yogurt, a thicker/pricier style) is a real product-line qualifier
  // the plain-word-overlap check didn't weigh any differently than
  // incidental phrasing.
  'grego',
  'skyr',
];
function hasConflictingVariantMarker(queryWords, candidateWords) {
  return VARIANT_MARKERS.some((marker) => candidateWords.has(marker) && !queryWords.includes(marker));
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
]);

function looksIrrelevant(query, candidateName) {
  if (!candidateName) return false; // nothing to judge against — don't block on missing data
  const queryWords = significantWords(query);
  if (!queryWords.length) return false;
  if (hasNegatedQueryWord(query, candidateName)) return true;
  const candidateWords = new Set(significantWords(candidateName));
  if (hasConflictingVariantMarker(queryWords, candidateWords)) return true;

  // Check against the query's more distinguishing (non-generic) words
  // when there are any — falls back to the full word list for a query
  // that's nothing *but* a generic word (e.g. "Açúcar 1 kg" once its
  // size is stripped out leaves only "açúcar"), so that case still
  // requires its one real word rather than passing everything.
  const specificWords = queryWords.filter((w) => !GENERIC_CATEGORY_WORDS.has(w));
  const wordsToCheck = specificWords.length ? specificWords : queryWords;
  const required = wordsToCheck.length === 1 ? 1 : 2;
  const matches = wordsToCheck.filter((w) => candidateWords.has(w)).length;
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

async function scrapeLidl(url) {
  const html = await fetchHtml(url);
  const result = extractJsonLdPrice(html);
  if (!result) throw new Error('preço não encontrado na página');
  return { ...result, html };
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
const MAX_CANDIDATES_TRIED = 5;
async function searchAndScrapeStore(store, query) {
  const def = STORES[store];
  if (!def) throw new Error(`unknown store: ${store}`);

  const searchHtml = await fetchHtml(def.searchUrl(query));
  const candidates = extractCandidateUrls(def, searchHtml);
  if (!candidates.length) throw new NoMatchError(`sem resultados de pesquisa em ${def.label}`);

  const singleUnitEntries = [];
  const packEntries = [];
  for (const productUrl of candidates.slice(0, MAX_CANDIDATES_TRIED)) {
    let scraped;
    try {
      scraped = await SCRAPERS[store](productUrl);
    } catch {
      continue; // this candidate's page didn't yield a price — try the next
    }
    const { html, ...result } = scraped;
    if (result.price == null) continue;
    const entry = { store, url: productUrl, ...result };
    // A wrong product entirely, or the right product at a clearly wrong
    // size, is never usable — not even as a last-resort fallback, since
    // showing it at all would be a misleading price, worse than showing
    // none.
    if (looksIrrelevant(query, result.name) || looksLikeSizeMismatch(query, { html, name: result.name, url: productUrl })) {
      continue;
    }
    (looksLikeMultiPack({ html, name: result.name, url: productUrl }) ? packEntries : singleUnitEntries).push(entry);
  }

  const pool = singleUnitEntries.length ? singleUnitEntries : packEntries;
  if (!pool.length) throw new NoMatchError(`não foi possível obter um produto em ${def.label}`);
  return cheapestPlausible(pool);
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
function cheapestPlausible(entries) {
  if (entries.length < 3) return entries.reduce((cheapest, e) => (e.price < cheapest.price ? e : cheapest));
  const sortedPrices = entries.map((e) => e.price).sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
  const plausible = entries.filter((e) => e.price >= median * 0.5);
  return plausible.reduce((cheapest, e) => (e.price < cheapest.price ? e : cheapest));
}

module.exports = { STORES, detectStore, scrapeUrl, searchAndScrapeStore, NoMatchError };
