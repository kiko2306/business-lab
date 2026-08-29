const SCRAPED_STORES = { continente: 'Continente', pingodoce: 'Pingo Doce', lidl: 'Lidl', auchan: 'Auchan' };
const STORE_COLORS = { continente: '#ff6b6b', pingodoce: '#4ade80', lidl: '#5b9bff', auchan: '#f0a020' };

// --- Theme (light/dark), saved per-browser ---
// The actual dark-vs-light flip already happened synchronously in
// index.html's inline <script> (avoids a flash of the wrong theme); this
// just keeps the toggle button's icon in sync and handles clicks.
function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('priceCompare.theme', theme);
  } catch {
    // localStorage unavailable — theme choice just won't persist, fine.
  }
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#1c1f26');
}
applyTheme(currentTheme());
document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
});

let products = [];
let categories = [];

// Which product cards, and which whole category sections, are collapsed —
// both persisted per-browser (separate keys) so they survive a reload.
function loadCollapsedSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set();
  }
}
function saveCollapsedSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable — collapse state just won't persist, fine.
  }
}

let collapsed = loadCollapsedSet('priceCompare.collapsed');
function saveCollapsed() {
  saveCollapsedSet('priceCompare.collapsed', collapsed);
}

let collapsedCategories = loadCollapsedSet('priceCompare.collapsedCategories');
function saveCollapsedCategories() {
  saveCollapsedSet('priceCompare.collapsedCategories', collapsedCategories);
}

async function api(path, options) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    // Session expired/logged out elsewhere mid-use — drop back to the
    // login screen instead of just toasting a confusing error.
    showLoginScreen();
    throw new Error('sessão expirada — inicie sessão novamente');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function fmtPrice(price, currency) {
  if (price == null) return null;
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: currency || 'EUR' }).format(price);
}

async function loadCategories() {
  categories = await api('/categories');
  const select = document.getElementById('product-category');
  select.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

async function loadProducts() {
  products = await api('/products');
  renderProducts();
}

function renderProducts() {
  const container = document.getElementById('products');
  container.innerHTML = '';
  document.getElementById('products-empty').classList.toggle('hidden', products.length > 0);

  // Grouped by category (Portuguese labels), not by brand — categories in
  // their fixed display order, each rendered as its own section.
  const byCategory = new Map();
  for (const product of products) {
    const cat = product.category || 'Outros';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(product);
  }

  const orderedCategories = categories.length ? categories : [...byCategory.keys()].sort();
  for (const cat of orderedCategories) {
    const items = byCategory.get(cat);
    if (!items || !items.length) continue;

    const isCatCollapsed = collapsedCategories.has(cat);

    const section = document.createElement('section');
    section.className = 'category-section';

    const heading = document.createElement('h2');
    heading.className = 'category-heading';
    heading.dataset.collapseCategory = cat;
    heading.title = isCatCollapsed ? 'Expandir' : 'Colapsar';
    heading.innerHTML = `<span class="collapse-toggle">${isCatCollapsed ? '▸' : '▾'}</span> ${escapeHtml(cat)} <span class="category-count">(${items.length})</span>`;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'category-items' + (isCatCollapsed ? ' hidden' : '');
    for (const product of items.sort((a, b) => a.name.localeCompare(b.name))) {
      list.appendChild(renderProductCard(product));
    }
    section.appendChild(list);

    container.appendChild(section);
  }
}

function renderProductCard(product) {
  const rows = product.urls.map((entry) => ({
    label: SCRAPED_STORES[entry.store] || entry.store || 'Unknown store',
    price: entry.price,
    currency: entry.currency,
    error: entry.error,
    url: entry.url,
  }));

  // A store that has never successfully matched this product (no price
  // ever found, not just a stale one) isn't shown at all — a "sem preço"
  // row read as if the store just happened to be missing a price this
  // once, when really the store doesn't carry a matching product at all
  // (see scrapers.js looksIrrelevant/looksLikeSizeMismatch).
  const visibleRows = rows.filter((r) => r.price != null);

  const cheapest = visibleRows.reduce((min, r) => (min == null || r.price < min ? r.price : min), null);
  const isCollapsed = collapsed.has(product.id);

  const card = document.createElement('div');
  card.className = 'product-card';

  const header = document.createElement('div');
  header.className = 'product-card-header';
  header.innerHTML = `
    <h3><button class="collapse-toggle" data-collapse="${product.id}" title="${isCollapsed ? 'Expandir' : 'Colapsar'}">${isCollapsed ? '▸' : '▾'}</button> ${escapeHtml(product.name)}</h3>
    <div class="product-actions">
      <button class="btn small" data-history="${product.id}">📈 Histórico</button>
      <button class="btn small" data-refresh="${product.id}">Atualizar</button>
      <button class="btn small" data-edit="${product.id}">Editar</button>
      <button class="btn small danger" data-delete="${product.id}">Eliminar</button>
    </div>
  `;
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'product-card-body' + (isCollapsed ? ' hidden' : '');

  for (const row of visibleRows) {
    const div = document.createElement('div');
    div.className = 'price-row';
    const priceText = fmtPrice(row.price, row.currency);
    const isCheapest = row.price === cheapest;
    const priceHtml = `<span class="price-value ${isCheapest ? 'cheapest' : ''}">${priceText}</span>`;
    const actionHtml = row.url ? `<a class="btn small" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Abrir</a>` : '';

    div.innerHTML = `
      <span class="store-name">${escapeHtml(row.label)}</span>
      <span class="price-actions">${priceHtml}${actionHtml}</span>
    `;
    body.appendChild(div);
  }
  if (!visibleRows.length) {
    const none = document.createElement('p');
    none.className = 'hint';
    none.textContent = 'Ainda sem preços encontrados para este produto.';
    body.appendChild(none);
  }
  card.appendChild(body);

  return card;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Popups ---
let toastTimer = null;
function showToast(message, isError) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', Boolean(isError));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function showConfirm(title) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-title').textContent = title;
  modal.classList.add('open');
  return new Promise((resolve) => {
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    function cleanup(result) {
      modal.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// --- Add/Edit product modal ---
const productModal = document.getElementById('product-modal');
const productForm = document.getElementById('product-form');

function openProductModal(product) {
  document.getElementById('product-modal-title').textContent = product ? 'Editar produto' : 'Adicionar produto';
  document.getElementById('product-id').value = product ? product.id : '';
  document.getElementById('product-name').value = product ? product.name : '';
  document.getElementById('product-category').value = product ? product.category : 'Outros';
  productModal.classList.add('open');
}

document.getElementById('add-product-btn').addEventListener('click', () => openProductModal(null));
document.getElementById('product-cancel').addEventListener('click', () => productModal.classList.remove('open'));

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('product-id').value;
  const name = document.getElementById('product-name').value;
  const category = document.getElementById('product-category').value;

  try {
    if (id) await api(`/products/${id}`, { method: 'PUT', body: JSON.stringify({ name, category }) });
    else await api('/products', { method: 'POST', body: JSON.stringify({ name, category }) });
    productModal.classList.remove('open');
    await loadProducts();
    showToast('Guardado.');
  } catch (err) {
    showToast(err.message, true);
  }
});

// --- Update all prices ---
document.getElementById('update-all-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '↻ A atualizar…';
  try {
    await api('/products/refresh-all', { method: 'POST' });
    await loadProducts();
    showToast('Preços atualizados.');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// --- Delegated actions ---
document.body.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  const refreshId = e.target.dataset.refresh;
  const collapseId = e.target.dataset.collapse;
  const collapseCategory = e.target.closest('[data-collapse-category]')?.dataset.collapseCategory;

  if (editId) {
    openProductModal(products.find((p) => p.id === editId));
  } else if (deleteId) {
    if (await showConfirm('Eliminar este produto?')) {
      await api(`/products/${deleteId}`, { method: 'DELETE' });
      await loadProducts();
      showToast('Produto eliminado.');
    }
  } else if (refreshId) {
    e.target.disabled = true;
    e.target.textContent = 'A atualizar…';
    try {
      await api(`/products/${refreshId}/refresh`, { method: 'POST' });
      await loadProducts();
      showToast('Preços atualizados.');
    } catch (err) {
      showToast(err.message, true);
    }
  } else if (collapseId) {
    if (collapsed.has(collapseId)) collapsed.delete(collapseId);
    else collapsed.add(collapseId);
    saveCollapsed();
    renderProducts();
  } else if (collapseCategory) {
    if (collapsedCategories.has(collapseCategory)) collapsedCategories.delete(collapseCategory);
    else collapsedCategories.add(collapseCategory);
    saveCollapsedCategories();
    renderProducts();
  } else if (e.target.dataset.history) {
    openHistoryModal(products.find((p) => p.id === e.target.dataset.history));
  }
});

// --- Price history chart ---
// Hand-rolled inline SVG line chart — one line per store, no charting
// library or CDN dependency, consistent with this app having no build step
// at all. Each successful scrape appends a {price, scrapedAt} point on the
// server side (see server.js buildStoreEntry); this just plots whatever's
// accumulated so far.
const historyModal = document.getElementById('history-modal');
document.getElementById('history-close').addEventListener('click', () => historyModal.classList.remove('open'));

function openHistoryModal(product) {
  if (!product) return;
  document.getElementById('history-title').textContent = `Histórico de preços — ${product.name}`;
  document.getElementById('history-chart').innerHTML = buildHistoryChart(product);
  historyModal.classList.add('open');
}

function buildHistoryChart(product) {
  const series = product.urls
    .map((entry) => ({
      store: entry.store,
      label: SCRAPED_STORES[entry.store] || entry.store,
      color: STORE_COLORS[entry.store] || '#9aa1ad',
      points: (entry.history || []).map((h) => ({ t: new Date(h.scrapedAt).getTime(), price: h.price })),
    }))
    .filter((s) => s.points.length > 0);

  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);
  if (totalPoints < 2) {
    return '<p class="empty">Ainda não há histórico suficiente — atualize este produto algumas vezes (o ideal é ao longo de vários dias) para ver uma tendência.</p>';
  }

  const allPoints = series.flatMap((s) => s.points);
  const minT = Math.min(...allPoints.map((p) => p.t));
  const maxT = Math.max(...allPoints.map((p) => p.t));
  const minPrice = Math.min(...allPoints.map((p) => p.price));
  const maxPrice = Math.max(...allPoints.map((p) => p.price));

  const W = 600, H = 280, padL = 50, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // Guard against a flat/degenerate axis (single distinct value or a single
  // point in time) by padding the range instead of dividing by zero.
  const priceRange = maxPrice - minPrice || Math.max(maxPrice * 0.1, 0.1);
  const priceLo = Math.max(0, minPrice - priceRange * 0.15);
  const priceHi = maxPrice + priceRange * 0.15;
  const timeRange = maxT - minT || 1;

  const x = (t) => padL + ((t - minT) / timeRange) * plotW;
  const y = (price) => padT + plotH - ((price - priceLo) / (priceHi - priceLo)) * plotH;

  // stroke/fill set via style="...var(...)" rather than the stroke=/fill=
  // presentation attributes — SVG only resolves CSS custom properties
  // through actual style declarations, so the chart can follow the
  // light/dark theme toggle instead of being stuck with hardcoded colors.
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="history-chart-svg">`;

  // Y-axis gridlines/labels: low, mid, high price.
  for (const frac of [0, 0.5, 1]) {
    const price = priceLo + frac * (priceHi - priceLo);
    const yy = y(price);
    svg += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" style="stroke:var(--border-soft)" stroke-width="1" />`;
    svg += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" style="fill:var(--text-muted)">${fmtPrice(price, 'EUR')}</text>`;
  }
  // X-axis labels: first and last date seen.
  const fmtDate = (t) => new Date(t).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
  svg += `<text x="${padL}" y="${H - 8}" font-size="11" style="fill:var(--text-muted)">${fmtDate(minT)}</text>`;
  svg += `<text x="${W - padR}" y="${H - 8}" text-anchor="end" font-size="11" style="fill:var(--text-muted)">${fmtDate(maxT)}</text>`;

  for (const s of series) {
    const sorted = [...s.points].sort((a, b) => a.t - b.t);
    if (sorted.length >= 2) {
      const path = sorted.map((p) => `${x(p.t)},${y(p.price)}`).join(' ');
      svg += `<polyline points="${path}" fill="none" stroke="${s.color}" stroke-width="2" />`;
    }
    for (const p of sorted) {
      svg += `<circle cx="${x(p.t)}" cy="${y(p.price)}" r="3" fill="${s.color}" />`;
    }
  }

  svg += '</svg>';

  const legend = series
    .map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`)
    .join('');

  return svg + `<div class="chart-legend">${legend}</div>`;
}

// --- Auth bootstrap ---
function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('header-user').classList.add('hidden');
}

let currentUser = null;

function showApp(user) {
  currentUser = user;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
  document.getElementById('header-user').classList.remove('hidden');
  document.getElementById('user-info').textContent = user.name || user.email;
  document.getElementById('admin-section').classList.toggle('hidden', !user.isAdmin);
}

// --- Ads (Google AdSense) — hidden entirely for VIP/paid users (server
// already reflects that in adsEnabled) and until a real AdSense publisher
// ID is configured server-side (see .env.example ADSENSE_CLIENT_ID).
async function setupAds(user) {
  if (!user.adsEnabled) return;
  const res = await fetch('/api/ads-config');
  const { clientId } = await res.json();
  if (!clientId) return;

  const slot = document.getElementById('ad-slot');
  slot.classList.remove('hidden');
  slot.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${clientId}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSense not yet approved for this site, or blocked by an ad blocker — fine, slot just stays empty.
    }
  };
  document.head.appendChild(script);
}

// --- Price-drop detail popup — shown when a push notification is tapped,
// either via the service worker postMessage (app already open) or a
// ?priceDrop= URL param (service worker opened a fresh tab). See sw.js.
function showPriceDropModal(data) {
  const drops = data.drops || [];
  document.getElementById('price-drop-title').textContent = data.title || 'Descida de preço';
  const body = document.getElementById('price-drop-body');
  if (!drops.length) {
    body.innerHTML = `<p class="hint">${escapeHtml(data.body || '')}</p>`;
  } else {
    body.innerHTML = drops
      .map((d) => {
        const pct = Math.round(d.pct * 100);
        return `
      <div class="price-drop-row">
        <div>
          <div>${escapeHtml(d.productName)}</div>
          <div class="price-drop-store">${escapeHtml(SCRAPED_STORES[d.store] || d.store)}</div>
        </div>
        <div class="price-drop-change">
          <span class="price-drop-old">${d.oldPrice.toFixed(2)}€</span>
          <span class="price-drop-new">${d.newPrice.toFixed(2)}€</span>
          <span class="price-drop-pct">-${pct}%</span>
        </div>
      </div>`;
      })
      .join('');
  }
  document.getElementById('price-drop-modal').classList.add('open');
}

document.getElementById('price-drop-close').addEventListener('click', () => {
  document.getElementById('price-drop-modal').classList.remove('open');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PRICE_DROP_NOTIFICATION') showPriceDropModal(event.data.data);
  });
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  showLoginScreen();
});

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('auth_error')) {
    document.getElementById('login-error').textContent = 'Não foi possível iniciar sessão com o Google. Tente novamente.';
    document.getElementById('login-error').classList.remove('hidden');
    history.replaceState(null, '', location.pathname);
  }

  const res = await fetch('/api/me');
  if (!res.ok) {
    showLoginScreen();
    return;
  }
  const user = await res.json();
  showApp(user);
  await loadCategories();
  await loadProducts();
  maybeShowNotifyPrompt();
  setupAds(user);

  const priceDropParam = params.get('priceDrop');
  if (priceDropParam) {
    try {
      showPriceDropModal(JSON.parse(priceDropParam));
    } catch {
      // Malformed/unexpected payload — just skip the popup, nothing else depends on it.
    }
    history.replaceState(null, '', location.pathname);
  }
}

init();

// --- Push notifications (price-drop alerts) ---
// The VAPID public key is plain base64url; the Push API wants it as the raw
// bytes it actually encodes, hence this decode step.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/push/public-key');
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
}

async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
}

function showNotifyModal() {
  document.getElementById('notify-modal').classList.add('open');
}
function hideNotifyModal() {
  document.getElementById('notify-modal').classList.remove('open');
}

document.getElementById('notify-later').addEventListener('click', () => {
  try {
    localStorage.setItem('priceCompare.notifyDismissed', '1');
  } catch {
    // localStorage unavailable — the popup will just ask again next visit, fine.
  }
  hideNotifyModal();
});

document.getElementById('notify-enable').addEventListener('click', async () => {
  hideNotifyModal();
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    await subscribeToPush();
    showToast('Notificações ativadas.');
  } catch (err) {
    showToast('Não foi possível ativar as notificações: ' + err.message, true);
  }
});

// --- Settings modal — lets a user re-enable/disable push notifications any
// time, unlike the once-per-browser notify-modal prompt above. ---
async function refreshNotifyToggleState() {
  const toggle = document.getElementById('notify-toggle');
  const blockedHint = document.getElementById('notify-blocked-hint');
  const statusIcon = document.getElementById('notify-status-icon');
  blockedHint.classList.add('hidden');

  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    toggle.checked = false;
    toggle.disabled = true;
    statusIcon.textContent = '🔕';
    blockedHint.textContent = 'O seu navegador não suporta notificações push.';
    blockedHint.classList.remove('hidden');
    return;
  }
  if (Notification.permission === 'denied') {
    toggle.checked = false;
    toggle.disabled = true;
    statusIcon.textContent = '🔕';
    blockedHint.textContent = 'Notificações bloqueadas nas definições do navegador — tem de as ativar aí primeiro.';
    blockedHint.classList.remove('hidden');
    return;
  }

  toggle.disabled = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    toggle.checked = !!sub;
    statusIcon.textContent = sub ? '🔔' : '🔕';
  } catch {
    toggle.checked = false;
    statusIcon.textContent = '🔕';
  }
}

// --- Admin (VIP/paid management) — only visible to ADMIN_EMAIL, see showApp() ---
async function loadAdminUsers() {
  const list = document.getElementById('admin-users-list');
  list.textContent = 'A carregar...';
  let usersList;
  try {
    usersList = await fetch('/api/admin/users').then((r) => r.json());
  } catch {
    list.textContent = 'Não foi possível carregar utilizadores.';
    return;
  }
  if (!usersList.length) {
    list.innerHTML = '<p class="hint">Ainda não há utilizadores.</p>';
    return;
  }
  list.innerHTML = usersList
    .map(
      (u) => `
    <div class="admin-user-row" data-user-id="${escapeHtml(u.userId)}">
      <div>
        <div>${escapeHtml(u.name || u.email)}</div>
        <div class="admin-user-email">${escapeHtml(u.email)}</div>
      </div>
      <div class="admin-user-toggles">
        <label><input type="checkbox" class="admin-vip-toggle" ${u.isVip ? 'checked' : ''} /> VIP</label>
        <label><input type="checkbox" class="admin-paid-toggle" ${u.isPaid ? 'checked' : ''} /> Pago</label>
      </div>
    </div>`
    )
    .join('');

  list.querySelectorAll('.admin-vip-toggle').forEach((el) =>
    el.addEventListener('change', (e) => {
      const userId = e.target.closest('.admin-user-row').dataset.userId;
      api(`/admin/users/${encodeURIComponent(userId)}/vip`, { method: 'POST', body: JSON.stringify({ isVip: e.target.checked }) }).catch((err) =>
        showToast(err.message, true)
      );
    })
  );
  list.querySelectorAll('.admin-paid-toggle').forEach((el) =>
    el.addEventListener('change', (e) => {
      const userId = e.target.closest('.admin-user-row').dataset.userId;
      api(`/admin/users/${encodeURIComponent(userId)}/paid`, { method: 'POST', body: JSON.stringify({ isPaid: e.target.checked }) }).catch((err) =>
        showToast(err.message, true)
      );
    })
  );
}

document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('open');
  refreshNotifyToggleState();
  if (currentUser?.isAdmin) loadAdminUsers();
});
document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.remove('open');
});

document.getElementById('notify-toggle').addEventListener('change', async (e) => {
  const enable = e.target.checked;
  e.target.disabled = true;
  try {
    if (enable) {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') {
        e.target.checked = false;
        await refreshNotifyToggleState();
        return;
      }
      await subscribeToPush();
      try {
        localStorage.setItem('priceCompare.notifyDismissed', '1');
      } catch {
        // localStorage unavailable — harmless, just means the initial popup could show again later.
      }
      showToast('Notificações ativadas.');
    } else {
      await unsubscribeFromPush();
      showToast('Notificações desativadas.');
    }
  } catch (err) {
    e.target.checked = !enable;
    showToast('Não foi possível atualizar as notificações: ' + err.message, true);
  } finally {
    e.target.disabled = false;
    document.getElementById('notify-status-icon').textContent = e.target.checked ? '🔔' : '🔕';
  }
});

// Shown once per browser, right after login — skipped entirely if the
// browser doesn't support push, the user already answered the permission
// prompt (granted or denied — nothing left to ask), they already dismissed
// it with "Agora não", or the server has no VAPID keys configured.
async function maybeShowNotifyPrompt() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  try {
    if (localStorage.getItem('priceCompare.notifyDismissed') === '1') return;
  } catch {
    // localStorage unavailable — fall through and ask anyway.
  }
  try {
    const res = await fetch('/api/push/public-key');
    if (!res.ok) return;
  } catch {
    return;
  }
  showNotifyModal();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
