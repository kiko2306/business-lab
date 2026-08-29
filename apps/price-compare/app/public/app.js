const SCRAPED_STORES = { continente: 'Continente', pingodoce: 'Pingo Doce', lidl: 'Lidl' };

let products = [];
let categories = [];

// Which product cards are collapsed, persisted per-browser so it survives
// a reload. Keyed by product id.
let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem('priceCompare.collapsed') || '[]'));
} catch {
  collapsed = new Set();
}
function saveCollapsed() {
  try {
    localStorage.setItem('priceCompare.collapsed', JSON.stringify([...collapsed]));
  } catch {
    // localStorage unavailable — collapse state just won't persist, fine.
  }
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

    const section = document.createElement('section');
    section.className = 'category-section';
    const heading = document.createElement('h2');
    heading.className = 'category-heading';
    heading.textContent = cat;
    section.appendChild(heading);

    for (const product of items.sort((a, b) => a.name.localeCompare(b.name))) {
      section.appendChild(renderProductCard(product));
    }
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
    <h3><button class="collapse-toggle" data-collapse="${product.id}" title="${isCollapsed ? 'Expand' : 'Collapse'}">${isCollapsed ? '▸' : '▾'}</button> ${escapeHtml(product.name)}</h3>
    <div class="product-actions">
      <button class="btn small" data-refresh="${product.id}">Refresh</button>
      <button class="btn small" data-edit="${product.id}">Edit</button>
      <button class="btn small danger" data-delete="${product.id}">Delete</button>
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
      : `<span class="price-value missing">${row.error ? 'fetch failed' : 'no price'}</span>`;
    const actionHtml = row.url ? `<a class="btn small" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Open</a>` : '';

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
  document.getElementById('product-modal-title').textContent = product ? 'Edit product' : 'Add product';
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
    showToast('Saved.');
  } catch (err) {
    showToast(err.message, true);
  }
});

// --- Update all prices ---
document.getElementById('update-all-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '↻ Updating…';
  try {
    await api('/products/refresh-all', { method: 'POST' });
    await loadProducts();
    showToast('Prices updated.');
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

  if (editId) {
    openProductModal(products.find((p) => p.id === editId));
  } else if (deleteId) {
    if (await showConfirm('Delete this product?')) {
      await api(`/products/${deleteId}`, { method: 'DELETE' });
      await loadProducts();
      showToast('Product deleted.');
    }
  } else if (refreshId) {
    e.target.disabled = true;
    e.target.textContent = 'Refreshing…';
    try {
      await api(`/products/${refreshId}/refresh`, { method: 'POST' });
      await loadProducts();
      showToast('Prices refreshed.');
    } catch (err) {
      showToast(err.message, true);
    }
  } else if (collapseId) {
    if (collapsed.has(collapseId)) collapsed.delete(collapseId);
    else collapsed.add(collapseId);
    saveCollapsed();
    renderProducts();
  }
});

loadCategories().then(loadProducts);
