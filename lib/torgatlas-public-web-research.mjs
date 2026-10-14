import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export const RESEARCH_BUDGET = Object.freeze({
  maxLots: 10,
  maxPages: 2,
  maxHttpRequests: 12,
  maxJsonBytes: 750_000,
  timeoutMs: 4_000,
  totalTimeoutMs: 12_000,
  maxConcurrentSearches: 2,
  cacheTtlMs: 300_000,
  minQueryIntervalMs: 1_000,
  llmCalls: 0,
  llmTokens: 0
});

export const SOURCE_REGISTRY = Object.freeze([
  { id: 'gis-torgi', host: 'torgi.gov.ru', priority: 1, status: 'HISTORICAL_CONTRACT_MOCK_TESTED' },
  { id: 'efrsb', host: 'bankrot.fedresurs.ru', priority: 1, status: 'UNVERIFIED_PUBLIC_INTERFACE' },
  { id: 'mets', host: 'm-ets.ru', priority: 2, status: 'UNVERIFIED_PUBLIC_INTERFACE' },
  { id: 'rad', host: 'lot-online.ru', priority: 2, status: 'UNVERIFIED_PUBLIC_INTERFACE' }
]);

const GIS_HOST = 'torgi.gov.ru';
const GIS_SEARCH_PATH = '/new/api/public/lotcards/search';
const GIS_DETAIL_PREFIX = '/new/api/public/lotcards/';
const PFO_CODES = new Set(['02', '12', '13', '16', '18', '21', '43', '52', '56', '58', '59', '63', '64', '73']);
const cache = new Map();
const rate = new Map();
let activeResearch = 0;

export class ResearchError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ResearchError';
    this.code = code;
  }
}

export function normalizeQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').slice(0, 400);
}

export function isPrivateIp(address) {
  const ip = String(address || '').toLowerCase().split('%')[0];
  const family = isIP(ip);
  if (!family) return true;
  if (family === 6) {
    if (ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip)) return true;
    if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
    return false;
  }
  const octets = ip.split('.').map(Number);
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19));
}

export async function resolvePublicHost(hostname, lookupFn = dnsLookup) {
  if (hostname !== GIS_HOST) throw new ResearchError('SOURCE_NOT_ALLOWED');
  const rows = await lookupFn(hostname, { all: true, verbatim: true });
  if (!Array.isArray(rows) || rows.length === 0) throw new ResearchError('DNS_EMPTY');
  if (rows.some(row => isPrivateIp(row.address))) throw new ResearchError('PRIVATE_IP_DENIED');
  return rows;
}

export function allowedPublicUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== GIS_HOST) return null;
    if (url.hash) return null;
    if (url.pathname === GIS_SEARCH_PATH) {
      if ([...url.searchParams.keys()].some(key => !['page', 'size', 'sort'].includes(key))) return null;
      const page = Number(url.searchParams.get('page'));
      if (!Number.isInteger(page) || page < 0 || page >= RESEARCH_BUDGET.maxPages) return null;
      if (url.searchParams.get('size') !== '10' || url.searchParams.get('sort') !== 'firstVersionPublicationDate,desc') return null;
    } else if (!/^\/new\/api\/public\/lotcards\/[A-Za-z0-9_-]{1,160}$/.test(url.pathname) || url.search) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function gisSearchUrl(page) {
  if (!Number.isInteger(page) || page < 0 || page >= RESEARCH_BUDGET.maxPages) throw new ResearchError('PAGE_LIMIT');
  const url = new URL(`https://${GIS_HOST}${GIS_SEARCH_PATH}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('size', '10');
  url.searchParams.set('sort', 'firstVersionPublicationDate,desc');
  return url.href;
}

export function gisDetailUrl(lotId) {
  const value = String(lotId || '');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new ResearchError('INVALID_LOT_ID');
  return `https://${GIS_HOST}${GIS_DETAIL_PREFIX}${encodeURIComponent(value)}`;
}

export async function safeJsonGet(rawUrl, {
  lookupFn = dnsLookup,
  requestFn = httpsRequest,
  timeoutMs = RESEARCH_BUDGET.timeoutMs,
  maxBytes = RESEARCH_BUDGET.maxJsonBytes
} = {}) {
  const safe = allowedPublicUrl(rawUrl);
  if (!safe) throw new ResearchError('SOURCE_NOT_ALLOWED');
  const url = new URL(safe);
  const addresses = await resolvePublicHost(url.hostname, lookupFn);
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const req = requestFn({
      protocol: 'https:',
      hostname: url.hostname,
      servername: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'TorgAtlas-Public-Research/1.0' },
      timeout: timeoutMs,
      lookup(_hostname, _options, callback) {
        callback(null, selected.address, selected.family);
      }
    }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new ResearchError('REDIRECT_DENIED'));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new ResearchError(status === 401 || status === 403 || status === 429 ? 'SOURCE_BLOCKED' : 'SOURCE_HTTP_ERROR'));
        return;
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('json')) {
        response.resume();
        reject(new ResearchError('UNEXPECTED_CONTENT_TYPE'));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new ResearchError('SOURCE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new ResearchError('INVALID_SOURCE_JSON'));
        }
      });
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new ResearchError('TIMEOUT')));
    req.on('error', error => reject(error instanceof ResearchError ? error : new ResearchError('SOURCE_NETWORK_ERROR')));
    req.end();
  });
}

export function parseSimpleQuery(raw) {
  const normalized = normalizeQuery(raw);
  const isPfo = /приволж/.test(normalized) || /(?:^|\s)пфо(?:\s|$)/.test(normalized);
  const assetTerms = /полуприцеп|прицеп/.test(normalized) ? ['прицеп', 'полуприцеп'] :
    normalized.split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 4).slice(0, 6);
  return {
    normalized,
    assetTerms,
    federalDistrict: isPfo ? 'ПФО' : null,
    regionCodes: isPfo ? PFO_CODES : null
  };
}

function explicitApplicationDeadline(row) {
  for (const key of ['applicationEndDate', 'applicationEnd', 'applicationDeadline']) {
    if (typeof row?.[key] === 'string' && row[key].trim()) return { value: row[key].trim(), path: `detail.${key}` };
  }
  return { value: null, path: null };
}

export function parseGisLot(listing, detail = null, checkedAt = new Date().toISOString()) {
  const row = detail && typeof detail === 'object' ? { ...listing, ...detail } : listing;
  if (!row || typeof row.id !== 'string' || typeof row.lotName !== 'string' || !row.lotName.trim()) return null;
  const deadline = explicitApplicationDeadline(detail);
  const explicitStatus = String(detail?.applicationStatus || '');
  const accepting = deadline.value && explicitStatus === 'APPLICATIONS_SUBMISSION' ? 'CONFIRMED' : 'UNKNOWN';
  return {
    source: 'gis-torgi',
    source_lot_id: row.id,
    procedure_id: row.noticeNumber || null,
    lot_number: row.lotNumber ?? null,
    title: row.lotName.trim().slice(0, 240),
    description: typeof row.lotDescription === 'string' ? row.lotDescription.trim().slice(0, 500) : null,
    category: row.category?.name || null,
    region: null,
    region_code: row.subjectRFCode ? String(row.subjectRFCode).padStart(2, '0') : null,
    price_rub: Number.isFinite(row.priceMin) ? row.priceMin : null,
    source_status: row.lotStatus || 'UNKNOWN',
    source_bidd_end_time: typeof row.biddEndTime === 'string' ? row.biddEndTime : null,
    application_deadline: deadline.value,
    deadline: deadline.value,
    accepting_applications: accepting,
    url: `https://torgi.gov.ru/new/public/lots/lot/${encodeURIComponent(row.id)}`,
    etp_code: row.etpCode || null,
    etp_url: null,
    summary: typeof row.lotDescription === 'string' ? row.lotDescription.trim().slice(0, 300) : null,
    checked_at: checkedAt,
    provenance: {
      title: detail?.lotName ? 'detail.lotName' : 'listing.lotName',
      price_rub: detail && Number.isFinite(detail.priceMin) ? 'detail.priceMin' : 'listing.priceMin',
      source_status: detail?.lotStatus ? 'detail.lotStatus' : 'listing.lotStatus',
      source_bidd_end_time: row.biddEndTime ? (detail?.biddEndTime ? 'detail.biddEndTime' : 'listing.biddEndTime') : null,
      application_deadline: deadline.path
    }
  };
}

function matchesQuery(lot, parsed) {
  const haystack = `${lot.title} ${lot.description || ''} ${lot.category || ''}`.toLocaleLowerCase('ru-RU');
  const asset = parsed.assetTerms.length === 0 || parsed.assetTerms.some(term => haystack.includes(term));
  const region = !parsed.regionCodes || parsed.regionCodes.has(lot.region_code);
  return asset && region;
}

function dedupeLots(lots) {
  const seen = new Set();
  return lots.filter(lot => {
    const key = lot.procedure_id && lot.lot_number != null
      ? `${lot.source}:${lot.procedure_id}:${lot.lot_number}`
      : `${lot.source}:${lot.source_lot_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function emptyResearch(query, reason = 'NO_VERIFIED_SOURCE_ADAPTER', extra = {}) {
  return {
    ok: true,
    lots: [],
    status: reason === 'TIMEOUT' ? 'TIMEOUT' : 'PARTIAL_NO_VERIFIED_SOURCE',
    coverage: 'NO_SOURCE_PAGES',
    normalized_query: normalizeQuery(query),
    retrieved_at: new Date().toISOString(),
    cost: { http_requests: 0, opened_pages: 0, elapsed_ms: 0, llm_calls: 0, llm_tokens: 0 },
    reason,
    ...extra
  };
}

export async function gisMiniSearch(rawQuery, {
  requestJson = safeJsonGet,
  now = Date.now,
  cacheEnabled = true,
  rateKey = null,
  limit = RESEARCH_BUDGET.maxLots
} = {}) {
  const parsed = parseSimpleQuery(rawQuery);
  const key = parsed.normalized;
  const safeLimit = Math.min(RESEARCH_BUDGET.maxLots, Math.max(1, Number(limit) || RESEARCH_BUDGET.maxLots));
  const cacheKey = `${key}|${safeLimit}`;
  const started = now();
  if (cacheEnabled) {
    const hit = cache.get(cacheKey);
    if (hit && started - hit.at < RESEARCH_BUDGET.cacheTtlMs) {
      return { ...hit.value, cost: { ...hit.value.cost, cache_hit: true } };
    }
  }
  const limiterKey = rateKey || key;
  const previous = rate.get(limiterKey) || 0;
  if (previous && started - previous < RESEARCH_BUDGET.minQueryIntervalMs) {
    return emptyResearch(rawQuery, 'RATE_LIMITED');
  }
  rate.set(limiterKey, started);
  if (activeResearch >= RESEARCH_BUDGET.maxConcurrentSearches) return emptyResearch(rawQuery, 'BUSY');
  activeResearch += 1;

  const candidates = [];
  let httpRequests = 0;
  let scannedPages = 0;
  let reachedLastPage = false;
  let budgetExhausted = false;
  try {
    for (let page = 0; page < RESEARCH_BUDGET.maxPages; page += 1) {
      if (now() - started >= RESEARCH_BUDGET.totalTimeoutMs) { budgetExhausted = true; break; }
      const payload = await requestJson(gisSearchUrl(page));
      httpRequests += 1;
      scannedPages += 1;
      if (!payload || !Array.isArray(payload.content)) throw new ResearchError('INVALID_SOURCE_SHAPE');
      for (const row of payload.content) {
        const lot = parseGisLot(row);
        if (lot && matchesQuery(lot, parsed)) candidates.push({ listing: row, lot });
      }
      reachedLastPage = payload.last === true;
      if (reachedLastPage || candidates.length >= RESEARCH_BUDGET.maxLots) break;
    }

    const enriched = [];
    for (const candidate of candidates.slice(0, safeLimit)) {
      if (httpRequests >= RESEARCH_BUDGET.maxHttpRequests || now() - started >= RESEARCH_BUDGET.totalTimeoutMs) { budgetExhausted = true; break; }
      let detail = null;
      try {
        detail = await requestJson(gisDetailUrl(candidate.lot.source_lot_id));
        httpRequests += 1;
      } catch {
        httpRequests += 1;
      }
      const lot = parseGisLot(candidate.listing, detail);
      if (lot) enriched.push(lot);
    }
    const lots = dedupeLots(enriched);
    const coverage = budgetExhausted ? 'PARTIAL_BUDGET' : reachedLastPage ? 'SCANNED_AVAILABLE_PAGES' : (scannedPages === 1 ? 'FIRST_PAGE_ONLY' : 'PARTIAL_COVERAGE');
    const value = {
      ok: true,
      lots,
      status: lots.length ? 'PRELIMINARY_SOURCE_DATA' : 'NO_MATCHES_IN_SCANNED_PAGES',
      coverage,
      coverage_note: 'Локальная фильтрация ограниченного числа последних страниц; результат не доказывает отсутствие лотов во всём источнике.',
      normalized_query: key,
      retrieved_at: new Date().toISOString(),
      cost: {
        http_requests: httpRequests,
        opened_pages: scannedPages + enriched.length,
        elapsed_ms: Math.max(0, now() - started),
        llm_calls: 0,
        llm_tokens: 0
      }
    };
    if (cacheEnabled) cache.set(cacheKey, { at: started, value });
    return value;
  } catch (error) {
    const reason = error?.code || (error?.name === 'AbortError' ? 'TIMEOUT' : 'SOURCE_BLOCKED');
    return emptyResearch(rawQuery, reason, {
      coverage: scannedPages ? 'PARTIAL_COVERAGE' : 'NO_SOURCE_PAGES',
      cost: {
        http_requests: httpRequests,
        opened_pages: scannedPages,
        elapsed_ms: Math.max(0, now() - started),
        llm_calls: 0,
        llm_tokens: 0
      }
    });
  } finally {
    activeResearch -= 1;
  }
}
