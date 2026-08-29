const SCRAPED_STORES = { continente: 'Continente', pingodoce: 'Pingo Doce', lidl: 'Lidl' };
const MANUAL_STORES = { recheio: 'Recheio', makro: 'Makro' };

let products = [];
let categories = [];

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
  // One row per known store — scraped rows may repeat if the product has
  // more than one URL for the same store (unusual but not prevented).
  const rows = [];
  for (const entry of product.urls) {
    const label = SCRAPED_STORES[entry.store] || entry.store || 'Unknown store';
    rows.push({ key: entry.store, label, price: entry.price, currency: entry.currency, error: entry.error, url: entry.url, kind: 'scraped' });
  }
  for (const [key, label] of Object.entries(MANUAL_STORES)) {
    const manual = product.manualPrices[key];
    rows.push({ key, label, price: manual ? manual.price : null, currency: 'EUR', kind: 'manual' });
  }

  const cheapest = rows.reduce((min, r) => (r.price != null && (min == null || r.price < min) ? r.price : min), null);

  const card = document.createElement('div');
  card.className = 'product-card';

  const header = document.createElement('div');
  header.className = 'product-card-header';
  header.innerHTML = `
    <h3>${escapeHtml(product.name)}</h3>
    <div class="product-actions">
      <button class="btn small" data-refresh="${product.id}">Refresh</button>
      <button class="btn small" data-edit="${product.id}">Edit</button>
      <button class="btn small danger" data-delete="${product.id}">Delete</button>
    </div>
  `;
  card.appendChild(header);

  for (const row of rows) {
    const div = document.createElement('div');
    div.className = 'price-row';
    const priceText = fmtPrice(row.price, row.currency);
    const isCheapest = row.price != null && row.price === cheapest;
    const priceHtml = priceText
      ? `<span class="price-value ${isCheapest ? 'cheapest' : ''}">${priceText}</span>`
      : `<span class="price-value missing">${row.kind === 'manual' ? 'not set' : row.error ? 'fetch failed' : 'no price'}</span>`;

    const actionHtml =
      row.kind === 'manual'
        ? `<button class="btn small" data-set-manual="${row.key}" data-product="${product.id}">Set</button>`
        : row.url
          ? `<a class="btn small" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Open</a>`
          : '';

    div.innerHTML = `
      <span class="store-name">${escapeHtml(row.label)} <span class="store-badge">${row.kind}</span></span>
      <span class="price-actions">${priceHtml}${actionHtml}</span>
    `;
    if (row.error) {
      const err = document.createElement('div');
      err.className = 'price-error';
      err.textContent = row.error;
      div.appendChild(err);
    }
    card.appendChild(div);
  }

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

// --- Manual price modal ---
const manualModal = document.getElementById('manual-modal');
const manualForm = document.getElementById('manual-form');

function openManualModal(productId, store) {
  const product = products.find((p) => p.id === productId);
  const existing = product?.manualPrices[store];
  document.getElementById('manual-product-id').value = productId;
  document.getElementById('manual-store').value = store;
  document.getElementById('manual-store-label').textContent = `${MANUAL_STORES[store]} price`;
  document.getElementById('manual-price').value = existing ? existing.price : '';
  manualModal.classList.add('open');
}

document.getElementById('manual-cancel').addEventListener('click', () => manualModal.classList.remove('open'));

manualForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const productId = document.getElementById('manual-product-id').value;
  const store = document.getElementById('manual-store').value;
  const price = document.getElementById('manual-price').value;
  try {
    await api(`/products/${productId}/manual-price`, { method: 'PUT', body: JSON.stringify({ store, price: price === '' ? null : price }) });
    manualModal.classList.remove('open');
    await loadProducts();
    showToast('Price updated.');
  } catch (err) {
    showToast(err.message, true);
  }
});

// --- Delegated actions ---
document.body.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  const refreshId = e.target.dataset.refresh;
  const manualStore = e.target.dataset.setManual;

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
  } else if (manualStore) {
    openManualModal(e.target.dataset.product, manualStore);
  }
});

loadCategories().then(loadProducts);
