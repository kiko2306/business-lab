const SCRAPED_STORES = { continente: 'Continente', pingodoce: 'Pingo Doce', lidl: 'Lidl' };
const STORE_COLORS = { continente: '#ff6b6b', pingodoce: '#4ade80', lidl: '#5b9bff' };

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

  const cheapest = rows.reduce((min, r) => (r.price != null && (min == null || r.price < min) ? r.price : min), null);
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

  for (const row of rows) {
    const div = document.createElement('div');
    div.className = 'price-row';
    const priceText = fmtPrice(row.price, row.currency);
    const isCheapest = row.price != null && row.price === cheapest;
    const priceHtml = priceText
      ? `<span class="price-value ${isCheapest ? 'cheapest' : ''}">${priceText}</span>`
      : `<span class="price-value missing">${row.error ? 'falha ao obter' : 'sem preço'}</span>`;
    const actionHtml = row.url ? `<a class="btn small" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Abrir</a>` : '';

    div.innerHTML = `
      <span class="store-name">${escapeHtml(row.label)}</span>
      <span class="price-actions">${priceHtml}${actionHtml}</span>
    `;
    if (row.error) {
      const err = document.createElement('div');
      err.className = 'price-error';
      err.textContent = row.error;
      div.appendChild(err);
    }
    body.appendChild(div);
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

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#14161a;border-radius:8px">`;

  // Y-axis gridlines/labels: low, mid, high price.
  for (const frac of [0, 0.5, 1]) {
    const price = priceLo + frac * (priceHi - priceLo);
    const yy = y(price);
    svg += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#2a2e37" stroke-width="1" />`;
    svg += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#9aa1ad">${fmtPrice(price, 'EUR')}</text>`;
  }
  // X-axis labels: first and last date seen.
  const fmtDate = (t) => new Date(t).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
  svg += `<text x="${padL}" y="${H - 8}" font-size="11" fill="#9aa1ad">${fmtDate(minT)}</text>`;
  svg += `<text x="${W - padR}" y="${H - 8}" text-anchor="end" font-size="11" fill="#9aa1ad">${fmtDate(maxT)}</text>`;

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

loadCategories().then(loadProducts);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
