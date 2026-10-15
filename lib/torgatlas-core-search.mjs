// Client for the Core public-search API (read-only, service token). The website daemon never touches PostgreSQL:
// it sends a structured filter and receives whitelisted public card fields. Only the configured URL is ever called;
// redirects are refused; the response is size- and time-bounded and re-validated before anything is shown.
import { redactPersonalData } from './torgatlas-public-web-research.mjs';

const MAX_RESPONSE_BYTES = 200_000;
const MAX_CARDS = 5;
const CORE_FILTER_KEYS = ['asset_subtypes', 'asset_classes', 'regions', 'federal_districts', 'procedures', 'price_min', 'price_max',
  'keywords', 'limit', 'deadline_from', 'deadline_to'];

export class CoreSearchError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

export function coreConfig(env = process.env) {
  const url = String(env.AI_LOT_CORE_URL || '');
  const token = String(env.AI_LOT_CORE_TOKEN || '');
  if (!url || token.length < 20) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return { url: parsed.href, token };
}

export function safeSourceUrl(raw) {
  try {
    const url = new URL(String(raw));
    const host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.')) return null;
    if (/^[\d.]+$/.test(host) || host.includes(':') || /\.(?:local|internal|localhost)$/.test(host)) return null;
    return url.href.length <= 500 ? url.href : null;
  } catch { return null; }
}

function checkedAtOrNull(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function mapCard(card) {
  const url = safeSourceUrl(card?.source_url);
  if (!url || typeof card.title !== 'string' || !card.title.trim()) return null;
  const amount = card.price && Number.isFinite(Number(card.price.amount)) ? Number(card.price.amount) : null;
  const confirmed = card.status?.confirmed === true;
  return {
    title: redactPersonalData(card.title).slice(0, 300),
    url,
    source: new URL(url).hostname,
    checked_at: checkedAtOrNull(card.checked_at),
    category: typeof card.category === 'string' ? card.category.slice(0, 100) : null,
    procedure_type: typeof card.procedure?.label === 'string' ? card.procedure.label.slice(0, 100) : null,
    region: typeof card.region === 'string' ? redactPersonalData(card.region).slice(0, 100) : null,
    price_rub: amount,
    price_meaning: amount != null && typeof card.price.meaning === 'string' ? card.price.meaning.slice(0, 120) : null,
    application_deadline: checkedAtOrNull(card.application_deadline),
    accepting_applications: confirmed ? 'CONFIRMED_BY_CATALOGUE_DEADLINE' : 'NOT_CONFIRMED',
    status_label: typeof card.status?.label === 'string' ? card.status.label.slice(0, 160) : null
  };
}

export async function searchCore(filters, { config = coreConfig(), fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!config) throw new CoreSearchError('CORE_NOT_CONFIGURED');
  const body = {};
  for (const key of CORE_FILTER_KEYS) if (filters[key] !== undefined) body[key] = filters[key];
  body.limit = MAX_CARDS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
      cache: 'no-store'
    });
    if (response.status === 503 || response.status === 429) throw new CoreSearchError('CORE_BUSY');
    if (response.status === 504) throw new CoreSearchError('CORE_TIMEOUT');
    if (response.status === 401 || response.status === 404) throw new CoreSearchError('CORE_AUTH');
    if (response.status === 422) throw new CoreSearchError('CORE_REJECTED_FILTER');
    if (!response.ok) throw new CoreSearchError('CORE_ERROR');
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_RESPONSE_BYTES) throw new CoreSearchError('CORE_RESPONSE_TOO_LARGE');
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new CoreSearchError('CORE_RESPONSE_TOO_LARGE');
    let data;
    try { data = JSON.parse(text); } catch { throw new CoreSearchError('CORE_BAD_RESPONSE'); }
    if (!data || !Array.isArray(data.results)) throw new CoreSearchError('CORE_BAD_RESPONSE');
    const lots = [];
    for (const card of data.results) {
      const mapped = mapCard(card);
      if (mapped) lots.push(mapped);
      if (lots.length >= MAX_CARDS) break;
    }
    // Several lots can belong to ONE publication (same link). Say so: the link opens the publication, it is not four independent sources.
    const perUrl = new Map();
    for (const lot of lots) perUrl.set(lot.url, (perUrl.get(lot.url) || 0) + 1);
    for (const lot of lots) lot.same_publication_count = perUrl.get(lot.url) - 1;
    return { lots, generated_at: checkedAtOrNull(data.generated_at), meta: data.meta && typeof data.meta === 'object' ? { candidates: Number(data.meta.candidates) || 0 } : {} };
  } catch (error) {
    if (error instanceof CoreSearchError) throw error;
    if (error?.name === 'AbortError') throw new CoreSearchError('CORE_TIMEOUT');
    throw new CoreSearchError('CORE_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}

// Live health of the Core search container. Unauthenticated GET /health of the same origin (no token is sent, nothing is searched);
// the result is cached briefly so the public status endpoint can never be used to hammer Core.
export function createCoreProbe({ config = coreConfig, fetchImpl = fetch, now = () => Date.now(), okTtlMs = 10_000, failTtlMs = 4_000, timeoutMs = 1_500 } = {}) {
  let cached = null;
  return async function coreHealthy(env = process.env) {
    const cfg = config(env);
    if (!cfg) return null;
    if (cached && now() < cached.until) return cached.value;
    let value = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL('/health', cfg.url).href, { method: 'GET', redirect: 'error', signal: controller.signal, cache: 'no-store' });
      const data = response.ok ? await response.json().catch(() => null) : null;
      value = Boolean(data && data.ok === true);
    } catch { value = false; } finally { clearTimeout(timer); }
    cached = { value, until: now() + (value ? okTtlMs : failTtlMs) };
    return value;
  };
}
