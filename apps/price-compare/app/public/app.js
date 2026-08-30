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
  refreshReviewCount();
}

// --- "Rever correspondências" — the needs-attention worklist ----------
// A product needs a look when a store has no price for it (not one the
// user deliberately excluded), or when one store's price is wildly out of
// line with the others (a wrong product, a per-kg vs per-piece listing, a
// mega-pack). Computed entirely from the loaded `products` — no endpoint.
const OUTLIER_RATIO = 3;

function priceForCompare(entry) {
  // unit price when known (fairer), else the raw total
  return entry.unitSizeValue && entry.price != null
    ? (entry.price * 1000) / entry.unitSizeValue
    : entry.price;
}

function needsAttention(product) {
  const reasons = [];
  const rows = product.urls || [];
  const excluded = rows.filter((e) => e.excluded).length;
  const priced = rows.filter((e) => e.price != null && !e.excluded);
  const expected = Object.keys(SCRAPED_STORES).length - excluded;

  // A missing store on its own isn't worth flagging — Lidl carries maybe a
  // quarter of a typical list. Flag only when almost nothing matched (0 or
  // 1 of the expected stores), where the one match can't be cross-checked.
  if (priced.length === 0) {
    reasons.push({ store: null, text: 'sem preço em nenhuma loja' });
  } else if (priced.length === 1 && expected >= 3) {
    reasons.push({ store: null, text: `só ${SCRAPED_STORES[priced[0].store]} tem preço — pode estar errado` });
  }

  // One store's price wildly out of line with the others — usually a wrong
  // product, a per-kg vs per-piece listing, or a mega-pack.
  const forCompare = priced.filter((e) => !e.isPack);
  if (forCompare.length >= 2) {
    const vals = forCompare.map((e) => ({ store: e.store, v: priceForCompare(e), raw: e.price }));
    const lo = vals.reduce((a, b) => (b.v < a.v ? b : a));
    const hi = vals.reduce((a, b) => (b.v > a.v ? b : a));
    if (lo.v > 0 && hi.v / lo.v > OUTLIER_RATIO) {
      reasons.push({
        store: hi.store,
        text: `preço díspar — ${SCRAPED_STORES[hi.store]} ${fmtPrice(hi.raw, 'EUR')} vs ${SCRAPED_STORES[lo.store]} ${fmtPrice(lo.raw, 'EUR')}`,
      });
    }
  }
  return reasons;
}

const REASON_SEVERITY = { 'sem preço em nenhuma loja': 3, 'só': 2 }; // "só X tem preço" -> 2, outlier -> 1
function severity(reasons) {
  return reasons.reduce((s, r) => s + (REASON_SEVERITY[r.text] || (r.text.startsWith('só ') ? 2 : 1)), 0);
}

function computeNeedsAttention() {
  return products
    .map((p) => ({ product: p, reasons: needsAttention(p) }))
    .filter((x) => x.reasons.length)
    .sort((a, b) => severity(b.reasons) - severity(a.reasons) || a.product.name.localeCompare(b.product.name));
}

function refreshReviewCount() {
  const badge = document.getElementById('review-count');
  if (!badge) return;
  const n = computeNeedsAttention().length;
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}

function openReviewModal() {
  const list = computeNeedsAttention();
  const body = document.getElementById('review-body');
  if (!list.length) {
    body.innerHTML = '<p class="hint">Tudo em ordem — nenhum produto precisa de revisão.</p>';
  } else {
    body.innerHTML = list
      .map(
        ({ product, reasons }) => `
      <div class="review-item">
        <div class="review-item-name">${escapeHtml(product.name)}${product.brand ? `<span class="product-brand"> · ${escapeHtml(product.brand)}</span>` : ''}</div>
        ${reasons
          .map(
            (r) => `<div class="review-reason">
              <span>${escapeHtml(r.text)}</span>
              <button type="button" class="btn small" data-review-correct="${product.id}" data-review-store="${r.store || ''}">Corrigir</button>
            </div>`
          )
          .join('')}
      </div>`
      )
      .join('');
  }
  document.getElementById('review-modal').classList.add('open');
}

document.getElementById('review-btn').addEventListener('click', openReviewModal);
document.getElementById('review-close').addEventListener('click', () =>
  document.getElementById('review-modal').classList.remove('open')
);
document.getElementById('review-body').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-review-correct]');
  if (!btn) return;
  document.getElementById('review-modal').classList.remove('open');
  openCorrectModal(products.find((p) => p.id === btn.dataset.reviewCorrect), btn.dataset.reviewStore || null);
});

function renderProductCard(product) {
  const rows = product.urls.map((entry) => {
    const unitLabel = entry.unitSizeKind === 'mass' ? 'kg' : entry.unitSizeKind === 'volume' ? 'L' : null;
    const unitPrice =
      entry.unitSizeValue && entry.price != null ? (entry.price * 1000) / entry.unitSizeValue : null;
    return {
      store: entry.store,
      label: SCRAPED_STORES[entry.store] || entry.store || 'Unknown store',
      price: entry.price,
      currency: entry.currency,
      error: entry.error,
      url: entry.url,
      unitPrice,
      unitLabel,
      isPack: Boolean(entry.isPack),
      excluded: Boolean(entry.excluded),
      pinned: Boolean(entry.pinned),
      aiMatched: Boolean(entry.aiMatched),
    };
  });

  // How many of the 4 stores this product actually has a price at — stores
  // the user deliberately excluded don't count against it. Shown as a
  // muted "3/4 lojas" chip only when short, and doubles as the entry point
  // to the "corrigir correspondência" modal (a store with no row is
  // otherwise invisible).
  const STORE_KEYS = Object.keys(SCRAPED_STORES);
  const excludedCount = rows.filter((r) => r.excluded).length;
  const matchedCount = rows.filter((r) => r.price != null).length;
  const expectedCount = STORE_KEYS.length - excludedCount;
  const missingStores = STORE_KEYS.filter(
    (k) => !rows.some((r) => r.store === k && (r.price != null || r.excluded))
  );

  // A store that has never successfully matched this product (no price
  // ever found, not just a stale one) isn't shown at all — a "sem preço"
  // row read as if the store just happened to be missing a price this
  // once, when really the store doesn't carry a matching product at all
  // (see scrapers.js looksIrrelevant/looksLikeSizeMismatch).
  const visibleRows = rows.filter((r) => r.price != null);

  // The "cheapest" badge is the lowest *unit* price (€/kg or €/L), not the
  // lowest total — a 1 L carton at €1.08 beats another store's 200 ml
  // bottle at €0.70. It's decided among the rows that can actually be
  // compared that way (a known size, same unit kind); a row with no size,
  // or a different kind, simply doesn't get the badge. Only when fewer
  // than two rows have a comparable unit price does it fall back to the
  // raw total.
  const unitRows = visibleRows.filter((r) => r.unitPrice != null && r.unitLabel != null);
  const byUnit = unitRows.length >= 2 && unitRows.every((r) => r.unitLabel === unitRows[0].unitLabel);
  const cheapestUnitPrice = byUnit ? Math.min(...unitRows.map((r) => r.unitPrice)) : null;
  const cheapest = visibleRows.length ? Math.min(...visibleRows.map((r) => r.price)) : null;
  const isCollapsed = collapsed.has(product.id);

  const card = document.createElement('div');
  card.className = 'product-card';

  const coverageHtml =
    matchedCount < expectedCount
      ? `<button class="store-coverage" data-correct="${product.id}" title="Sem correspondência em: ${escapeHtml(
          missingStores.map((k) => SCRAPED_STORES[k]).join(', ')
        )} — clique para corrigir">${matchedCount}/${STORE_KEYS.length} lojas</button>`
      : '';

  const header = document.createElement('div');
  header.className = 'product-card-header';
  header.innerHTML = `
    <h3><button class="collapse-toggle" data-collapse="${product.id}" title="${isCollapsed ? 'Expandir' : 'Colapsar'}">${isCollapsed ? '▸' : '▾'}</button> ${escapeHtml(product.name)}${product.brand ? `<span class="product-brand"> · ${escapeHtml(product.brand)}</span>` : ''}${coverageHtml}</h3>
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
    const isCheapest = byUnit ? row.unitPrice === cheapestUnitPrice : row.price === cheapest;
    const unitPriceHtml =
      row.unitPrice != null
        ? `<span class="unit-price">${fmtPrice(row.unitPrice, row.currency)}/${row.unitLabel}</span>`
        : '';
    // Pack/Unidade label — a €2.94 "pack" price and a €2.94 "unit" price
    // mean very different things (plan.md §39). Order within the row:
    // store name · unit price (€/kg, €/L) · total price, all on one line.
    const packBadgeHtml = `<span class="pack-badge ${row.isPack ? 'pack' : ''}">${row.isPack ? 'Pack' : 'Unidade'}</span>`;
    const priceHtml = `<span class="price-value ${isCheapest ? 'cheapest' : ''}">${packBadgeHtml}${unitPriceHtml}<span class="price-total">${priceText}</span></span>`;
    const actionHtml = row.url ? `<a class="btn small" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Abrir</a>` : '';
    const reportHtml = `<button class="btn small" data-report-bug="${product.id}" data-report-store="${row.store}" title="Reportar um erro neste preço (${escapeHtml(row.label)})">🐞</button>`;
    const addToListHtml = `<button class="btn small" data-add-to-list="${product.id}" data-add-to-list-store="${row.store}" title="Adicionar à lista de compras (${escapeHtml(row.label)})">🛒</button>`;
    const correctHtml = `<button class="btn small" data-correct="${product.id}" data-correct-store="${row.store}" title="Corrigir a correspondência nesta loja (${escapeHtml(row.label)})">${row.pinned ? '📌' : '✎'}</button>`;

    const aiTag = row.aiMatched
      ? ` <span class="ai-tag" title="Correspondência encontrada por IA — confirme com &quot;Corrigir&quot; se parecer errada">IA</span>`
      : '';
    div.innerHTML = `
      <span class="store-name">${escapeHtml(row.label)}${aiTag}</span>
      ${priceHtml}
      <span class="price-actions">${actionHtml}${addToListHtml}${correctHtml}${reportHtml}</span>
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

// --- Full-screen blocking loader ---
// Any operation that re-scrapes the stores (single-product refresh,
// "atualizar tudo", add/rename) takes seconds to minutes and holds a
// server-side write of the product list — the UI must be inert while it
// runs, both so the user isn't confused by a frozen-looking page and so a
// concurrent edit can't be clobbered by the refresh's own save (plan.md
// §40). The overlay covers the viewport (CSS) so clicks are blocked; this
// just toggles it and sets the message.
let loadingDepth = 0;
function setLoadingMessage(message, submessage) {
  document.getElementById('loading-message').textContent = message || 'A atualizar…';
  const sub = document.getElementById('loading-submessage');
  sub.textContent = submessage || '';
  sub.classList.toggle('hidden', !submessage);
}
function showLoading(message, submessage) {
  loadingDepth++;
  setLoadingMessage(message, submessage);
  document.getElementById('loading-overlay').classList.remove('hidden');
}
function hideLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth === 0) document.getElementById('loading-overlay').classList.add('hidden');
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

// Returns the note text (possibly empty) if submitted, or null if
// cancelled — same contract window.prompt() had, but as an in-page modal
// (centered like every other dialog here) instead of the browser's native
// prompt, which on some platforms doesn't render centered over the page.
function showReportBugModal(title) {
  const modal = document.getElementById('report-bug-modal');
  document.getElementById('report-bug-title').textContent = title;
  const noteEl = document.getElementById('report-bug-note');
  noteEl.value = '';
  modal.classList.add('open');
  noteEl.focus();
  return new Promise((resolve) => {
    const submitBtn = document.getElementById('report-bug-submit');
    const cancelBtn = document.getElementById('report-bug-cancel');
    function cleanup(result) {
      modal.classList.remove('open');
      submitBtn.removeEventListener('click', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onSubmit() { cleanup(noteEl.value.trim()); }
    function onCancel() { cleanup(null); }
    submitBtn.addEventListener('click', onSubmit);
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
  document.getElementById('product-brand').value = product ? product.brand || '' : '';
  document.getElementById('product-category').value = product ? product.category : 'Outros';
  productModal.classList.add('open');
}

document.getElementById('add-product-btn').addEventListener('click', () => openProductModal(null));
document.getElementById('product-cancel').addEventListener('click', () => productModal.classList.remove('open'));

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('product-id').value;
  const name = document.getElementById('product-name').value;
  const brand = document.getElementById('product-brand').value;
  const category = document.getElementById('product-category').value;

  // Both POST and a name/brand PUT run a full 4-store search server-side
  // (seconds), so block the UI the same way a refresh does. A pure
  // category change is quick, but it's not worth branching on here.
  const submitBtn = productForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  showLoading(id ? 'A guardar e a procurar nas lojas…' : 'A procurar o produto nas lojas…');
  try {
    if (id) await api(`/products/${id}`, { method: 'PUT', body: JSON.stringify({ name, brand, category }) });
    else await api('/products', { method: 'POST', body: JSON.stringify({ name, brand, category }) });
    productModal.classList.remove('open');
    await loadProducts();
    showToast('Guardado.');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    hideLoading();
    submitBtn.disabled = false;
  }
});

// --- Update all prices ---
// The server runs this as a background job (it takes minutes on a large
// list); we kick it off, then poll for progress and keep the blocking
// overlay up with a live "42 de 300" count until it finishes. attachTo
// RefreshJob is also called on page load so reloading mid-run re-attaches
// instead of hiding the overlay while the job keeps going server-side.
let refreshPollTimer = null;

let refreshOverlayShown = false;

async function attachToRefreshJob() {
  if (refreshPollTimer) return;
  if (!refreshOverlayShown) {
    showLoading('A atualizar todos os preços…', 'Isto pode demorar vários minutos — mantenha esta página aberta.');
    refreshOverlayShown = true;
  }
  const poll = async () => {
    let status;
    try {
      status = await api('/products/refresh-status');
    } catch {
      refreshPollTimer = setTimeout(poll, 2000); // transient — retry next tick
      return;
    }
    if (status.running) {
      setLoadingMessage(
        'A atualizar todos os preços…',
        status.total ? `${status.done} de ${status.total} concluídos` : 'A começar…'
      );
      refreshPollTimer = setTimeout(poll, 1500);
      return;
    }
    refreshPollTimer = null;
    if (refreshOverlayShown) {
      hideLoading();
      refreshOverlayShown = false;
    }
    await loadProducts();
    showToast(status.error ? `Terminado com erros: ${status.error}` : 'Preços atualizados.', Boolean(status.error));
  };
  poll();
}

document.getElementById('update-all-btn').addEventListener('click', async () => {
  try {
    await api('/products/refresh-all', { method: 'POST' });
  } catch (err) {
    showToast(err.message, true);
    return;
  }
  attachToRefreshJob();
});

// --- Delegated actions ---
document.body.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  const refreshId = e.target.dataset.refresh;
  const reportBugId = e.target.dataset.reportBug;
  const reportBugStore = e.target.dataset.reportStore;
  const addToListId = e.target.dataset.addToList;
  const addToListStore = e.target.dataset.addToListStore;
  const correctId = e.target.dataset.correct;
  const correctStore = e.target.dataset.correctStore;
  const collapseId = e.target.dataset.collapse;
  const collapseCategory = e.target.closest('[data-collapse-category]')?.dataset.collapseCategory;

  if (correctId) {
    openCorrectModal(products.find((p) => p.id === correctId), correctStore || null);
  } else if (addToListId) {
    e.target.disabled = true;
    try {
      await api('/shopping-list', { method: 'POST', body: JSON.stringify({ productId: addToListId, store: addToListStore }) });
      showToast('Adicionado à lista de compras.');
      refreshShoppingListCount();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      e.target.disabled = false;
    }
  } else if (reportBugId) {
    const storeLabel = SCRAPED_STORES[reportBugStore] || reportBugStore;
    const note = await showReportBugModal(`Reportar erro — ${storeLabel}`);
    if (note !== null) {
      e.target.disabled = true;
      try {
        await api(`/products/${reportBugId}/report-bug`, {
          method: 'POST',
          body: JSON.stringify({ note, store: reportBugStore }),
        });
        showToast('Erro reportado — obrigado!');
      } catch (err) {
        showToast(err.message, true);
      } finally {
        e.target.disabled = false;
      }
    }
  } else if (editId) {
    openProductModal(products.find((p) => p.id === editId));
  } else if (deleteId) {
    if (await showConfirm('Eliminar este produto?')) {
      await api(`/products/${deleteId}`, { method: 'DELETE' });
      await loadProducts();
      showToast('Produto eliminado.');
    }
  } else if (refreshId) {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'A atualizar…';
    showLoading('A atualizar os preços deste produto…');
    try {
      await api(`/products/${refreshId}/refresh`, { method: 'POST' });
      await loadProducts();
      showToast('Preços atualizados.');
    } catch (err) {
      showToast(err.message, true);
      // loadProducts() re-renders (and replaces this button) only on
      // success — on error the old card stays, so restore the button.
      btn.disabled = false;
      btn.textContent = 'Atualizar';
    } finally {
      hideLoading();
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

// --- Correct a wrong match ("corrigir correspondência") ---
// The automatic pick is wrong often enough (store vocabulary, per-kg vs
// per-piece, an ambiguous name) that the user needs to override it: pick a
// different result from the store's own search, exclude the store, or reset
// to automatic. Server side: GET /candidates + PUT /override.
const correctModal = document.getElementById('correct-modal');
let correctProduct = null;

document.getElementById('correct-close').addEventListener('click', () => {
  correctModal.classList.remove('open');
  correctProduct = null;
});

function openCorrectModal(product, initialStore) {
  if (!product) return;
  correctProduct = product;
  document.getElementById('correct-title').textContent = `Corrigir correspondência — ${product.name}`;
  const overrides = product.overrides || {};
  const byStore = new Map((product.urls || []).map((e) => [e.store, e]));

  document.getElementById('correct-stores').innerHTML = Object.entries(SCRAPED_STORES)
    .map(([key, label]) => {
      const entry = byStore.get(key);
      let state = '—';
      if (overrides[key]?.excluded) state = '🚫 excluída';
      else if (overrides[key]?.url) state = '📌 fixada';
      else if (entry?.price != null) state = '✓';
      else state = '✗ sem correspondência';
      return `<button class="btn small" data-correct-pick-store="${key}">${escapeHtml(label)} <span class="correct-store-state">${state}</span></button>`;
    })
    .join('');
  document.getElementById('correct-candidates').innerHTML = '';
  correctModal.classList.add('open');
  if (initialStore) loadCorrectCandidates(initialStore);
}

document.getElementById('correct-stores').addEventListener('click', (e) => {
  const store = e.target.closest('[data-correct-pick-store]')?.dataset.correctPickStore;
  if (store) loadCorrectCandidates(store);
});

async function loadCorrectCandidates(store) {
  if (!correctProduct) return;
  const box = document.getElementById('correct-candidates');
  const storeLabel = SCRAPED_STORES[store] || store;
  box.innerHTML = `<p class="hint">A procurar em ${escapeHtml(storeLabel)}…</p>`;
  const pinnedUrl = correctProduct.overrides?.[store]?.url || null;
  const currentUrl = (correctProduct.urls || []).find((x) => x.store === store)?.url || null;

  let candidates;
  try {
    candidates = await api(`/products/${correctProduct.id}/candidates?store=${store}`);
  } catch (err) {
    box.innerHTML = `<p class="price-error">Não foi possível procurar em ${escapeHtml(storeLabel)}: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const rows = candidates
    .map((c) => {
      const checked = (pinnedUrl || currentUrl) === c.url ? 'checked' : '';
      return `<label class="correct-cand"><input type="radio" name="correct-cand" value="${escapeHtml(c.url)}" ${checked} />
        <span>${escapeHtml(c.name || '(sem nome)')}${c.isPack ? ' <span class="pack-badge pack">Pack</span>' : ''}</span>
        <span class="correct-cand-price">${fmtPrice(c.price, c.currency) || '—'}</span></label>`;
    })
    .join('');

  box.innerHTML = `
    ${candidates.length ? rows : `<p class="hint">Sem resultados em ${escapeHtml(storeLabel)}.</p>`}
    <div class="correct-actions">
      <button type="button" class="btn small" data-correct-apply="pin" data-correct-apply-store="${store}">Fixar selecionado</button>
      <button type="button" class="btn small" data-correct-apply="exclude" data-correct-apply-store="${store}">🚫 Excluir loja</button>
      <button type="button" class="btn small" data-correct-apply="auto" data-correct-apply-store="${store}">↻ Automático</button>
    </div>`;
}

document.getElementById('correct-candidates').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-correct-apply]');
  if (!btn || !correctProduct) return;
  const mode = btn.dataset.correctApply;
  const store = btn.dataset.correctApplyStore;
  let body;
  if (mode === 'exclude') body = { store, excluded: true };
  else if (mode === 'auto') body = { store, clear: true };
  else {
    const picked = document.querySelector('input[name="correct-cand"]:checked');
    if (!picked) return showToast('Escolha um produto primeiro.', true);
    body = { store, url: picked.value };
  }
  btn.closest('.correct-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
  showLoading('A aplicar a correção…');
  try {
    const updated = await api(`/products/${correctProduct.id}/override`, { method: 'PUT', body: JSON.stringify(body) });
    correctProduct = updated;
    products = products.map((p) => (p.id === updated.id ? updated : p));
    renderProducts();
    openCorrectModal(updated, store); // re-render modal state + candidate list
    showToast('Correspondência atualizada.');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    hideLoading();
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
  refreshShoppingListCount();
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

// --- Shopping list ---
async function refreshShoppingListCount() {
  const badge = document.getElementById('shopping-list-count');
  try {
    const list = await api('/shopping-list');
    const pending = list.filter((e) => !e.checked).length;
    badge.textContent = pending;
    badge.classList.toggle('hidden', pending === 0);
  } catch {
    // Not logged in yet, or a transient failure — badge just stays as-is.
  }
}

async function loadShoppingListModal() {
  const body = document.getElementById('shopping-list-body');
  body.textContent = 'A carregar...';
  let list;
  try {
    list = await api('/shopping-list');
  } catch (err) {
    body.textContent = 'Não foi possível carregar a lista.';
    return;
  }
  if (!list.length) {
    body.innerHTML = '<p class="hint">A lista de compras está vazia — use o botão 🛒 junto a um preço para adicionar.</p>';
    return;
  }

  // Grouped by store — the whole point is "what do I need to buy at each
  // store, and how much will it come to" (checked/already-bought items
  // still show, struck through, but don't count toward the subtotal).
  const byStore = new Map();
  for (const entry of list) {
    if (!byStore.has(entry.store)) byStore.set(entry.store, []);
    byStore.get(entry.store).push(entry);
  }

  body.innerHTML = [...byStore.entries()]
    .map(([store, entries]) => {
      const storeLabel = SCRAPED_STORES[store] || store;
      const subtotal = entries.filter((e) => !e.checked).reduce((sum, e) => sum + e.price, 0);
      const currency = entries[0]?.currency || 'EUR';
      const rows = entries
        .map(
          (e) => `
        <div class="shopping-list-row ${e.checked ? 'checked' : ''}" data-entry-id="${escapeHtml(e.id)}">
          <label class="shopping-list-item">
            <input type="checkbox" class="shopping-list-toggle" ${e.checked ? 'checked' : ''} />
            <span>${escapeHtml(e.productName)}</span>
          </label>
          <span class="shopping-list-price">${fmtPrice(e.price, e.currency)}</span>
          <button type="button" class="btn small" data-shopping-list-remove="${escapeHtml(e.id)}" title="Remover">✕</button>
        </div>`
        )
        .join('');
      return `
      <div class="shopping-list-store">
        <div class="shopping-list-store-header">
          <strong>${escapeHtml(storeLabel)}</strong>
          <span>${fmtPrice(subtotal, currency)}</span>
        </div>
        ${rows}
      </div>`;
    })
    .join('');

  body.querySelectorAll('.shopping-list-toggle').forEach((el) =>
    el.addEventListener('change', async (e) => {
      const entryId = e.target.closest('.shopping-list-row').dataset.entryId;
      try {
        await api(`/shopping-list/${entryId}/toggle`, { method: 'POST' });
        await loadShoppingListModal();
        refreshShoppingListCount();
      } catch (err) {
        showToast(err.message, true);
      }
    })
  );
  body.querySelectorAll('[data-shopping-list-remove]').forEach((el) =>
    el.addEventListener('click', async (e) => {
      const entryId = e.target.dataset.shoppingListRemove;
      try {
        await api(`/shopping-list/${entryId}`, { method: 'DELETE' });
        await loadShoppingListModal();
        refreshShoppingListCount();
      } catch (err) {
        showToast(err.message, true);
      }
    })
  );
}

document.getElementById('shopping-list-btn').addEventListener('click', () => {
  document.getElementById('shopping-list-modal').classList.add('open');
  loadShoppingListModal();
});
document.getElementById('shopping-list-close').addEventListener('click', () => {
  document.getElementById('shopping-list-modal').classList.remove('open');
});
document.getElementById('shopping-list-clear').addEventListener('click', async () => {
  try {
    await api('/shopping-list', { method: 'DELETE' });
    await loadShoppingListModal();
    refreshShoppingListCount();
  } catch (err) {
    showToast(err.message, true);
  }
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

  // If a whole-catalogue refresh is still running server-side (e.g. the
  // page was reloaded mid-run), re-attach the progress overlay to it.
  try {
    const status = await api('/products/refresh-status');
    if (status.running) attachToRefreshJob();
  } catch {
    // no session / transient — nothing to attach to
  }

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

const BUG_REPORT_STATUS_LABELS = { open: 'Por resolver', resolved: 'Resolvido', false_positive: 'Falso positivo' };

async function loadAdminBugReports() {
  const list = document.getElementById('admin-bug-reports-list');
  list.textContent = 'A carregar...';
  let reports;
  try {
    reports = await fetch('/api/admin/bug-reports').then((r) => r.json());
  } catch {
    list.textContent = 'Não foi possível carregar relatórios.';
    return;
  }
  if (!reports.length) {
    list.innerHTML = '<p class="hint">Ainda não há relatórios.</p>';
    return;
  }
  list.innerHTML = reports
    .map((r) => {
      const storeLabel = SCRAPED_STORES[r.reportedStore] || r.reportedStore || '(todas as lojas)';
      const date = new Date(r.reportedAt).toLocaleString('pt-PT');
      const entry = r.stores?.find((s) => s.store === r.reportedStore);
      const priceInfo = entry?.price != null ? `€${entry.price} — "${escapeHtml(entry.scrapedName || '')}"` : entry?.error || '';
      return `
    <div class="bug-report-row status-${r.status}" data-report-id="${escapeHtml(r.id)}">
      <div class="bug-report-header">
        <strong>${escapeHtml(r.productName)}</strong>
        <span class="bug-report-status">${BUG_REPORT_STATUS_LABELS[r.status] || r.status}</span>
      </div>
      <div class="bug-report-meta">${escapeHtml(storeLabel)} · ${escapeHtml(r.userEmail || '')} · ${date}</div>
      ${priceInfo ? `<div class="bug-report-meta">${priceInfo}</div>` : ''}
      ${r.note ? `<div class="bug-report-note">${escapeHtml(r.note)}</div>` : ''}
      <div class="bug-report-actions">
        ${r.status !== 'resolved' ? '<button type="button" class="btn small" data-bug-status="resolved">✅ Resolvido</button>' : ''}
        ${r.status !== 'false_positive' ? '<button type="button" class="btn small" data-bug-status="false_positive">🤷 Falso positivo</button>' : ''}
        ${r.status !== 'open' ? '<button type="button" class="btn small" data-bug-status="open">↺ Reabrir</button>' : ''}
      </div>
    </div>`;
    })
    .join('');

  list.querySelectorAll('[data-bug-status]').forEach((btn) =>
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.bug-report-row');
      const reportId = row.dataset.reportId;
      const status = e.target.dataset.bugStatus;
      try {
        await api(`/admin/bug-reports/${encodeURIComponent(reportId)}/status`, {
          method: 'POST',
          body: JSON.stringify({ status }),
        });
        await loadAdminBugReports();
      } catch (err) {
        showToast(err.message, true);
      }
    })
  );
}

document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('settings-modal').classList.add('open');
  refreshNotifyToggleState();
  if (currentUser?.isAdmin) {
    loadAdminUsers();
    loadAdminBugReports();
  }
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
