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
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
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
    `"amaciador de cabelo" = "condicionador", "tangerina" = "clementina"/"mandarina", "colorau" = "paprika"). ` +
    `Reject a different product type, a different core variant (lactose-free vs normal, greek vs plain, ` +
    `flavoured vs plain), or a clearly different size/pack. If several fit, choose the plainest standard single unit.\n` +
    `Answer with ONLY the number of the best match, or 0 if none fits.\n\n${list}`
  );
}

// Returns the 0-based index of the chosen candidate, or -1 for "none".
async function pickCandidate(query, names) {
  if (!isConfigured() || !Array.isArray(names) || !names.length) return -1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(query, names) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return -1;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const m = text.match(/\d+/);
    if (!m) return -1;
    const n = Number(m[0]);
    return n >= 1 && n <= names.length ? n - 1 : -1;
  } catch {
    return -1; // network, abort, quota, malformed — treat as no match
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, pickCandidate, buildPrompt, MODEL };
