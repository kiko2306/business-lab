/*
 * Web Push — notifies a user when a tracked product's price drops 10% or
 * more at any store, compared to that store's previously recorded price.
 * No external service/account: VAPID is a self-contained keypair, and
 * delivery goes straight from this server to the browser vendor's push
 * endpoint (the same infra Chrome/Firefox/etc. already use).
 *
 * Subscriptions (one per browser/device a user has granted permission on)
 * are stored per user, alongside products.json but in their own file since
 * they're not product data.
 */

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const SUBS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (configured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function isConfigured() {
  return configured;
}

function publicKey() {
  return VAPID_PUBLIC_KEY;
}

function loadAll() {
  if (!fs.existsSync(SUBS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8') || '{}');
  } catch (err) {
    console.error('Failed to read push-subscriptions.json, starting empty:', err.message);
    return {};
  }
}

function saveAll(subsByUser) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SUBS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(subsByUser, null, 2));
  fs.renameSync(tmp, SUBS_FILE);
}

// De-duped by endpoint — re-subscribing the same browser (e.g. after
// clearing site data and re-granting permission) replaces its old entry
// rather than piling up duplicates that would each get their own push.
function addSubscription(userId, subscription) {
  const all = loadAll();
  const list = (all[userId] || []).filter((s) => s.endpoint !== subscription.endpoint);
  list.push(subscription);
  all[userId] = list;
  saveAll(all);
}

function removeSubscription(userId, endpoint) {
  const all = loadAll();
  if (!all[userId]) return;
  all[userId] = all[userId].filter((s) => s.endpoint !== endpoint);
  saveAll(all);
}

const STORE_LABELS = { continente: 'Continente', pingodoce: 'Pingo Doce', lidl: 'Lidl', auchan: 'Auchan' };

function formatEuro(price) {
  return price.toFixed(2).replace('.', ',') + '€';
}

// `drops` — [{ productName, store, oldPrice, newPrice, pct }], all belonging
// to one user's own refresh run (manual or scheduled). Sent as a single
// notification per run, not one per drop, so a big daily update with
// several drops doesn't spam the user with a stack of separate pushes.
async function notifyPriceDrops(userId, drops) {
  if (!configured || !drops.length) return;
  const all = loadAll();
  const subs = all[userId] || [];
  if (!subs.length) return;

  const pctOf = (d) => Math.round(d.pct * 100);
  let title;
  let body;
  if (drops.length === 1) {
    const d = drops[0];
    title = `${d.productName} desceu ${pctOf(d)}%`;
    body = `${STORE_LABELS[d.store] || d.store}: ${formatEuro(d.oldPrice)} → ${formatEuro(d.newPrice)}`;
  } else {
    title = `${drops.length} preços desceram 10% ou mais`;
    const shown = drops.slice(0, 3).map((d) => `${d.productName} (${STORE_LABELS[d.store] || d.store}) -${pctOf(d)}%`);
    body = shown.join(', ') + (drops.length > 3 ? `, +${drops.length - 3} mais` : '');
  }
  const payload = JSON.stringify({ title, body });

  const stillValid = [];
  let changed = false;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      stillValid.push(sub);
    } catch (err) {
      // 404/410 = the browser vendor confirms this subscription no longer
      // exists (uninstalled, permission revoked, site data cleared) — drop
      // it. Any other error is transient (network blip, vendor outage) so
      // keep the subscription and just log it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        changed = true;
        continue;
      }
      console.error('push send failed:', err.message);
      stillValid.push(sub);
    }
  }
  if (changed) {
    all[userId] = stillValid;
    saveAll(all);
  }
}

module.exports = {
  isConfigured,
  publicKey,
  addSubscription,
  removeSubscription,
  notifyPriceDrops,
};
