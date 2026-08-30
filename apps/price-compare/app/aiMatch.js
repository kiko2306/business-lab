/*
 * Optional last-resort product matcher backed by the Google Gemini API
 * (free tier — aistudio.google.com → "Get API key", no card). Used ONLY
 * when the deterministic pipeline in scrapers.js returns NoMatch for a
 * store: given the store's search-result names, Gemini is asked which one
 * (if any) is the same product, so vocabulary/synonym cases the word-
 * overlap heuristics can't reach ("achocolatado" = "chocolate em pó",
 * "amaciador de cabelo" = "condicionador", "tangerina" = "clementina")
 * still get a price.
 *
 * The app boots and works exactly as before when GEMINI_API_KEY is unset
 * (same pattern as GOOGLE_CLIENT_ID / VAPID_* / ADSENSE_CLIENT_ID) — the
 * call site checks isConfigured() first. Any error (network, quota, a
 * weird reply) is swallowed and treated as "no match", so a bad day for
 * the API is never worse than not having it.
 *
 * No SDK — a single plain fetch, matching this app's minimal-deps style.
 */
const API_KEY = process.env.GEMINI_API_KEY || '';
// A "lite" flash model is plenty for "pick the number" and returns a bare
// answer without burning the token budget on internal reasoning (the
// non-lite 3.x models need a much larger maxOutputTokens or they finish
// with MAX_TOKENS and no text). Overridable via GEMINI_MODEL.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 8000;

function isConfigured() {
  return Boolean(API_KEY);
}

function buildPrompt(query, names) {
  const list = names.map((n, i) => `${i + 1}. ${n}`).join('\n');
  return (
    `A shopper in Portugal is looking for this grocery product: "${query}".\n` +
    `Below are the results from a Portuguese supermarket's search. Which ONE is the same product the shopper wants?\n` +
    `Accept synonyms and how stores actually name things (e.g. "achocolatado" = "chocolate em pó", ` +
    `"amaciador de cabelo" = "condicionador", "tangerina" = "clementina"/"mandarina", "colorau" = "paprika", ` +
    `"cornetos" = "gelado Cornetto", "miolo de noz" = shelled walnuts).\n` +
    `Reject a different product type, a different core variant (lactose-free vs normal, greek vs plain, ` +
    `flavoured vs plain), or a clearly different size/pack.\n` +
    `IMPORTANT: if the shopper wants a FRESH fruit, vegetable, herb, or fresh meat/fish and EVERY result ` +
    `is a processed version (juice, nectar, jam, compote, purée, paste, concentrate, canned, dried, frozen, ` +
    `a snack, a drink, a sauce), answer 0 — a processed form is not the fresh product.\n` +
    `If several genuinely fit, choose the plainest standard single unit.\n` +
    `Answer with ONLY the number of the best match, or 0 if none fits.\n\n${list}`
  );
}

// One request. Resolves { status, text } — never throws.
async function askOnce(query, names) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(query, names) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 24 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: res.status, text: '' };
    const data = await res.json();
    return { status: 200, text: data?.candidates?.[0]?.content?.parts?.[0]?.text || '' };
  } catch {
    return { status: 0, text: '' }; // network, abort — same as a failed call
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Once the free tier's per-minute quota is hit, every remaining item in a
// big refresh would silently fall back to no-match with nothing in the
// logs. Retry a 429 (and a 503 "high demand") a couple of times with
// growing backoff, and log when the retries are exhausted so an
// unexpectedly bad batch is visible rather than mysterious.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1500, 6000];

// Returns the 0-based index of the chosen candidate, or -1 for "none".
async function pickCandidate(query, names) {
  if (!isConfigured() || !Array.isArray(names) || !names.length) return -1;

  let last = { status: 0, text: '' };
  for (let attempt = 0; ; attempt++) {
    last = await askOnce(query, names);
    if (last.status === 200) break;
    if (attempt >= RETRY_DELAYS_MS.length || !RETRY_STATUSES.has(last.status)) break;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  if (last.status !== 200) {
    // Quota/outage is worth a line; an ordinary "model said nothing" isn't.
    if (RETRY_STATUSES.has(last.status)) {
      console.warn(`[aiMatch] giving up after retries (HTTP ${last.status}) for "${query}"`);
    }
    return -1;
  }

  const m = last.text.match(/\d+/);
  if (!m) return -1;
  const n = Number(m[0]);
  return n >= 1 && n <= names.length ? n - 1 : -1;
}

module.exports = { isConfigured, pickCandidate, buildPrompt, MODEL };
