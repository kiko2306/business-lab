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
function looksLikeMultiPack({ html, name, url }) {
  if (name && /\bpack\b/i.test(name)) return true;
  if (url && (/\bpack\b/i.test(url) || URL_PACK_SIZE_PATTERN.test(url))) return true;
  if (html && PACK_TEXT_PATTERN.test(html)) return true;
  return false;
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
// deliberate: see plan.md §22.9c. Walks past the first few candidates when
// they look like multi-packs (see looksLikeMultiPack) — comparing a 6-pack's
// total price against another store's single-unit price is misleading, so
// a single-unit match is preferred whenever the search offers one.
const MAX_CANDIDATES_TRIED = 5;
async function searchAndScrapeStore(store, query) {
  const def = STORES[store];
  if (!def) throw new Error(`unknown store: ${store}`);

  const searchHtml = await fetchHtml(def.searchUrl(query));
  const candidates = extractCandidateUrls(def, searchHtml);
  if (!candidates.length) throw new Error(`sem resultados de pesquisa em ${def.label}`);

  let fallback = null;
  for (const productUrl of candidates.slice(0, MAX_CANDIDATES_TRIED)) {
    let scraped;
    try {
      scraped = await SCRAPERS[store](productUrl);
    } catch {
      continue; // this candidate's page didn't yield a price — try the next
    }
    const { html, ...result } = scraped;
    const entry = { store, url: productUrl, ...result };
    if (!looksLikeMultiPack({ html, name: result.name, url: productUrl })) {
      return entry;
    }
    if (!fallback) fallback = entry; // keep the first working result in case every candidate is a multi-pack
  }

  if (fallback) return fallback;
  throw new Error(`não foi possível obter um produto em ${def.label}`);
}

module.exports = { STORES, detectStore, scrapeUrl, searchAndScrapeStore };
