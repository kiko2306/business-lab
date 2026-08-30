const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORES, searchAndScrapeStore, NoMatchError } = require('./scrapers');
const auth = require('./auth');
const push = require('./push');
const users = require('./users');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADSENSE_CLIENT_ID = process.env.ADSENSE_CLIENT_ID || '';

const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'products.json');
// Every account's data lives together in the same products.json, one flat
// list — each product carries the owning user's Google `sub` (userId).
// loadUserProducts()/saveUserProducts() below are the only things that
// touch the file on a per-user code path; the scheduler and the migration
// below work with the unfiltered list directly.
const CLAIM_FILE = path.join(DATA_DIR, 'legacy-claimed.json');

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

function loadAllProducts() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read products.json, starting empty:', err.message);
    return [];
  }
}

function saveAllProducts(products) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(products, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// One-time migration: this app ran single-user (no accounts at all) before
// Google login was added, so every product already in products.json has no
// userId. The first person who ever logs in is, in practice, the person
// who already owned that data — assign it all to them, once, tracked via
// CLAIM_FILE so a second/third user logging in later doesn't also inherit
// it.
function claimLegacyProductsIfNeeded(userId) {
  if (fs.existsSync(CLAIM_FILE)) return;
  const products = loadAllProducts();
  let changed = false;
  for (const p of products) {
    if (!p.userId) {
      p.userId = userId;
      changed = true;
    }
  }
  if (changed) saveAllProducts(products);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CLAIM_FILE, JSON.stringify({ claimedBy: userId, claimedAt: new Date().toISOString() }, null, 2));
}

function loadUserProducts(userId) {
  return loadAllProducts().filter((p) => p.userId === userId);
}

// Replaces this user's products within the full multi-user list, leaving
// every other user's products untouched.
function saveUserProducts(userId, userProducts) {
  const others = loadAllProducts().filter((p) => p.userId !== userId);
  saveAllProducts([...others, ...userProducts]);
}

// Searches one store for `name` and scrapes whichever product it ranks
// first — never throws. Two different kinds of failure are handled
// differently:
//   - A transient failure (network blip, page structure change) keeps
//     the previous known price/URL and just records the error, so a
//     temporary site hiccup doesn't wipe out the last good price shown.
//   - A NoMatchError — the store confidently doesn't carry a matching
//     product (see scrapers.js: no search results, or every candidate
//     was the wrong product/size) — clears price/URL instead of keeping
//     a stale one around. Carrying forward an old price here would show
//     a number for a product the store doesn't actually have, which is
//     worse than showing nothing (the frontend hides a store row
//     entirely when price is null — see app.js renderProductCard).
// Every *successful* scrape appends {price, scrapedAt} to `history`,
// carried forward from the previous entry — this is what the
// price-over-time chart is built from. A failed scrape doesn't add a
// point (nothing new was actually observed) but doesn't touch existing
// history either.
async function buildStoreEntry(store, name, previous) {
  const history = previous?.history ?? [];
  try {
    const {
      url,
      price,
      currency,
      name: scrapedName,
      unitSizeValue,
      unitSizeKind,
    } = await searchAndScrapeStore(store, name);
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
      unitSizeValue: unitSizeValue ?? null,
      unitSizeKind: unitSizeKind ?? null,
    };
  } catch (err) {
    const isNoMatch = err instanceof NoMatchError;
    return {
      url: isNoMatch ? null : previous?.url ?? null,
      store,
      price: isNoMatch ? null : previous?.price ?? null,
      currency: isNoMatch ? null : previous?.currency ?? null,
      scrapedName: isNoMatch ? null : previous?.scrapedName ?? null,
      scrapedAt: isNoMatch ? null : previous?.scrapedAt ?? null,
      error: err.message,
      history,
      unitSizeValue: isNoMatch ? null : previous?.unitSizeValue ?? null,
      unitSizeKind: isNoMatch ? null : previous?.unitSizeKind ?? null,
    };
  }
}

async function searchAllStores(name, previousEntries = []) {
  const previousByStore = new Map(previousEntries.map((e) => [e.store, e]));
  return Promise.all(
    Object.keys(STORES).map((store) => buildStoreEntry(store, name, previousByStore.get(store)))
  );
}

// A "drop" is only meaningful when comparing the same store's price before
// and after one refresh — not used on rename (PUT /api/products/:id),
// since a new name means a re-run search that may match a different
// product entirely, and comparing its price to the old name's price isn't
// a real price change of the same item.
const PRICE_DROP_THRESHOLD = 0.10;

function collectPriceDrops(productName, previousEntries, newEntries) {
  const previousByStore = new Map(previousEntries.map((e) => [e.store, e]));
  const drops = [];
  for (const entry of newEntries) {
    const previous = previousByStore.get(entry.store);
    if (!previous || previous.price == null || entry.price == null) continue;
    if (entry.price >= previous.price) continue;
    const pct = (previous.price - entry.price) / previous.price;
    if (pct < PRICE_DROP_THRESHOLD) continue;
    drops.push({ productName, store: entry.store, oldPrice: previous.price, newPrice: entry.price, pct });
  }
  return drops;
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
app.set('trust proxy', true); // behind NPM/Cloudflare Tunnel — needed so req.protocol reflects X-Forwarded-Proto for secure cookies
app.use(express.json());

app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store').type('html').send(renderIndexHtml());
});

// --- Google Sign-In ---
app.get('/auth/google', (req, res) => {
  if (!auth.isConfigured()) return res.status(503).send('Login com Google ainda não está configurado neste servidor.');
  res.redirect(auth.buildAuthUrl());
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?auth_error=' + encodeURIComponent(String(error)));
  if (!auth.consumeState(state)) return res.status(400).send('Pedido de autenticação inválido ou expirado — tente novamente.');
  try {
    const user = await auth.exchangeCode(code);
    claimLegacyProductsIfNeeded(user.sub);
    users.upsertProfile(user);
    const token = auth.createSession(user);
    auth.setSessionCookie(req, res, token);
    res.redirect('/');
  } catch (err) {
    console.error('Google auth failed:', err.message);
    res.redirect('/?auth_error=1');
  }
});

app.post('/auth/logout', (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|;\s*)pc_session=([^;]+)/)?.[1];
  if (token) auth.destroySession(token);
  auth.clearSessionCookie(res);
  res.status(204).end();
});

app.get('/api/me', (req, res) => {
  const user = auth.currentUser(req);
  if (!user) return res.status(401).json({ error: 'sessão não iniciada' });
  res.json({
    email: user.email,
    name: user.name,
    picture: user.picture,
    adsEnabled: Boolean(ADSENSE_CLIENT_ID) && users.adsEnabledFor(user.sub),
    isAdmin: Boolean(ADMIN_EMAIL) && user.email === ADMIN_EMAIL,
  });
});

// Public — the AdSense script needs this client-side; not a secret (it's
// visible in AdSense's own script tag on any page that uses it anyway).
app.get('/api/ads-config', (req, res) => {
  res.json({ clientId: ADSENSE_CLIENT_ID || null });
});

// --- Admin: VIP/paid status management ---
// Deliberately not under /api/products' requireAuth chain — gated by
// email match instead, since this isn't a per-product-owner action.
function requireAdmin(req, res, next) {
  const user = auth.currentUser(req);
  if (!user) return res.status(401).json({ error: 'sessão não iniciada' });
  if (!ADMIN_EMAIL || user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'acesso negado' });
  req.user = user;
  next();
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(users.listUsers());
});

app.post('/api/admin/users/:userId/vip', requireAdmin, (req, res) => {
  const ok = users.setVip(req.params.userId, Boolean(req.body?.isVip));
  if (!ok) return res.status(404).json({ error: 'utilizador não encontrado' });
  res.status(204).end();
});

app.post('/api/admin/users/:userId/paid', requireAdmin, (req, res) => {
  const ok = users.setPaid(req.params.userId, Boolean(req.body?.isPaid));
  if (!ok) return res.status(404).json({ error: 'utilizador não encontrado' });
  res.status(204).end();
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

// --- Push notifications (price drops) ---
app.get('/api/push/public-key', (req, res) => {
  if (!push.isConfigured()) return res.status(503).json({ error: 'notificações push não configuradas' });
  res.json({ publicKey: push.publicKey() });
});

app.post('/api/push/subscribe', auth.requireAuth, (req, res) => {
  const subscription = req.body;
  if (!subscription || typeof subscription.endpoint !== 'string') {
    return res.status(400).json({ error: 'subscrição inválida' });
  }
  push.addSubscription(req.user.sub, subscription);
  res.status(204).end();
});

app.post('/api/push/unsubscribe', auth.requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint em falta' });
  push.removeSubscription(req.user.sub, endpoint);
  res.status(204).end();
});

// Every /api/products* route from here on is per-user: requireAuth attaches
// req.user, and each handler only ever reads/writes that user's own slice
// of products.json (loadUserProducts/saveUserProducts) — there is no code
// path here that can read or modify another account's data.
app.use('/api/products', auth.requireAuth);

app.get('/api/products', (req, res) => {
  res.json(loadUserProducts(req.user.sub).sort((a, b) => a.name.localeCompare(b.name)));
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
    userId: req.user.sub,
    name: trimmedName,
    category: CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY,
    urls: entries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const products = loadUserProducts(req.user.sub);
  products.push(product);
  saveUserProducts(req.user.sub, products);
  res.status(201).json(product);
});

// Renaming re-runs the store searches with the new name — the old matches
// were found using the old name as the query, so they may no longer be the
// right product once it changes.
app.put('/api/products/:id', async (req, res) => {
  const products = loadUserProducts(req.user.sub);
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

  saveUserProducts(req.user.sub, products);
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  const products = loadUserProducts(req.user.sub);
  const next = products.filter((p) => p.id !== req.params.id);
  if (next.length === products.length) return res.status(404).json({ error: 'produto não encontrado' });
  saveUserProducts(req.user.sub, next);
  res.status(204).end();
});

// Re-runs the store searches for this product's current name.
app.post('/api/products/:id/refresh', async (req, res) => {
  const products = loadUserProducts(req.user.sub);
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  const previousEntries = product.urls;
  product.urls = await searchAllStores(product.name, previousEntries);
  product.updatedAt = new Date().toISOString();

  saveUserProducts(req.user.sub, products);
  const drops = collectPriceDrops(product.name, previousEntries, product.urls);
  if (drops.length) await push.notifyPriceDrops(req.user.sub, drops);
  res.json(product);
});

// Re-runs the store searches for every product belonging to one user, one
// at a time (not Promise.all across products — each product already fans
// out to 3 stores in parallel via searchAllStores, so this caps how many
// concurrent requests hit the store sites at once rather than firing dozens
// together). Shared by the manual "Update prices" button and, for every
// user at once, the daily scheduler below.
async function refreshProductsForUser(userId) {
  const products = loadUserProducts(userId);
  const allDrops = [];
  for (const product of products) {
    const previousEntries = product.urls;
    product.urls = await searchAllStores(product.name, previousEntries);
    product.updatedAt = new Date().toISOString();
    allDrops.push(...collectPriceDrops(product.name, previousEntries, product.urls));
  }
  saveUserProducts(userId, products);
  // One notification per refresh run, not one per drop — a run that finds
  // several drops (e.g. the daily 8am update) shouldn't spam a stack of
  // separate pushes.
  if (allDrops.length) await push.notifyPriceDrops(userId, allDrops);
  return products;
}

app.post('/api/products/refresh-all', async (req, res) => {
  res.json(await refreshProductsForUser(req.user.sub));
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
  const userIds = [...new Set(loadAllProducts().map((p) => p.userId).filter(Boolean))];
  for (const userId of userIds) {
    try {
      await refreshProductsForUser(userId);
    } catch (err) {
      console.error(`[schedule] daily update failed for user ${userId}:`, err.message);
    }
  }
  saveScheduleState({ lastRunDate: today });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`price-compare listening on :${PORT}`);
  checkScheduledUpdate(); // catch up immediately if the container was down through 08:00
  setInterval(checkScheduledUpdate, 15 * 60 * 1000);
});
