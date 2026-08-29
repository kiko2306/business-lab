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
const STORES = {
  continente: {
    label: 'Continente',
    hostSuffix: 'continente.pt',
    origin: 'https://www.continente.pt',
    searchUrl: (q) => `https://www.continente.pt/pesquisa/?q=${encodeURIComponent(q)}`,
    productLinkPattern: /href="(\/produto\/[^"?]+\.html)/,
  },
  pingodoce: {
    label: 'Pingo Doce',
    hostSuffix: 'pingodoce.pt',
    origin: 'https://www.pingodoce.pt',
    searchUrl: (q) =>
      `https://www.pingodoce.pt/on/demandware.store/Sites-pingo-doce-Site/default/Search-Show?q=${encodeURIComponent(q)}`,
    productLinkPattern: /href="(\/home\/produtos\/[^"?]+\.html)/,
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
    productLinkPattern: /(\/p\/[a-z0-9-]+\/p\d+)/,
  },
};

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

async function scrapeContinente(url) {
  const html = await fetchHtml(url);
  const result = extractJsonLdPrice(html);
  if (!result) throw new Error('price not found in page');
  return result;
}

async function scrapeLidl(url) {
  const html = await fetchHtml(url);
  const result = extractJsonLdPrice(html);
  if (!result) throw new Error('price not found in page');
  return result;
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
  if (!content || !Number.isFinite(price)) throw new Error('price not found in page');
  const name = $('h1.product-name, h1').first().text().trim() || undefined;
  return { price, currency: 'EUR', name };
}

const SCRAPERS = {
  continente: scrapeContinente,
  pingodoce: scrapePingoDoce,
  lidl: scrapeLidl,
};

async function scrapeUrl(url) {
  const store = detectStore(url);
  if (!store) throw new Error('unsupported store (not Continente, Pingo Doce, or Lidl)');
  const result = await SCRAPERS[store](url);
  return { store, ...result };
}

// Given a product name, searches the store and scrapes whichever product
// its search results ranks first — no product URL needed from the user at
// all. Less precise than a hand-picked product link (the top search result
// isn't guaranteed to be the exact product meant), but that trade-off is
// deliberate: see plan.md §22.9c.
async function searchAndScrapeStore(store, query) {
  const def = STORES[store];
  if (!def) throw new Error(`unknown store: ${store}`);

  const searchHtml = await fetchHtml(def.searchUrl(query));
  const match = def.productLinkPattern.exec(searchHtml);
  if (!match) throw new Error(`no search results found on ${def.label}`);

  const productUrl = new URL(match[1], def.origin).toString();
  const result = await SCRAPERS[store](productUrl);
  return { store, url: productUrl, ...result };
}

module.exports = { STORES, detectStore, scrapeUrl, searchAndScrapeStore };
