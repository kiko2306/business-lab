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
// good price shown.
async function buildStoreEntry(store, name, previous) {
  try {
    const { url, price, currency, name: scrapedName } = await searchAndScrapeStore(store, name);
    return { url, store, price, currency, scrapedName: scrapedName || null, scrapedAt: new Date().toISOString(), error: null };
  } catch (err) {
    return {
      url: previous?.url ?? null,
      store,
      price: previous?.price ?? null,
      currency: previous?.currency ?? null,
      scrapedName: previous?.scrapedName ?? null,
      scrapedAt: previous?.scrapedAt ?? null,
      error: err.message,
    };
  }
}

async function searchAllStores(name, previousEntries = []) {
  const previousByStore = new Map(previousEntries.map((e) => [e.store, e]));
  return Promise.all(
    Object.keys(STORES).map((store) => buildStoreEntry(store, name, previousByStore.get(store)))
  );
}

const app = express();
app.use(express.json());
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
    return res.status(400).json({ error: 'name is required' });
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
  if (!product) return res.status(404).json({ error: 'product not found' });

  const { name, category } = req.body || {};
  if (category !== undefined) {
    product.category = CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY;
  }
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
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
  if (next.length === products.length) return res.status(404).json({ error: 'product not found' });
  saveProducts(next);
  res.status(204).end();
});

// Re-runs the store searches for this product's current name.
app.post('/api/products/:id/refresh', async (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'product not found' });

  product.urls = await searchAllStores(product.name, product.urls);
  product.updatedAt = new Date().toISOString();

  saveProducts(products);
  res.json(product);
});

// Re-runs the store searches for every product, one at a time (not
// Promise.all across products — each product already fans out to 3 stores
// in parallel via searchAllStores, so this caps how many concurrent
// requests hit the store sites at once rather than firing dozens together).
app.post('/api/products/refresh-all', async (req, res) => {
  const products = loadProducts();
  for (const product of products) {
    product.urls = await searchAllStores(product.name, product.urls);
    product.updatedAt = new Date().toISOString();
  }
  saveProducts(products);
  res.json(products);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`price-compare listening on :${PORT}`));
