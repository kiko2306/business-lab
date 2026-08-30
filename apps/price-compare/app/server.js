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

// Persists a single product's fields against the file's *current* state
// (re-read immediately before writing), not a snapshot taken however long
// ago the caller started — see refreshProductsForUser below, whose bulk
// loop can run for minutes across a large catalog. Verified live: a user
// renamed "Água com gás das pedras" to "Agua das pedras" mid-refresh, and
// the refresh's own end-of-run save (the old code: load once, loop, save
// once) blew the rename away with its stale in-memory copy the moment it
// finished. Returns the updated product, or null if it was deleted
// concurrently (nothing to update, not an error).
function updateOneProduct(userId, productId, updates) {
  const products = loadAllProducts();
  const product = products.find((p) => p.id === productId && p.userId === userId);
  if (!product) return null;
  Object.assign(product, updates);
  saveAllProducts(products);
  return product;
}

// A simple append-only log, not part of products.json — a bug report is a
// point-in-time snapshot of what was wrong (the product's name and every
// store's price/URL/scrapedName at the moment reported), so it needs to
// survive independently of the product being edited, refreshed, or
// deleted afterwards.
const BUG_REPORTS_FILE = path.join(DATA_DIR, 'bug-reports.json');
function loadBugReports() {
  if (!fs.existsSync(BUG_REPORTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(BUG_REPORTS_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read bug-reports.json, starting fresh:', err.message);
    return [];
  }
}
function saveBugReports(reports) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = BUG_REPORTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reports, null, 2));
  fs.renameSync(tmp, BUG_REPORTS_FILE);
}
function appendBugReport(report) {
  const reports = loadBugReports();
  reports.push({ status: 'open', resolvedAt: null, resolvedBy: null, ...report });
  saveBugReports(reports);
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
      isPack,
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
      isPack: Boolean(isPack),
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
      isPack: isNoMatch ? false : previous?.isPack ?? false,
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

app.get('/api/admin/bug-reports', requireAdmin, (req, res) => {
  // Reports logged before the status field existed don't have one —
  // default them to "open" rather than showing as blank/unstyled.
  const reports = loadBugReports().map((r) => ({ status: 'open', ...r }));
  res.json(reports.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)));
});

// A report's outcome, not just a done/not-done flag — "resolved" means
// something was actually fixed because of it, "false_positive" means it
// was looked at and turned out not to be a bug (e.g. an ambiguous product
// name, not a matching bug — see plan.md §39's "Agua 1.5L" reports).
// Reversible (can go back to "open") in case a status gets set by mistake.
const BUG_REPORT_STATUSES = new Set(['open', 'resolved', 'false_positive']);
app.post('/api/admin/bug-reports/:id/status', requireAdmin, (req, res) => {
  const status = req.body?.status;
  if (!BUG_REPORT_STATUSES.has(status)) return res.status(400).json({ error: 'estado inválido' });

  const reports = loadBugReports();
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'relatório não encontrado' });

  report.status = status;
  report.resolvedAt = status === 'open' ? null : new Date().toISOString();
  report.resolvedBy = status === 'open' ? null : req.user.email;
  saveBugReports(reports);
  res.json(report);
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

// Logs the product's current name, category, and every store's price/URL/
// scrapedName exactly as shown when the user clicked the button — a
// snapshot to fix later, not a live reference (the product itself may get
// edited, refreshed, or deleted afterwards).
app.post('/api/products/:id/report-bug', (req, res) => {
  const products = loadUserProducts(req.user.sub);
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  // Which store's price row the user clicked "report" on — the report is
  // about one specific store's match, not the item as a whole, so this is
  // required rather than inferred; every other store's data is still
  // logged alongside it purely for context when fixing it later.
  const reportedStore = typeof req.body?.store === 'string' ? req.body.store : null;
  if (!reportedStore || !STORES[reportedStore]) {
    return res.status(400).json({ error: 'loja inválida' });
  }

  appendBugReport({
    id: crypto.randomUUID(),
    reportedAt: new Date().toISOString(),
    userId: req.user.sub,
    userEmail: req.user.email || null,
    productId: product.id,
    productName: product.name,
    category: product.category,
    reportedStore,
    note,
    stores: product.urls.map((u) => ({
      store: u.store,
      price: u.price,
      currency: u.currency,
      scrapedName: u.scrapedName,
      url: u.url,
      error: u.error,
    })),
  });

  res.status(201).json({ ok: true });
});

// Re-runs the store searches for every product belonging to one user, one
// at a time (not Promise.all across products — each product already fans
// out to 3 stores in parallel via searchAllStores, so this caps how many
// concurrent requests hit the store sites at once rather than firing dozens
// together). Shared by the manual "Update prices" button and, for every
// user at once, the daily scheduler below.
//
// Persists each product immediately via updateOneProduct rather than
// collecting every result in memory and saving once at the end — for a
// large catalog this loop can run for many minutes (hundreds of items ×
// 4 stores), and a single save at the end using product objects captured
// at the *start* of the loop would silently discard any edit, rename, or
// delete the user made in the meantime. See updateOneProduct's comment
// for the live case that caught this.
async function refreshProductsForUser(userId) {
  const products = loadUserProducts(userId);
  const allDrops = [];
  for (const product of products) {
    const previousEntries = product.urls;
    const urls = await searchAllStores(product.name, previousEntries);
    const updated = updateOneProduct(userId, product.id, { urls, updatedAt: new Date().toISOString() });
    if (!updated) continue; // deleted while this product's refresh was in flight — nothing left to update
    allDrops.push(...collectPriceDrops(product.name, previousEntries, urls));
  }
  // One notification per refresh run, not one per drop — a run that finds
  // several drops (e.g. the daily 8am update) shouldn't spam a stack of
  // separate pushes.
  if (allDrops.length) await push.notifyPriceDrops(userId, allDrops);
  return loadUserProducts(userId);
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
