import { normalizeQuery, publicResearchMiniSearch } from '../lib/torgatlas-public-web-research.mjs';
import { createChallenge, verifyPayload, strongKey, ReplayStore, IssueLimiter } from '../lib/torgatlas-altcha.mjs';
import { parseIntent } from '../lib/torgatlas-intent.mjs';
import { coreConfig, searchCore, CoreSearchError, createCoreProbe } from '../lib/torgatlas-core-search.mjs';

export const maxDuration = 60;
export const MAX_RESULTS = 5;
const BODY_LIMIT = 3600;           // JSON characters: query (<=400) + ALTCHA payload (<=2048)
const ALLOWED_BODY_KEYS = new Set(['query', 'altcha']);
const enabled = env => env.AI_LOT_SEARCH_ENABLED === 'true' && env.AI_LOT_SECURITY_APPROVED === 'true' && env.AI_LOT_LEGAL_APPROVED === 'true';

function send(res, code, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(data);
}

// Factory so tests can inject time, env and the Core transport; the default export below is what the daemon uses.
export function createAiLotSearchHandler({ env = process.env, nowSeconds = () => Math.floor(Date.now() / 1000), core = searchCore, web = publicResearchMiniSearch, probe = createCoreProbe() } = {}) {
  const replay = new ReplayStore();
  const issueLimiter = new IssueLimiter();
  const startedAt = nowSeconds();   // challenges issued before this process started carry no replay memory and are refused

  const captchaRequired = () => env.AI_LOT_ALTCHA_REQUIRED === 'true';
  // Policy switch: with AI_LOT_REQUIRE_CORE=true the legacy web-research engine is NEVER used as a silent substitute.
  const requireCore = () => env.AI_LOT_REQUIRE_CORE === 'true';
  const captchaKey = () => (strongKey(env.AI_LOT_ALTCHA_HMAC_KEY) ? env.AI_LOT_ALTCHA_HMAC_KEY : null);

  return async function handler(req, res) {
    const clientKey = String(req.clientIp || req.socket?.remoteAddress || 'unknown').slice(0, 80);
    if (req.method === 'GET') {
      if (req.query?.altcha === '1' || String(req.url || '').includes('altcha=1')) {
        const key = captchaKey();
        if (!key) return send(res, 503, { ok: false, code: 'CAPTCHA_UNAVAILABLE' });
        if (!issueLimiter.allow(clientKey)) { res.setHeader('Retry-After', '30'); return send(res, 429, { ok: false, code: 'RATE_LIMITED' }); }
        return send(res, 200, createChallenge(key, nowSeconds()));
      }
      // CORE_SEARCH only while the Core container really answers; otherwise the status says so instead of reporting a mere configuration.
      const mode = coreConfig(env) ? ((await probe(env)) ? 'CORE_SEARCH' : 'CORE_UNAVAILABLE') : requireCore() ? 'UNAVAILABLE_CORE_REQUIRED' : 'PUBLIC_WEB_RESEARCH_MINI';
      return send(res, 200, { enabled: enabled(env), max_results: MAX_RESULTS, mode, captcha: { required: captchaRequired() } });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    if (!enabled(env)) return send(res, 503, { ok: false, code: 'NOT_ENABLED' });
    if (req.headers.origin !== 'https://torgatlas.ru') return send(res, 403, { ok: false, code: 'ORIGIN_DENIED' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { ok: false, code: 'BAD_CONTENT_TYPE' });

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (JSON.stringify(body).length > BODY_LIMIT) return send(res, 413, { ok: false, code: 'INVALID_BODY' });
    const query = normalizeQuery(body.query);
    if (typeof body.query !== 'string' || body.query.length > 400 || query.length < 12 || Object.keys(body).some(key => !ALLOWED_BODY_KEYS.has(key))) {
      return send(res, 422, { ok: false, code: 'INVALID_QUERY' });
    }

    // CAPTCHA: verified and consumed BEFORE any parsing, Core access or source research. The token is used up even
    // if the search later fails (one proof of work = one request), and consume() is synchronous so a parallel
    // request carrying the same token loses the race.
    if (captchaRequired() || body.altcha !== undefined) {
      const key = captchaKey();
      if (!key) return send(res, 503, { ok: false, code: 'CAPTCHA_UNAVAILABLE' });
      const verdict = verifyPayload(body.altcha, key, { nowSeconds: nowSeconds(), notBefore: startedAt });
      if (!verdict.ok) return send(res, 403, { ok: false, code: verdict.code });
      const used = replay.consume(verdict.challenge, verdict.expires, nowSeconds());
      if (used === 'REPLAY') return send(res, 403, { ok: false, code: 'CAPTCHA_REPLAY' });
      if (used === 'FULL') { res.setHeader('Retry-After', '30'); return send(res, 503, { ok: false, code: 'BUSY' }); }
    }

    const retrievedAt = new Date().toISOString();
    const config = coreConfig(env);
    if (!config && requireCore()) {
      return send(res, 503, { ok: false, code: 'SERVICE_UNAVAILABLE', reason: 'CORE_NOT_CONNECTED' });
    }
    if (!config) {
      // Core not connected: the existing bounded public-web-research path (unchanged behaviour), capped at five cards.
      // Its own matcher decides relevance, so the rule-based interpretation is NOT shown (it would over-claim).
      const result = await web(query, { source: 'all', limit: MAX_RESULTS, rateKey: clientKey });
      if (Array.isArray(result.lots)) result.lots = result.lots.slice(0, MAX_RESULTS);
      return send(res, 200, { ...result, max_results: MAX_RESULTS, retrieved_at: result.retrieved_at || retrievedAt });
    }

    const intent = parseIntent(query);
    const common = { interpretation: intent.interpretation, notes: intent.notes, ignored: intent.ignored, max_results: MAX_RESULTS, retrieved_at: retrievedAt };
    if (!intent.filters) {
      return send(res, 200, { ok: true, lots: [], status: 'NEEDS_CLARIFICATION', clarification: intent.clarification, ...common });
    }
    try {
      const found = await core(intent.filters, { config });
      return send(res, 200, { ok: true, lots: found.lots.slice(0, MAX_RESULTS), status: found.lots.length ? 'CORE_RESULTS' : 'CORE_NO_MATCHES', coverage: 'CATALOGUE', ...common });
    } catch (error) {
      const code = error instanceof CoreSearchError ? error.code : 'CORE_ERROR';
      if (code === 'CORE_BUSY') { res.setHeader('Retry-After', '10'); return send(res, 503, { ok: false, code: 'BUSY' }); }
      if (code === 'CORE_TIMEOUT') return send(res, 504, { ok: false, code: 'TIMEOUT' });
      return send(res, 503, { ok: false, code: 'SERVICE_UNAVAILABLE' });
    }
  };
}

export default createAiLotSearchHandler();
