const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  STORES,
  searchAndScrapeStore,
  listStoreCandidates,
  scrapeChosenUrl,
  detectStore,
  findCrossStoreOutliers,
  NoMatchError,
} = require('./scrapers');
const auth = require('./auth');
const push = require('./push');
const users = require('./users');
const shares = require('./shares');
const aiMatch = require('./aiMatch');

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

// Brand is optional and separate from the item name — a query like "Água
// 1.5L" with no brand at all is far more likely to land on an unrelated
// product (see plan.md §41: it fell through to a canned-tuna listing once
// the wrong-size candidate got correctly filtered out) since there's
// nothing left to discriminate on beyond a single generic word. Stored
// separately from `name` (shown separately in the UI too) rather than
// baked into one string, but combined into a single query whenever it's
// actually sent to a store's search.
function searchQueryFor(product) {
  return product.brand ? `${product.name} ${product.brand}` : product.name;
}

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

// Shopping list entries reference a product + one specific store, not a
// frozen price — deliberately *not* a snapshot like a bug report, since
// the whole point is checking current prices before buying, and a price
// that drifted since it was added should show the drift, not a stale
// number. Kept in its own file rather than embedded in products.json:
// the list is a cross-cutting view over products the user already has
// (or once had), not a property of the product itself.
const SHOPPING_LIST_FILE = path.join(DATA_DIR, 'shopping-list.json');
function loadShoppingList() {
  if (!fs.existsSync(SHOPPING_LIST_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHOPPING_LIST_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read shopping-list.json, starting fresh:', err.message);
    return [];
  }
}
function saveShoppingList(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SHOPPING_LIST_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, SHOPPING_LIST_FILE);
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
// history either. The history is capped (see appendHistory): it grew
// unbounded before, and products.json is re-read and rewritten on every
// single product update (updateOneProduct), so an ever-growing file makes
// every refresh slower for data nobody looks at.
// `override` (optional) is this product's user-set override for this store
// (product.overrides[store], see PUT /api/products/:id/override):
//   { excluded: true } — the user said this store doesn't carry the item;
//     emit a placeholder entry (price null, so no row renders) that the
//     coverage indicator can tell apart from a plain no-match.
//   { url } — the user hand-picked the exact product page; scrape that,
//     skipping search + candidate selection entirely.
// Keeps the chart useful without letting one store entry's history grow
// forever: drop points older than a year, then keep at most MAX_HISTORY
// (the most recent ones). At the daily 08:00 refresh that's ~365/year, so
// the age rule usually does the work and the count is the backstop against
// a day of manual refreshing.
const MAX_HISTORY_POINTS = 400;
const MAX_HISTORY_AGE_MS = 365 * 24 * 60 * 60 * 1000;
function appendHistory(history, point) {
  const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
  const kept = history.filter((h) => {
    const t = Date.parse(h?.scrapedAt);
    return !Number.isFinite(t) || t >= cutoff; // undated legacy points are kept
  });
  return [...kept, point].slice(-MAX_HISTORY_POINTS);
}

async function buildStoreEntry(store, name, previous, override, excludeUrls) {
  const history = previous?.history ?? [];
  if (override?.excluded) {
    return {
      url: null, store, price: null, currency: null, scrapedName: null,
      scrapedAt: null, error: null, excluded: true, pinned: false, history,
      unitSizeValue: null, unitSizeKind: null, isPack: false,
    };
  }
  const pinned = Boolean(override?.url);
  try {
    const {
      url,
      price,
      currency,
      name: scrapedName,
      unitSizeValue,
      unitSizeKind,
      isPack,
      aiMatched,
    } = pinned
      ? await scrapeChosenUrl(store, override.url)
      : await searchAndScrapeStore(store, name, excludeUrls, aiMatch, previous?.aiMatched ? previous.url : null);
    const scrapedAt = new Date().toISOString();
    return {
      url,
      store,
      price,
      currency,
      scrapedName: scrapedName || null,
      scrapedAt,
      error: null,
      pinned,
      aiMatched: Boolean(aiMatched),
      history: appendHistory(history, { price, scrapedAt }),
      unitSizeValue: unitSizeValue ?? null,
      unitSizeKind: unitSizeKind ?? null,
      isPack: Boolean(isPack),
    };
  } catch (err) {
    // A pinned URL that fails is treated like a transient failure (keep the
    // last known price), never a NoMatch — the user asserted this is the
    // right page, so a bad fetch shouldn't silently drop it.
    const isNoMatch = !pinned && err instanceof NoMatchError;
    return {
      url: isNoMatch ? null : previous?.url ?? (pinned ? override.url : null),
      store,
      price: isNoMatch ? null : previous?.price ?? null,
      currency: isNoMatch ? null : previous?.currency ?? null,
      scrapedName: isNoMatch ? null : previous?.scrapedName ?? null,
      scrapedAt: isNoMatch ? null : previous?.scrapedAt ?? null,
      error: err.message,
      pinned,
      history,
      unitSizeValue: isNoMatch ? null : previous?.unitSizeValue ?? null,
      unitSizeKind: isNoMatch ? null : previous?.unitSizeKind ?? null,
      isPack: isNoMatch ? false : previous?.isPack ?? false,
    };
  }
}

async function searchAllStores(name, previousEntries = [], overrides = {}) {
  const previousByStore = new Map(previousEntries.map((e) => [e.store, e]));
  let entries = await Promise.all(
    Object.keys(STORES).map((store) =>
      buildStoreEntry(store, name, previousByStore.get(store), overrides[store])
    )
  );

  // Cross-store outlier pass (scrapers.findCrossStoreOutliers): if one
  // store's unit price is >3x the cheapest of the others (same €/kg or
  // €/L), re-run that store without its outlier pick. A user-pinned store
  // is left alone. One retry per store; if the re-pick is still an outlier
  // or a no-match, that store is cleared with a "preço díspar" note.
  const outliers = findCrossStoreOutliers(entries);
  for (const store of outliers) {
    if (overrides[store]?.url) continue;
    const bad = entries.find((e) => e.store === store);
    const redo = await buildStoreEntry(
      store,
      name,
      previousByStore.get(store),
      overrides[store],
      new Set([bad.url].filter(Boolean))
    );
    const idx = entries.indexOf(bad);
    const stillOutlier = findCrossStoreOutliers(
      entries.map((e) => (e.store === store ? redo : e))
    ).has(store);
    entries[idx] =
      redo.price != null && !stillOutlier
        ? redo
        : {
            url: null, store, price: null, currency: null, scrapedName: null,
            scrapedAt: null, error: 'preço muito diferente das outras lojas',
            pinned: false, history: bad.history ?? [],
            unitSizeValue: null, unitSizeKind: null, isPack: false,
          };
  }
  return entries;
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
    shares.bindPendingInvites(user); // attach userId to invites sent to this email pre-signup
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
  // users.json is written lazily — only when a user logs in (users.js
  // upsertProfile). An account that owns products but hasn't logged in
  // since accounts were introduced isn't in it, so it never showed up
  // here. Union in every distinct product owner as a stub so the admin
  // can grant VIP ahead of that person's next login; email/name fill
  // themselves in once they do log in.
  const known = users.listUsers();
  const knownIds = new Set(known.map((u) => u.userId));
  const stubs = [...new Set(loadAllProducts().map((p) => p.userId))]
    .filter((id) => id && !knownIds.has(id))
    .map((userId) => ({ userId, isVip: false, isPaid: false, email: null, name: null, lastLoginAt: null }));
  res.json([...known, ...stubs]);
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

// --- Sharing: let another account co-edit my products + shopping list ---
// The grant lives in shares.js; these routes are about the *actor*
// (req.user), so they are not behind resolveWorkspace. The invitee must
// accept in-app before anything is shared; see shares.js for the rules.
app.get('/api/shares', auth.requireAuth, (req, res) => {
  const outgoing = shares
    .listForOwner(req.user.sub)
    .filter((r) => r.status !== 'revoked') // the owner's own teardown — no need to show it back
    .map((r) => ({
      id: r.id,
      inviteeEmail: r.inviteeEmail,
      status: r.status,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt,
    }));
  const incoming = shares
    .listForInvitee({ userId: req.user.sub, email: req.user.email })
    .filter((r) => r.status === 'pending' || r.status === 'accepted')
    .map((r) => ({
      id: r.id,
      ownerUserId: r.ownerUserId,
      ownerEmail: r.ownerEmail,
      ownerName: r.ownerName,
      status: r.status,
      createdAt: r.createdAt,
    }));
  res.json({ outgoing, incoming });
});

app.post('/api/shares', auth.requireAuth, (req, res) => {
  try {
    const row = shares.createInvite({ owner: req.user, inviteeEmail: req.body?.email });
    // Optional nudge if the invitee already has an account + push enabled.
    push.notify?.(row.inviteeUserId, {
      title: 'Convite de partilha',
      body: `${req.user.name || req.user.email} quer partilhar listas consigo.`,
    });
    res.status(201).json({ id: row.id, inviteeEmail: row.inviteeEmail, status: row.status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/shares/:id/:action(accept|decline)', auth.requireAuth, (req, res) => {
  try {
    const row = shares.respond(req.params.id, req.user, req.params.action);
    if (row.status === 'accepted') {
      push.notify?.(row.ownerUserId, {
        title: 'Partilha aceite',
        body: `${req.user.name || req.user.email} aceitou a sua partilha.`,
      });
    }
    res.json({ id: row.id, status: row.status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/shares/:id', auth.requireAuth, (req, res) => {
  try {
    shares.remove(req.params.id, req.user.sub);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
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

// Every /api/products* and /api/shopping-list* route from here on is
// scoped to a *workspace* — by default the caller's own account, but if
// they hold an accepted share (shares.js) they can act on the owner's
// data by sending that owner's id in an X-Workspace header. resolveWorkspace
// checks the grant and sets req.workspaceId; handlers use req.workspaceId
// for all data reads/writes and keep req.user.* only for actor identity
// (e.g. bug-report provenance). Without the header, behaviour is exactly
// as before — a caller only ever touches their own slice.
function resolveWorkspace(req, res, next) {
  const requested = req.get('X-Workspace') || req.query.workspace;
  if (!requested || requested === req.user.sub) {
    req.workspaceId = req.user.sub;
    return next();
  }
  if (shares.isSharedWith(requested, req.user.sub)) {
    req.workspaceId = requested;
    return next();
  }
  return res.status(403).json({ error: 'sem acesso a esta partilha' });
}

// --- Single-editor lock for shared workspaces ---
// A list that is shared with someone can be edited by two people at once,
// against the same flat JSON file. So a shared workspace gets a
// one-editor-at-a-time advisory lock, held in memory (like refreshJobs /
// sessions — a restart clears it, which is the safe direction). The
// holder refreshes it with a heartbeat; a lock older than the TTL is
// treated as free, so a closed tab or a crash can't freeze the list.
const editLocks = new Map(); // workspaceId -> { sub, email, name, touchedAt }
const EDIT_LOCK_TTL_MS = 90_000;

function currentLock(workspaceId) {
  const l = editLocks.get(workspaceId);
  if (!l) return null;
  if (Date.now() - l.touchedAt > EDIT_LOCK_TTL_MS) {
    editLocks.delete(workspaceId);
    return null;
  }
  return l;
}

// Blocks a *mutating* request on a shared workspace unless the caller
// holds (or can take) the lock. Reads are never blocked. A private
// workspace (shared with nobody) skips this entirely — no coordination
// needed. A successful pass (re)acquires the lock for the TTL, so a
// client that writes without an explicit PUT /api/workspace/lock still
// can't be raced by another writer.
function requireEditLock(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!shares.isShared(req.workspaceId)) return next();
  const l = currentLock(req.workspaceId);
  if (l && l.sub !== req.user.sub) {
    return res
      .status(409)
      .json({ error: 'Outra pessoa está a editar esta lista.', heldBy: { name: l.name, email: l.email } });
  }
  editLocks.set(req.workspaceId, {
    sub: req.user.sub,
    email: req.user.email,
    name: req.user.name || req.user.email,
    touchedAt: Date.now(),
  });
  next();
}

app.use('/api/workspace', auth.requireAuth, resolveWorkspace);

app.get('/api/workspace/lock', (req, res) => {
  const l = currentLock(req.workspaceId);
  res.json({
    shared: shares.isShared(req.workspaceId),
    locked: Boolean(l),
    heldByMe: Boolean(l && l.sub === req.user.sub),
    heldBy: l && l.sub !== req.user.sub ? { name: l.name, email: l.email } : null,
    since: l ? l.touchedAt : null,
  });
});

// Acquire or refresh. `{ steal: true }` takes it from a live holder (the
// "Tomar controlo" button); without it, a held lock returns 409.
app.put('/api/workspace/lock', (req, res) => {
  const l = currentLock(req.workspaceId);
  if (l && l.sub !== req.user.sub && !req.body?.steal) {
    return res.status(409).json({
      error: 'Outra pessoa está a editar esta lista.',
      heldBy: { name: l.name, email: l.email },
      since: l.touchedAt,
    });
  }
  editLocks.set(req.workspaceId, {
    sub: req.user.sub,
    email: req.user.email,
    name: req.user.name || req.user.email,
    touchedAt: Date.now(),
  });
  res.json({ ok: true, heldByMe: true, shared: shares.isShared(req.workspaceId) });
});

app.delete('/api/workspace/lock', (req, res) => {
  const l = editLocks.get(req.workspaceId);
  if (l && l.sub === req.user.sub) editLocks.delete(req.workspaceId);
  res.status(204).end();
});

app.use('/api/products', auth.requireAuth, resolveWorkspace, requireEditLock);

app.get('/api/products', (req, res) => {
  res.json(loadUserProducts(req.workspaceId).sort((a, b) => a.name.localeCompare(b.name)));
});

app.post('/api/products', async (req, res) => {
  const { name, brand, category } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'o nome é obrigatório' });
  }
  const trimmedName = name.trim();
  const trimmedBrand = typeof brand === 'string' ? brand.trim() : '';

  const entries = await searchAllStores(searchQueryFor({ name: trimmedName, brand: trimmedBrand }));

  const product = {
    id: crypto.randomUUID(),
    userId: req.workspaceId, // the workspace owner owns the product, not necessarily the actor
    name: trimmedName,
    brand: trimmedBrand,
    category: CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY,
    urls: entries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const products = loadUserProducts(req.workspaceId);
  products.push(product);
  saveUserProducts(req.workspaceId, products);
  res.status(201).json(product);
});

// Changing the name or brand re-runs the store searches with the new
// query — the old matches were found using the old query, so they may no
// longer be the right product once either half of it changes.
app.put('/api/products/:id', async (req, res) => {
  const products = loadUserProducts(req.workspaceId);
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  const { name, brand, category } = req.body || {};
  if (category !== undefined) {
    product.category = CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY;
  }
  let queryChanged = false;
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'o nome não pode estar vazio' });
    const trimmedName = name.trim();
    if (trimmedName !== product.name) {
      product.name = trimmedName;
      queryChanged = true;
    }
  }
  if (brand !== undefined) {
    const trimmedBrand = typeof brand === 'string' ? brand.trim() : '';
    if (trimmedBrand !== (product.brand || '')) {
      product.brand = trimmedBrand;
      queryChanged = true;
    }
  }
  if (queryChanged) {
    product.urls = await searchAllStores(searchQueryFor(product), product.urls, product.overrides || {});
  }
  product.updatedAt = new Date().toISOString();

  saveUserProducts(req.workspaceId, products);
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  const products = loadUserProducts(req.workspaceId);
  const next = products.filter((p) => p.id !== req.params.id);
  if (next.length === products.length) return res.status(404).json({ error: 'produto não encontrado' });
  saveUserProducts(req.workspaceId, next);
  // Also drop any shopping-list entries pointing at the now-deleted
  // product — otherwise they'd linger as orphans the GET route has to
  // silently filter out forever.
  saveShoppingList(loadShoppingList().filter((e) => e.productId !== req.params.id));
  res.status(204).end();
});

// --- Shopping list: pick one store's match for a product to buy from ---
app.use('/api/shopping-list', auth.requireAuth, resolveWorkspace, requireEditLock);

// Returns each entry enriched with live data from the product's current
// urls (name, price, currency, scrapedName) rather than anything frozen
// at add-time — checking a shopping list is exactly when a stale price
// would be misleading. An entry whose product or store match no longer
// exists is dropped from the response (and from the file, tidying up
// orphans left by a product being deleted or a store no longer matching).
app.get('/api/shopping-list', (req, res) => {
  const list = loadShoppingList().filter((e) => e.userId === req.workspaceId);
  const products = loadUserProducts(req.workspaceId);
  const enriched = [];
  const stillValid = [];
  for (const entry of list) {
    const product = products.find((p) => p.id === entry.productId);
    const storeEntry = product?.urls.find((u) => u.store === entry.store);
    if (!product || !storeEntry || storeEntry.price == null) continue; // orphaned — product/store deleted or no longer matched
    stillValid.push(entry);
    enriched.push({
      id: entry.id,
      productId: product.id,
      productName: product.name,
      category: product.category,
      store: entry.store,
      price: storeEntry.price,
      currency: storeEntry.currency,
      scrapedName: storeEntry.scrapedName,
      url: storeEntry.url,
      checked: entry.checked,
      qty: entry.qty ?? 1, // entries added before quantities existed
      addedAt: entry.addedAt,
    });
  }
  if (stillValid.length !== list.length) {
    // Persist the cleanup — quietly drop the orphans rather than showing
    // them again on every future load.
    const others = loadShoppingList().filter((e) => e.userId !== req.workspaceId);
    saveShoppingList([...others, ...stillValid]);
  }
  res.json(enriched);
});

// Adding the same product+store twice (already on the list, not yet
// bought) bumps its quantity rather than creating a duplicate row — the
// second tap almost always means "actually I need two".
app.post('/api/shopping-list', (req, res) => {
  const { productId, store } = req.body || {};
  if (typeof productId !== 'string' || typeof store !== 'string') {
    return res.status(400).json({ error: 'productId e store são obrigatórios' });
  }
  const products = loadUserProducts(req.workspaceId);
  const product = products.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });
  const storeEntry = product.urls.find((u) => u.store === store);
  if (!storeEntry || storeEntry.price == null) return res.status(400).json({ error: 'esta loja não tem preço para este produto' });

  const list = loadShoppingList();
  const existing = list.find((e) => e.userId === req.workspaceId && e.productId === productId && e.store === store && !e.checked);
  if (existing) {
    existing.qty = Math.min(MAX_QTY, (existing.qty ?? 1) + 1);
    saveShoppingList(list);
    return res.status(200).json(existing);
  }

  const entry = { id: crypto.randomUUID(), userId: req.workspaceId, productId, store, checked: false, qty: 1, addedAt: new Date().toISOString() };
  list.push(entry);
  saveShoppingList(list);
  res.status(201).json(entry);
});

// Set an item's quantity (1..MAX_QTY). Deliberately absolute rather than
// a +1/-1 delta so a double-tap on the stepper can't drift out of sync
// with what the user sees.
const MAX_QTY = 99;
app.put('/api/shopping-list/:id/qty', (req, res) => {
  const qty = Number(req.body?.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return res.status(400).json({ error: `quantidade inválida (1-${MAX_QTY})` });
  }
  const list = loadShoppingList();
  const entry = list.find((e) => e.id === req.params.id && e.userId === req.workspaceId);
  if (!entry) return res.status(404).json({ error: 'item não encontrado' });
  entry.qty = qty;
  saveShoppingList(list);
  res.json(entry);
});

app.post('/api/shopping-list/:id/toggle', (req, res) => {
  const list = loadShoppingList();
  const entry = list.find((e) => e.id === req.params.id && e.userId === req.workspaceId);
  if (!entry) return res.status(404).json({ error: 'item não encontrado' });
  entry.checked = !entry.checked;
  saveShoppingList(list);
  res.json(entry);
});

app.delete('/api/shopping-list/:id', (req, res) => {
  const list = loadShoppingList();
  const next = list.filter((e) => !(e.id === req.params.id && e.userId === req.workspaceId));
  if (next.length === list.length) return res.status(404).json({ error: 'item não encontrado' });
  saveShoppingList(next);
  res.status(204).end();
});

// Bulk-remove everything already checked off — the common "done shopping,
// clear the list" action, rather than tapping delete on each item.
app.delete('/api/shopping-list', (req, res) => {
  const list = loadShoppingList();
  const next = list.filter((e) => !(e.userId === req.workspaceId && e.checked));
  saveShoppingList(next);
  res.status(204).end();
});

// Re-runs the store searches for this product's current name.
app.post('/api/products/:id/refresh', async (req, res) => {
  const products = loadUserProducts(req.workspaceId);
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  const previousEntries = product.urls;
  product.urls = await searchAllStores(searchQueryFor(product), previousEntries, product.overrides || {});
  product.updatedAt = new Date().toISOString();

  saveUserProducts(req.workspaceId, products);
  const drops = collectPriceDrops(product.name, previousEntries, product.urls);
  if (drops.length) await push.notifyPriceDrops(req.workspaceId, drops); // price-drop alert goes to the list's owner
  res.json(product);
});

// --- Manual match override ("corrigir correspondência") ---
// The automatic pick is wrong often enough (store vocabulary, per-kg vs
// per-piece, an ambiguous name) that the user needs an escape hatch. This
// returns one store's raw search results so they can choose the right one;
// PUT .../override then pins it (or excludes the store).
app.get('/api/products/:id/candidates', async (req, res) => {
  const store = req.query.store;
  if (!STORES[store]) return res.status(400).json({ error: 'loja inválida' });
  const product = loadUserProducts(req.workspaceId).find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });
  try {
    const candidates = await listStoreCandidates(store, searchQueryFor(product), 10);
    res.json(
      candidates.map((c) => ({
        url: c.url,
        name: c.name,
        price: c.price,
        currency: c.currency,
        isPack: c.isPack,
      }))
    );
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Pin a specific candidate URL as this store's match, exclude the store, or
// clear back to automatic. Re-scrapes just that store so the change shows
// immediately without a full refresh.
app.put('/api/products/:id/override', async (req, res) => {
  const { store, url, excluded, clear } = req.body || {};
  if (!STORES[store]) return res.status(400).json({ error: 'loja inválida' });

  const products = loadUserProducts(req.workspaceId);
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  product.overrides = product.overrides || {};
  if (clear) {
    delete product.overrides[store];
  } else if (excluded) {
    product.overrides[store] = { excluded: true };
  } else if (typeof url === 'string' && url.trim()) {
    if (detectStore(url) !== store) return res.status(400).json({ error: 'o link não pertence a esta loja' });
    product.overrides[store] = { url: url.trim() };
  } else {
    return res.status(400).json({ error: 'indique url, excluded ou clear' });
  }

  const previous = product.urls.find((e) => e.store === store);
  const entry = await buildStoreEntry(store, searchQueryFor(product), previous, product.overrides[store]);
  const seen = product.urls.some((e) => e.store === store);
  product.urls = seen ? product.urls.map((e) => (e.store === store ? entry : e)) : [...product.urls, entry];
  product.updatedAt = new Date().toISOString();

  saveUserProducts(req.workspaceId, products);
  res.json(product);
});

// Logs the product's current name, category, and every store's price/URL/
// scrapedName exactly as shown when the user clicked the button — a
// snapshot to fix later, not a live reference (the product itself may get
// edited, refreshed, or deleted afterwards).
app.post('/api/products/:id/report-bug', (req, res) => {
  const products = loadUserProducts(req.workspaceId);
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });

  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  // A report raised on one store's price row names that store; one raised
  // from the product-card header names none — reportedStore stays null and
  // the report is about the item as a whole (wrong size basis, all four
  // matches off, etc.). Every store's data is logged either way for
  // context when fixing it later. A present-but-unknown store is still an
  // error.
  const reportedStore = typeof req.body?.store === 'string' ? req.body.store : null;
  if (reportedStore && !STORES[reportedStore]) {
    return res.status(400).json({ error: 'loja inválida' });
  }

  appendBugReport({
    id: crypto.randomUUID(),
    reportedAt: new Date().toISOString(),
    userId: req.workspaceId, // the list this product belongs to
    userEmail: req.user.email || null, // who actually filed it (may be a collaborator)
    productId: product.id,
    productName: product.name,
    brand: product.brand || null,
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
async function refreshProductsForUser(userId, onProgress) {
  const products = loadUserProducts(userId);
  const allDrops = [];
  let done = 0;
  for (const product of products) {
    const previousEntries = product.urls;
    const urls = await searchAllStores(searchQueryFor(product), previousEntries, product.overrides || {});
    const updated = updateOneProduct(userId, product.id, { urls, updatedAt: new Date().toISOString() });
    done++;
    if (onProgress) onProgress(done, products.length);
    if (!updated) continue; // deleted while this product's refresh was in flight — nothing left to update
    allDrops.push(...collectPriceDrops(product.name, previousEntries, urls));
  }
  // One notification per refresh run, not one per drop — a run that finds
  // several drops (e.g. the daily 8am update) shouldn't spam a stack of
  // separate pushes.
  if (allDrops.length) await push.notifyPriceDrops(userId, allDrops);
  return loadUserProducts(userId);
}

// "Atualizar preços" (whole catalogue) runs for minutes on a large list, so
// it's a background job the client polls, not a request it waits on:
// respond 202 immediately, track progress in memory (refreshJobs), expose
// it at GET /api/products/refresh-status. Lost on restart, like sessions —
// a killed run just needs re-triggering and the daily scheduler catches it
// up regardless. A per-user job is single-flight; a second POST while one
// runs just returns the running job's status.
const refreshJobs = new Map(); // workspaceId -> { total, done, running, error, startedAt }

function anyRefreshJobRunning() {
  for (const job of refreshJobs.values()) if (job.running) return true;
  return false;
}

app.post('/api/products/refresh-all', (req, res) => {
  const workspaceId = req.workspaceId; // one job per list, whichever collaborator kicked it off
  const existing = refreshJobs.get(workspaceId);
  if (existing?.running) {
    return res.status(202).json({ running: true, total: existing.total, done: existing.done });
  }
  const total = loadUserProducts(workspaceId).length;
  const job = { total, done: 0, running: true, error: null, startedAt: Date.now() };
  refreshJobs.set(workspaceId, job);
  res.status(202).json({ running: true, total, done: 0 });

  refreshProductsForUser(workspaceId, (done, tot) => {
    job.done = done;
    job.total = tot;
  })
    .catch((err) => {
      job.error = err.message;
      console.error(`[refresh-all] failed for workspace ${workspaceId}:`, err.message);
    })
    .finally(() => {
      job.running = false;
      job.finishedAt = Date.now();
    });
});

app.get('/api/products/refresh-status', (req, res) => {
  const job = refreshJobs.get(req.workspaceId);
  if (!job) return res.json({ running: false, total: 0, done: 0 });
  res.json({ running: job.running, total: job.total, done: job.done, error: job.error || null });
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

// Guards against the 15-minute poll starting a second run on top of one
// still in flight — a full refresh of a large catalogue can take longer
// than 15 minutes, and setInterval doesn't wait for the async callback to
// settle. Also stands down while a user's manual "Atualizar preços" job is
// running, so the two don't double up.
let scheduledRunInFlight = false;

async function checkScheduledUpdate() {
  if (scheduledRunInFlight || anyRefreshJobRunning()) return;
  const now = new Date();
  const today = todayLocalDateString();
  const state = loadScheduleState();
  if (now.getHours() < SCHEDULED_HOUR || state.lastRunDate === today) return;

  scheduledRunInFlight = true;
  try {
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
  } finally {
    scheduledRunInFlight = false;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`price-compare listening on :${PORT}`);
  checkScheduledUpdate(); // catch up immediately if the container was down through 08:00
  setInterval(checkScheduledUpdate, 15 * 60 * 1000);
});
