const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'items.json');
const UNITS = ['kg', 'g', 'l', 'uni'];

function loadItems() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read items.json, starting empty:', err.message);
    return [];
  }
}

// Write to a temp file then rename — avoids a half-written items.json if the
// process is killed mid-write (this is the only "database" this app has).
function saveItems(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function isValidUnit(unit) {
  return UNITS.includes(unit);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/items', (req, res) => {
  const items = loadItems().sort((a, b) => a.name.localeCompare(b.name));
  res.json(items);
});

app.post('/api/items', (req, res) => {
  const { name, unit, quantity, minStock, expirationDate } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!isValidUnit(unit)) {
    return res.status(400).json({ error: `unit must be one of: ${UNITS.join(', ')}` });
  }

  const items = loadItems();
  const item = {
    id: crypto.randomUUID(),
    name: name.trim(),
    unit,
    quantity: Math.max(0, toNumber(quantity, 0)),
    minStock: Math.max(0, toNumber(minStock, 0)),
    expirationDate: expirationDate || null,
    updatedAt: new Date().toISOString(),
  };
  items.push(item);
  saveItems(items);
  res.status(201).json(item);
});

app.put('/api/items/:id', (req, res) => {
  const items = loadItems();
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'item not found' });

  const { name, unit, quantity, minStock, expirationDate } = req.body || {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    item.name = name.trim();
  }
  if (unit !== undefined) {
    if (!isValidUnit(unit)) {
      return res.status(400).json({ error: `unit must be one of: ${UNITS.join(', ')}` });
    }
    item.unit = unit;
  }
  if (quantity !== undefined) item.quantity = Math.max(0, toNumber(quantity, item.quantity));
  if (minStock !== undefined) item.minStock = Math.max(0, toNumber(minStock, item.minStock));
  if (expirationDate !== undefined) item.expirationDate = expirationDate || null;
  item.updatedAt = new Date().toISOString();

  saveItems(items);
  res.json(item);
});

app.delete('/api/items/:id', (req, res) => {
  const items = loadItems();
  const next = items.filter((i) => i.id !== req.params.id);
  if (next.length === items.length) return res.status(404).json({ error: 'item not found' });
  saveItems(next);
  res.status(204).end();
});

// Deduct stock (the "use item" flow) — never goes below 0.
app.post('/api/items/:id/use', (req, res) => {
  const amount = toNumber((req.body || {}).amount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const items = loadItems();
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'item not found' });

  item.quantity = Math.max(0, item.quantity - amount);
  item.updatedAt = new Date().toISOString();
  saveItems(items);
  res.json(item);
});

// Add stock (e.g. after shopping).
app.post('/api/items/:id/restock', (req, res) => {
  const amount = toNumber((req.body || {}).amount, NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const items = loadItems();
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'item not found' });

  item.quantity += amount;
  item.updatedAt = new Date().toISOString();
  saveItems(items);
  res.json(item);
});

// Items at or below their minimum stock threshold, with how much is needed
// to get back up to that minimum.
app.get('/api/shopping-list', (req, res) => {
  const items = loadItems()
    .filter((i) => i.minStock > 0 && i.quantity <= i.minStock)
    .map((i) => ({ ...i, neededQty: Math.round((i.minStock - i.quantity) * 1000) / 1000 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(items);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`pantry listening on :${PORT}`));
