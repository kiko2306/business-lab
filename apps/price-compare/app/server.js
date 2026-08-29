const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORES, scrapeUrl } = require('./scrapers');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'products.json');

// Stores with no scraper (login-walled) — price is entered by hand instead.
const MANUAL_STORES = {
  recheio: { label: 'Recheio' },
  makro: { label: 'Makro' },
};

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

// Scrapes one URL and returns the entry to store, never throwing — a failed
// scrape keeps the previous known price (if any) and just records the error,
// so a transient site hiccup doesn't wipe out the last good price shown.
async function buildUrlEntry(url, previous) {
  try {
    const { store, price, currency, name } = await scrapeUrl(url);
    return { url, store, price, currency, scrapedName: name || null, scrapedAt: new Date().toISOString(), error: null };
  } catch (err) {
    return {
      url,
      store: previous?.store ?? null,
      price: previous?.price ?? null,
      currency: previous?.currency ?? null,
      scrapedName: previous?.scrapedName ?? null,
      scrapedAt: previous?.scrapedAt ?? null,
      error: err.message,
    };
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/stores', (req, res) => {
  res.json({
    scraped: Object.fromEntries(Object.entries(STORES).map(([k, v]) => [k, v.label])),
    manual: Object.fromEntries(Object.entries(MANUAL_STORES).map(([k, v]) => [k, v.label])),
  });
});

app.get('/api/categories', (req, res) => res.json(CATEGORIES));

app.get('/api/products', (req, res) => {
  res.json(loadProducts().sort((a, b) => a.name.localeCompare(b.name)));
});

app.post('/api/products', async (req, res) => {
  const { name, urls, category } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const urlList = Array.isArray(urls) ? urls.filter((u) => typeof u === 'string' && u.trim()) : [];

  const entries = await Promise.all(urlList.map((u) => buildUrlEntry(u.trim())));

  const product = {
    id: crypto.randomUUID(),
    name: name.trim(),
    category: CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY,
    urls: entries,
    manualPrices: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const products = loadProducts();
  products.push(product);
  saveProducts(products);
  res.status(201).json(product);
});

app.put('/api/products/:id', async (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'product not found' });

  const { name, urls, category } = req.body || {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    product.name = name.trim();
  }
  if (category !== undefined) {
    product.category = CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY;
  }
  if (urls !== undefined) {
    const urlList = Array.isArray(urls) ? urls.filter((u) => typeof u === 'string' && u.trim()) : [];
    const previousByUrl = new Map(product.urls.map((e) => [e.url, e]));
    product.urls = await Promise.all(urlList.map((u) => buildUrlEntry(u.trim(), previousByUrl.get(u.trim()))));
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

// Re-scrapes every URL already on the product.
app.post('/api/products/:id/refresh', async (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'product not found' });

  product.urls = await Promise.all(product.urls.map((entry) => buildUrlEntry(entry.url, entry)));
  product.updatedAt = new Date().toISOString();

  saveProducts(products);
  res.json(product);
});

app.put('/api/products/:id/manual-price', (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'product not found' });

  const { store, price } = req.body || {};
  if (!MANUAL_STORES[store]) {
    return res.status(400).json({ error: `store must be one of: ${Object.keys(MANUAL_STORES).join(', ')}` });
  }

  if (price === null || price === '') {
    delete product.manualPrices[store];
  } else {
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'price must be a non-negative number' });
    product.manualPrices[store] = { price: n, updatedAt: new Date().toISOString() };
  }
  product.updatedAt = new Date().toISOString();

  saveProducts(products);
  res.json(product);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`price-compare listening on :${PORT}`));
