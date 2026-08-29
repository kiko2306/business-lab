const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORES, searchAndScrapeStore } = require('./scrapers');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'products.json');

// Portuguese grocery categories, matching how these stores organize their
// own sites — products are grouped by category in the UI, not by brand.
const CATEGORIES = [
  'Laticínios',
  'Bebidas',
  'Mercearia',
  'Frutas e Vegetais',
  'Talho',
  'Peixaria',
  'Padaria e Pastelaria',
  'Charcutaria e Queijos',
  'Congelados',
  'Limpeza',
  'Higiene',
  'Outros',
];
const DEFAULT_CATEGORY = 'Outros';

function loadProducts() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read products.json, starting empty:', err.message);
    return [];
  }
}

function saveProducts(products) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(products, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Searches one store for `name` and scrapes whichever product it ranks
// first — never throws — a failed search/scrape keeps the previous known
// price and URL (if any) and just records the error, so a transient site
// hiccup or a temporarily-off-catalogue product doesn't wipe out the last
// good price shown. Every *successful* scrape appends {price, scrapedAt} to
// `history`, carried forward from the previous entry — this is what the
// price-over-time chart is built from. A failed scrape doesn't add a point
// (nothing new was actually observed) but doesn't touch existing history
// either.
async function buildStoreEntry(store, name, previous) {
  const history = previous?.history ?? [];
  try {
    const { url, price, currency, name: scrapedName } = await searchAndScrapeStore(store, name);
    const scrapedAt = new Date().toISOString();
    return {
      url,
      store,
      price,
      currency,
      scrapedName: scrapedName || null,
      scrapedAt,
      error: null,
      history: [...history, { price, scrapedAt }],
    };
  } catch (err) {
    return {
      url: previous?.url ?? null,
      store,
      price: previous?.price ?? null,
      currency: previous?.currency ?? null,
      scrapedName: previous?.scrapedName ?? null,
      scrapedAt: previous?.scrapedAt ?? null,
      error: err.message,
      history,
    };
  }
}

async function searchAllStores(name, previousEntries = []) {
  const previousByStore = new Map(previousEntries.map((e) => [e.store, e]));
  return Promise.all(
    Object.keys(STORES).map((store) => buildStoreEntry(store, name, previousByStore.get(store)))
  );
}

// NPM's default nginx config overrides this app's own Cache-Control
// (max-age=0) with a much longer one for static-looking extensions like
// .js/.css — confirmed live: the public hostname served a 4h-old app.js
// well after a fresh deploy, so a user reporting a fixed bug as "still
// broken" was actually just seeing a stale cached bundle. Working around a
// caching layer we don't control (NPM's nginx, possibly Cloudflare's edge
// too) rather than fighting it: index.html is generated on every request
// with a version query string (hash of app.js + style.css's current mtimes)
// appended to their URLs, so a new deploy is a genuinely new URL — any
// cache holding the old one is simply never consulted, regardless of its
// TTL. index.html itself is served with Cache-Control: no-store so it's
// never the thing that's stale.
function assetVersion() {
  const files = ['app.js', 'style.css'].map((f) => path.join(__dirname, 'public', f));
  const mtimes = files.map((f) => fs.statSync(f).mtimeMs).join(',');
  return crypto.createHash('md5').update(mtimes).digest('hex').slice(0, 10);
}

function renderIndexHtml() {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const v = assetVersion();
  return html.replace('app.js"', `app.js?v=${v}"`).replace('style.css"', `style.css?v=${v}"`);
}

const app = express();
app.use(express.json());

app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store').type('html').send(renderIndexHtml());
});

// express's static mime lookup doesn't always know .webmanifest — set it
// explicitly rather than relying on that, same reasoning as the nginx
// config in apps/kitchen-switcher.
app.get('/manifest.webmanifest', (req, res) => {
  res.set('Cache-Control', 'no-store').type('application/manifest+json').sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/stores', (req, res) => {
  res.json({
    scraped: Object.fromEntries(Object.entries(STORES).map(([k, v]) => [k, v.label])),
  });
});

app.get('/api/categories', (req, res) => res.json(CATEGORIES));

app.get('/api/products', (req, res) => {
  res.json(loadProducts().sort((a, b) => a.name.localeCompare(b.name)));
});

app.post('/api/products', async (req, res) => {
  const { name, category } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'o nome é obrigatório' });
  }
  const trimmedName = name.trim();

  const entries = await searchAllStores(trimmedName);

  const product = {
    id: crypto.randomUUID(),
    name: trimmedName,
    category: CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY,
    urls: entries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const products = loadProducts();
  products.push(product);
  saveProducts(products);
  res.status(201).json(product);
});

// Renaming re-runs the store searches with the new name — the old matches
// were found using the old name as the query, so they may no longer be the
// right product once it changes.
app.put('/api/products/:id', async (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  const { name, category } = req.body || {};
  if (category !== undefined) {
    product.category = CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY;
  }
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'o nome não pode estar vazio' });
    const trimmedName = name.trim();
    if (trimmedName !== product.name) {
      product.name = trimmedName;
      product.urls = await searchAllStores(trimmedName, product.urls);
    }
  }
  product.updatedAt = new Date().toISOString();

  saveProducts(products);
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  const products = loadProducts();
  const next = products.filter((p) => p.id !== req.params.id);
  if (next.length === products.length) return res.status(404).json({ error: 'produto não encontrado' });
  saveProducts(next);
  res.status(204).end();
});

// Re-runs the store searches for this product's current name.
app.post('/api/products/:id/refresh', async (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  product.urls = await searchAllStores(product.name, product.urls);
  product.updatedAt = new Date().toISOString();

  saveProducts(products);
  res.json(product);
});

// Re-runs the store searches for every product, one at a time (not
// Promise.all across products — each product already fans out to 3 stores
// in parallel via searchAllStores, so this caps how many concurrent
// requests hit the store sites at once rather than firing dozens together).
// Shared by the manual "Update prices" button (POST /refresh-all below) and
// the daily scheduler.
async function refreshAllProducts() {
  const products = loadProducts();
  for (const product of products) {
    product.urls = await searchAllStores(product.name, product.urls);
    product.updatedAt = new Date().toISOString();
  }
  saveProducts(products);
  return products;
}

app.post('/api/products/refresh-all', async (req, res) => {
  res.json(await refreshAllProducts());
});

// --- Daily scheduled update ---
// Same "poll every so often, compare against a stored last-run date"
// pattern as the main dashboard's backup scheduler (see plan.md §18.3) —
// no host-level cron, consistent with this project not needing any
// console/host configuration beyond the initial ./start.sh. Checked every
// 15 minutes (cheap) rather than computing an exact ms-until-8am timer, so
// a container restart mid-window still catches the run instead of missing
// it entirely.
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const SCHEDULED_HOUR = 8;

function todayLocalDateString() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, locale-stable
}

function loadScheduleState() {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  } catch {
    return { lastRunDate: null };
  }
}

function saveScheduleState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(state, null, 2));
}

async function checkScheduledUpdate() {
  const now = new Date();
  const today = todayLocalDateString();
  const state = loadScheduleState();
  if (now.getHours() < SCHEDULED_HOUR || state.lastRunDate === today) return;

  console.log(`[schedule] running daily update for ${today}`);
  try {
    await refreshAllProducts();
  } catch (err) {
    console.error('[schedule] daily update failed:', err.message);
  }
  saveScheduleState({ lastRunDate: today });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`price-compare listening on :${PORT}`);
  checkScheduledUpdate(); // catch up immediately if the container was down through 08:00
  setInterval(checkScheduledUpdate, 15 * 60 * 1000);
});
