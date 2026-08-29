const UNIT_LABELS = { kg: 'Kg', g: 'Gr', l: 'Lt', uni: 'Uni' };

let items = [];

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

function fmtQty(qty, unit) {
  const n = Math.round(qty * 1000) / 1000;
  return `${n} ${UNIT_LABELS[unit] || unit}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const ms = new Date(dateStr + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

function expirationClass(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return '';
  if (days < 0) return 'expired';
  if (days <= 3) return 'expiring-soon';
  return '';
}

function expirationLabel(dateStr) {
  if (!dateStr) return '—';
  const days = daysUntil(dateStr);
  if (days < 0) return `${dateStr} (expired)`;
  if (days === 0) return `${dateStr} (today)`;
  return `${dateStr} (${days}d)`;
}

async function loadItems() {
  items = await api('/items');
  renderStock();
  renderUse();
}

function renderStock() {
  const tbody = document.querySelector('#stock-table tbody');
  tbody.innerHTML = '';
  document.getElementById('stock-empty').classList.toggle('hidden', items.length > 0);

  for (const item of items) {
    const tr = document.createElement('tr');
    const lowStock = item.minStock > 0 && item.quantity <= item.minStock;
    tr.className = [lowStock ? 'low-stock' : '', expirationClass(item.expirationDate)].join(' ').trim();
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${fmtQty(item.quantity, item.unit)}</td>
      <td>${item.minStock > 0 ? fmtQty(item.minStock, item.unit) : '—'}</td>
      <td>${expirationLabel(item.expirationDate)}</td>
      <td class="row-actions">
        <button class="btn" data-edit="${item.id}">Edit</button>
        <button class="btn danger" data-delete="${item.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function renderUse() {
  const tbody = document.querySelector('#use-table tbody');
  tbody.innerHTML = '';
  const inStock = items.filter((i) => i.quantity > 0);
  document.getElementById('use-empty').classList.toggle('hidden', inStock.length > 0);

  for (const item of inStock) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${fmtQty(item.quantity, item.unit)}</td>
      <td>
        <div class="use-input">
          <input type="number" step="any" min="0" max="${item.quantity}" placeholder="0" data-use-amount="${item.id}" />
          <span>${UNIT_LABELS[item.unit] || item.unit}</span>
        </div>
      </td>
      <td><button class="btn primary" data-use="${item.id}">Use</button></td>
    `;
    tbody.appendChild(tr);
  }
}

async function renderShopping() {
  const list = await api('/shopping-list');
  const tbody = document.querySelector('#shopping-table tbody');
  tbody.innerHTML = '';
  document.getElementById('shopping-empty').classList.toggle('hidden', list.length > 0);

  for (const item of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${fmtQty(item.quantity, item.unit)}</td>
      <td>${fmtQty(item.minStock, item.unit)}</td>
      <td><strong>${fmtQty(item.neededQty, item.unit)}</strong></td>
      <td><button class="btn primary" data-restock="${item.id}" data-restock-amount="${item.neededQty}">Mark bought</button></td>
    `;
    tbody.appendChild(tr);
  }
}

// --- Popups (replace native alert/confirm, which block automation and are
// jarring on mobile) ---
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Tabs ---
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    if (btn.dataset.tab === 'shopping') renderShopping();
  });
});

// --- Add/Edit modal ---
const modal = document.getElementById('item-modal');
const form = document.getElementById('item-form');

function openModal(item) {
  document.getElementById('item-modal-title').textContent = item ? 'Edit item' : 'Add item';
  document.getElementById('item-id').value = item ? item.id : '';
  document.getElementById('item-name').value = item ? item.name : '';
  document.getElementById('item-unit').value = item ? item.unit : 'uni';
  document.getElementById('item-quantity').value = item ? item.quantity : 0;
  document.getElementById('item-min-stock').value = item ? item.minStock : 0;
  document.getElementById('item-expiration').value = item ? item.expirationDate || '' : '';
  modal.classList.add('open');
}

document.getElementById('add-item-btn').addEventListener('click', () => openModal(null));
document.getElementById('item-cancel').addEventListener('click', () => modal.classList.remove('open'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('item-id').value;
  const payload = {
    name: document.getElementById('item-name').value,
    unit: document.getElementById('item-unit').value,
    quantity: document.getElementById('item-quantity').value,
    minStock: document.getElementById('item-min-stock').value,
    expirationDate: document.getElementById('item-expiration').value || null,
  };
  try {
    if (id) await api(`/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/items', { method: 'POST', body: JSON.stringify(payload) });
    modal.classList.remove('open');
    await loadItems();
  } catch (err) {
    showToast(err.message, true);
  }
});

// --- Row actions (delegated) ---
document.body.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  const useId = e.target.dataset.use;
  const restockId = e.target.dataset.restock;

  if (editId) {
    openModal(items.find((i) => i.id === editId));
  } else if (deleteId) {
    if (await showConfirm('Delete this item?')) {
      await api(`/items/${deleteId}`, { method: 'DELETE' });
      await loadItems();
      showToast('Item deleted.');
    }
  } else if (useId) {
    const input = document.querySelector(`[data-use-amount="${useId}"]`);
    const amount = Number(input.value);
    if (!amount || amount <= 0) return showToast('Enter an amount to use.', true);
    try {
      await api(`/items/${useId}/use`, { method: 'POST', body: JSON.stringify({ amount }) });
      await loadItems();
      showToast('Stock updated.');
    } catch (err) {
      showToast(err.message, true);
    }
  } else if (restockId) {
    const amount = Number(e.target.dataset.restockAmount);
    await api(`/items/${restockId}/restock`, { method: 'POST', body: JSON.stringify({ amount }) });
    await loadItems();
    await renderShopping();
    showToast('Marked as bought.');
  }
});

loadItems();
