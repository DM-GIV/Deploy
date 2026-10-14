import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export const RESEARCH_BUDGET = Object.freeze({
  maxLots: 10,
  maxPages: 2,
  maxHttpRequests: 12,
  maxJsonBytes: 750_000,
  maxHtmlBytes: 1_500_000,
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
  { id: 'efrsb', host: 'fedresurs.ru', priority: 1, status: 'HISTORICAL_CONTRACT_MOCK_TESTED' },
  { id: 'mets', host: 'm-ets.ru', priority: 2, status: 'HISTORICAL_BOUNDED_FEED_CONTRACT' },
  { id: 'rad', host: 'catalog.lot-online.ru', priority: 2, status: 'EXACT_DETAIL_ONLY_NO_DISCOVERY' }
]);

const GIS_HOST = 'torgi.gov.ru';
const GIS_SEARCH_PATH = '/new/api/public/lotcards/search';
const GIS_DETAIL_PREFIX = '/new/api/public/lotcards/';
const EFRSB_HOST = 'fedresurs.ru';
const EFRSB_LIST_PATH = '/backend/biddings';
const EFRSB_DETAIL_PREFIX = '/backend/biddings/';
const EFRSB_MESSAGE_PREFIX = '/backend/bankruptcy-messages/';
const METS_HOST = 'm-ets.ru';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_HOSTS = new Set([GIS_HOST, EFRSB_HOST, METS_HOST]);
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
  if (!ALLOWED_HOSTS.has(hostname)) throw new ResearchError('SOURCE_NOT_ALLOWED');
  const rows = await lookupFn(hostname, { all: true, verbatim: true });
  if (!Array.isArray(rows) || rows.length === 0) throw new ResearchError('DNS_EMPTY');
  if (rows.some(row => isPrivateIp(row.address))) throw new ResearchError('PRIVATE_IP_DENIED');
  return rows;
}

export function allowedPublicUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !ALLOWED_HOSTS.has(url.hostname)) return null;
    if (url.hash) return null;
    if (url.hostname === GIS_HOST && url.pathname === GIS_SEARCH_PATH) {
      if ([...url.searchParams.keys()].some(key => !['page', 'size', 'sort'].includes(key))) return null;
      const page = Number(url.searchParams.get('page'));
      if (!Number.isInteger(page) || page < 0 || page >= RESEARCH_BUDGET.maxPages) return null;
      if (url.searchParams.get('size') !== '10' || url.searchParams.get('sort') !== 'firstVersionPublicationDate,desc') return null;
    } else if (url.hostname === GIS_HOST && (/^\/new\/api\/public\/lotcards\/[A-Za-z0-9_-]{1,160}$/.test(url.pathname) && !url.search)) {
      // Exact public GIS detail route.
    } else if (url.hostname === EFRSB_HOST && url.pathname === EFRSB_LIST_PATH) {
      if ([...url.searchParams.keys()].some(key => !['limit', 'offset'].includes(key))) return null;
      if (url.searchParams.get('limit') !== '5' || !['0', '5'].includes(url.searchParams.get('offset'))) return null;
    } else if (url.hostname === EFRSB_HOST && !url.search && (
      UUID_RE.test(url.pathname.slice(EFRSB_DETAIL_PREFIX.length)) && url.pathname.startsWith(EFRSB_DETAIL_PREFIX) ||
      UUID_RE.test(url.pathname.slice(EFRSB_MESSAGE_PREFIX.length)) && url.pathname.startsWith(EFRSB_MESSAGE_PREFIX)
    )) {
      // Exact public EFRSB detail/message routes.
    } else if (url.hostname === METS_HOST && !url.search && (url.pathname === '/' || /^\/\d{1,12}-\d{1,6}$/.test(url.pathname))) {
      // MЭТС exposes a bounded event feed and exact public cards; search/catalog are intentionally excluded.
    } else {
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

export function efrsbSearchUrl(offset = 0) {
  if (![0, 5].includes(offset)) throw new ResearchError('PAGE_LIMIT');
  const url = new URL(`https://${EFRSB_HOST}${EFRSB_LIST_PATH}`);
  url.searchParams.set('limit', '5');
  url.searchParams.set('offset', String(offset));
  return url.href;
}

function assertGuid(guid) {
  const value = String(guid || '');
  if (!UUID_RE.test(value)) throw new ResearchError('INVALID_SOURCE_ID');
  return value.toLowerCase();
}

export function efrsbDetailUrl(guid) {
  return `https://${EFRSB_HOST}${EFRSB_DETAIL_PREFIX}${assertGuid(guid)}`;
}

export function efrsbMessageUrl(guid) {
  return `https://${EFRSB_HOST}${EFRSB_MESSAGE_PREFIX}${assertGuid(guid)}`;
}

export function metsFeedUrl() {
  return `https://${METS_HOST}/`;
}

export function metsDetailUrl(tradeNumber, lotNumber) {
  const trade = String(tradeNumber || '');
  const lot = String(lotNumber || '');
  if (!/^\d{1,12}$/.test(trade) || !/^\d{1,6}$/.test(lot)) throw new ResearchError('INVALID_SOURCE_ID');
  return `https://${METS_HOST}/${trade}-${lot}`;
}

export async function safePublicGet(rawUrl, {
  lookupFn = dnsLookup,
  requestFn = httpsRequest,
  timeoutMs = RESEARCH_BUDGET.timeoutMs,
  maxBytes = RESEARCH_BUDGET.maxJsonBytes,
  expectedType = 'json'
} = {}) {
  const safe = allowedPublicUrl(rawUrl);
  if (!safe) throw new ResearchError('SOURCE_NOT_ALLOWED');
  const url = new URL(safe);
  let addresses;
  try {
    addresses = await resolvePublicHost(url.hostname, lookupFn);
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError('SOURCE_NETWORK_ERROR');
  }
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
      if (expectedType === 'json' && !contentType.includes('json')) {
        response.resume();
        reject(new ResearchError('UNEXPECTED_CONTENT_TYPE'));
        return;
      }
      if (expectedType === 'html' && !contentType.includes('html')) {
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
          const body = Buffer.concat(chunks).toString('utf8');
          resolve(expectedType === 'json' ? JSON.parse(body) : body);
        } catch {
          reject(new ResearchError(expectedType === 'json' ? 'INVALID_SOURCE_JSON' : 'INVALID_SOURCE_HTML'));
        }
      });
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new ResearchError('TIMEOUT')));
    req.on('error', error => reject(error instanceof ResearchError ? error : new ResearchError('SOURCE_NETWORK_ERROR')));
    req.end();
  });
}

export function safeJsonGet(rawUrl, options = {}) {
  return safePublicGet(rawUrl, { ...options, expectedType: 'json' });
}

export function safeHtmlGet(rawUrl, options = {}) {
  return safePublicGet(rawUrl, { ...options, expectedType: 'html', maxBytes: options.maxBytes || RESEARCH_BUDGET.maxHtmlBytes });
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

function walkObjects(value, visit, depth = 0) {
  if (depth > 10 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 500)) walkObjects(item, visit, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') walkObjects(child, visit, depth + 1);
  }
}

function objectGuid(value) {
  let found = null;
  walkObjects(value, row => {
    if (found) return;
    for (const key of ['guid', 'biddingGuid', 'objectGuid', 'tradeGuid', 'auctionGuid', 'id']) {
      if (UUID_RE.test(String(row[key] || ''))) { found = String(row[key]).toLowerCase(); break; }
    }
  });
  return found;
}

function pageItems(payload) {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === 'object');
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['pageData', 'data', 'items', 'results', 'content', 'biddings', 'rows', 'records', 'list']) {
    if (Array.isArray(payload[key])) return payload[key].filter(item => item && typeof item === 'object');
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = pageItems(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function firstScalar(value, keys) {
  let found = null;
  const wanted = new Set(keys.map(key => key.toLocaleLowerCase('en-US')));
  walkObjects(value, row => {
    if (found != null) return;
    for (const [key, candidate] of Object.entries(row)) {
      if (!wanted.has(key.toLocaleLowerCase('en-US'))) continue;
      if (typeof candidate === 'string' || typeof candidate === 'number') {
        const text = String(candidate).trim();
        if (text) { found = candidate; break; }
      }
    }
  });
  return found;
}

function namedValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.name || value.title || value.displayName || value.value || value.code || '').trim();
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function efrsbStatus(value) {
  let found = '';
  walkObjects(value, row => {
    if (found) return;
    for (const key of ['status', 'state', 'biddingStatus']) {
      if (row[key] != null) {
        found = namedValue(row[key]);
        if (found) break;
      }
    }
  });
  return found;
}

function efrsbApplicationWindow(detail) {
  const application = detail?.application;
  if (application && typeof application === 'object' && !Array.isArray(application)) {
    const start = typeof application.start === 'string' ? application.start.trim() : null;
    const end = typeof application.end === 'string' ? application.end.trim() : null;
    return { start: start || null, end: end || null, startPath: start ? 'detail.application.start' : null, endPath: end ? 'detail.application.end' : null };
  }
  return { start: null, end: null, startPath: null, endPath: null };
}

function messageGuids(detail) {
  const found = [];
  walkObjects(detail, row => {
    for (const [key, value] of Object.entries(row)) {
      if (!key.toLocaleLowerCase('en-US').includes('messageguid')) continue;
      for (const candidate of Array.isArray(value) ? value : [value]) {
        const guid = String(candidate || '').toLowerCase();
        if (UUID_RE.test(guid) && !found.includes(guid)) found.push(guid);
      }
    }
  });
  return found.slice(0, 2);
}

function efrsbLotRows(payload) {
  const rows = [];
  walkObjects(payload, row => {
    const description = row.description ?? row.lotDescription ?? row.subject ?? row.title;
    const hasLotMarker = row.order != null || row.lotNumber != null || row.startPrice != null || row.initialPrice != null;
    if (typeof description === 'string' && description.trim() && hasLotMarker && !rows.includes(row)) rows.push(row);
  });
  return rows.slice(0, 50);
}

const PFO_REGION_NAMES = [
  ['башкортостан', '02'], ['марий эл', '12'], ['мордов', '13'], ['татарстан', '16'], ['удмурт', '18'],
  ['чуваш', '21'], ['кировск', '43'], ['нижегород', '52'], ['оренбург', '56'], ['пензен', '58'],
  ['пермск', '59'], ['самарск', '63'], ['саратовск', '64'], ['ульяновск', '73']
];

function inferPfoRegion(text) {
  const normalized = String(text || '').toLocaleLowerCase('ru-RU');
  const match = PFO_REGION_NAMES.find(([needle]) => normalized.includes(needle));
  return match ? match[1] : null;
}

function finiteMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function efrsbCategory(row) {
  const collection = row.classifierCollection;
  if (Array.isArray(collection)) {
    const name = collection.map(namedValue).find(Boolean);
    if (name) return name;
  }
  return namedValue(row.category || row.classifier) || null;
}

export function parseEfrsbLots(catalog, detail, messages = [], checkedAt = new Date().toISOString(), nowMs = Date.now()) {
  const biddingGuid = objectGuid(catalog) || objectGuid(detail);
  if (!biddingGuid) return [];
  const procedureNumber = firstScalar(detail, ['number', 'biddingNumber', 'tradeNumber']) || firstScalar(catalog, ['number', 'biddingNumber', 'tradeNumber']);
  const window = efrsbApplicationWindow(detail);
  const startMs = window.start ? Date.parse(window.start) : Number.NaN;
  const endMs = window.end ? Date.parse(window.end) : Number.NaN;
  const status = efrsbStatus(detail) || efrsbStatus(catalog) || 'UNKNOWN';
  const terminal = /заверш|отмен|аннулир|не состоя|результат/i.test(status);
  const inDateWindow = Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= nowMs && nowMs < endMs && !terminal;
  const sourcePayloads = [
    ...messages,
    { guid: null, payload: detail, url: efrsbDetailUrl(biddingGuid) }
  ];
  const lots = [];
  for (const message of sourcePayloads) {
    for (const [index, row] of efrsbLotRows(message.payload).entries()) {
      const description = String(row.description ?? row.lotDescription ?? row.subject ?? row.title).trim();
      const lotNumber = String(row.order ?? row.lotNumber ?? index + 1);
      const regionCode = inferPfoRegion(description);
      lots.push({
        source: 'efrsb',
        source_lot_id: `${biddingGuid}:${lotNumber}`,
        procedure_id: biddingGuid,
        procedure_number: procedureNumber ? String(procedureNumber) : null,
        lot_number: lotNumber,
        title: description.slice(0, 240),
        description: description.slice(0, 500),
        category: efrsbCategory(row),
        region: null,
        region_code: regionCode,
        price_rub: finiteMoney(row.startPrice ?? row.initialPrice ?? row.price),
        source_status: status,
        source_bidd_end_time: null,
        application_start: window.start,
        application_deadline: window.end,
        deadline: window.end,
        accepting_applications: inDateWindow ? 'CONFIRMED_BY_PUBLICATION_DATES' : 'UNKNOWN',
        url: `https://${EFRSB_HOST}/biddings/${biddingGuid}`,
        etp_code: null,
        etp_url: null,
        summary: description.slice(0, 300),
        checked_at: checkedAt,
        provenance: {
          title: message.guid ? `bankruptcy-message:${message.guid}:lot` : 'bidding-detail:lot',
          price_rub: row.startPrice != null ? 'lot.startPrice' : row.initialPrice != null ? 'lot.initialPrice' : null,
          source_status: status !== 'UNKNOWN' ? 'bidding-detail.status' : null,
          application_start: window.startPath,
          application_deadline: window.endPath
        }
      });
    }
  }
  return lots;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&lt;|&#60;/gi, '<')
    .replace(/&gt;|&#62;/gi, '>')
    .replace(/&#8381;|&#x20bd;/gi, '₽')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlAttribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeHtml(match[2]) : null;
}

export function parseMetsFeed(html) {
  const targets = [];
  for (const tag of String(html || '').match(/<a\b[^>]*>/gi) || []) {
    const classes = htmlAttribute(tag, 'class') || '';
    if (!/(?:^|\s)lenta-item(?:\s|$)/.test(classes)) continue;
    const href = htmlAttribute(tag, 'href') || '';
    const match = href.match(/^\/(\d{1,12})-(\d{1,6})$/);
    if (!match) continue;
    const key = `${match[1]}:${match[2]}`;
    if (!targets.some(target => target.key === key)) {
      targets.push({ key, trade_number: match[1], lot_number: match[2], url: metsDetailUrl(match[1], match[2]) });
    }
  }
  return targets.slice(0, 20);
}

function jsonHtmlAttribute(tag, name) {
  const raw = htmlAttribute(tag, name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function firstTaggedText(block, pattern) {
  const match = String(block || '').match(pattern);
  return match ? decodeHtml(match[1]) : null;
}

export function parseMetsDetail(html, target, checkedAt = new Date().toISOString()) {
  const trade = String(target?.trade_number || '');
  const lotNumber = String(target?.lot_number || '');
  if (!/^\d{1,12}$/.test(trade) || !/^\d{1,6}$/.test(lotNumber)) return null;
  const chunks = String(html || '').split(/(?=<div\b[^>]*class=["'][^"']*\bgeneralview-container\b)/i).slice(1);
  const block = chunks.find(chunk => {
    const opening = chunk.match(/^<div\b[^>]*>/i)?.[0] || '';
    return htmlAttribute(opening, 'data-lotNumber') === lotNumber;
  });
  if (!block) return null;
  const opening = block.match(/^<div\b[^>]*>/i)?.[0] || '';
  const lotId = htmlAttribute(opening, 'data-lotId');
  if (!/^\d{1,20}$/.test(lotId || '')) return null;
  const skuTags = block.match(/<meta\b[^>]*>/gi) || [];
  const sku = skuTags.map(tag => htmlAttribute(tag, 'itemprop') === 'sku' ? htmlAttribute(tag, 'content') : null).find(Boolean);
  if (sku && !new RegExp(`^${trade}-МЭТС-${lotNumber}$`, 'i').test(sku)) return null;
  const title = firstTaggedText(block, /<h2\b[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h2>/i);
  if (!title) return null;
  const description = firstTaggedText(block, /<[^>]+itemprop=["']description["'][^>]*>([\s\S]*?)<\//i);
  const priceTag = skuTags.find(tag => htmlAttribute(tag, 'itemprop') === 'price');
  const price = finiteMoney(htmlAttribute(priceTag, 'content'));
  const regionData = jsonHtmlAttribute(opening, 'data-region');
  const categoryData = jsonHtmlAttribute(opening, 'data-categories');
  const status = firstTaggedText(block, /<div\b[^>]*class=["'][^"']*\blot-status-name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || 'UNKNOWN';
  const applicationStart = firstTaggedText(block, /Начало приема заявок:\s*<\/div>\s*<div\b[^>]*class=["'][^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const applicationEnd = firstTaggedText(block, /Окончание приема заявок[^<]*<\/div>\s*<div\b[^>]*class=["'][^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const accepting = /торги в стадии приема заявок|при[её]м заявок открыт/i.test(status)
    ? 'CONFIRMED_BY_SOURCE_STATUS'
    : 'UNKNOWN';
  return {
    source: 'mets',
    source_lot_id: lotId,
    procedure_id: trade,
    procedure_number: trade,
    lot_number: lotNumber,
    title: title.slice(0, 240),
    description: description ? description.slice(0, 500) : null,
    category: Array.isArray(categoryData) ? namedValue(categoryData[0]) || null : null,
    region: namedValue(regionData) || null,
    region_code: inferPfoRegion(namedValue(regionData) || description || title),
    price_rub: price,
    source_status: status,
    source_bidd_end_time: null,
    application_start: applicationStart,
    application_deadline: applicationEnd,
    deadline: applicationEnd,
    accepting_applications: accepting,
    url: metsDetailUrl(trade, lotNumber),
    etp_code: 'METS',
    etp_url: metsDetailUrl(trade, lotNumber),
    summary: (description || title).slice(0, 300),
    checked_at: checkedAt,
    provenance: {
      title: 'detail:itemprop=name',
      price_rub: price != null ? 'detail:itemprop=price' : null,
      source_status: status !== 'UNKNOWN' ? 'detail:.lot-status-name' : null,
      application_start: applicationStart ? 'detail:Начало приема заявок' : null,
      application_deadline: applicationEnd ? 'detail:Окончание приема заявок' : null
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
  const cacheKey = `gis|${key}|${safeLimit}`;
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

export async function efrsbMiniSearch(rawQuery, {
  requestJson = safeJsonGet,
  now = Date.now,
  cacheEnabled = true,
  rateKey = null,
  limit = RESEARCH_BUDGET.maxLots
} = {}) {
  const parsed = parseSimpleQuery(rawQuery);
  const key = parsed.normalized;
  const safeLimit = Math.min(RESEARCH_BUDGET.maxLots, Math.max(1, Number(limit) || RESEARCH_BUDGET.maxLots));
  const cacheKey = `efrsb|${key}|${safeLimit}`;
  const started = now();
  if (cacheEnabled) {
    const hit = cache.get(cacheKey);
    if (hit && started - hit.at < RESEARCH_BUDGET.cacheTtlMs) {
      return { ...hit.value, cost: { ...hit.value.cost, cache_hit: true } };
    }
  }
  const limiterKey = `efrsb:${rateKey || key}`;
  const previous = rate.get(limiterKey) || 0;
  if (previous && started - previous < RESEARCH_BUDGET.minQueryIntervalMs) return emptyResearch(rawQuery, 'RATE_LIMITED');
  rate.set(limiterKey, started);
  if (activeResearch >= RESEARCH_BUDGET.maxConcurrentSearches) return emptyResearch(rawQuery, 'BUSY');
  activeResearch += 1;

  let httpRequests = 0;
  let scannedPages = 0;
  let budgetExhausted = false;
  let reachedLastPage = false;
  const catalogs = [];
  const lots = [];
  try {
    for (const offset of [0, 5]) {
      if (now() - started >= RESEARCH_BUDGET.totalTimeoutMs) { budgetExhausted = true; break; }
      httpRequests += 1;
      const payload = await requestJson(efrsbSearchUrl(offset));
      scannedPages += 1;
      const items = pageItems(payload);
      for (const item of items) {
        const guid = objectGuid(item);
        if (guid && !catalogs.some(entry => entry.guid === guid)) catalogs.push({ guid, item });
      }
      if (items.length < 5) { reachedLastPage = true; break; }
    }

    // Five procedure details plus their first linked public message fit with two list pages
    // into the global twelve-request budget. This is intentionally not bulk ingestion.
    for (const catalog of catalogs.slice(0, 5)) {
      if (httpRequests >= RESEARCH_BUDGET.maxHttpRequests || now() - started >= RESEARCH_BUDGET.totalTimeoutMs) { budgetExhausted = true; break; }
      let detail;
      try {
        httpRequests += 1;
        detail = await requestJson(efrsbDetailUrl(catalog.guid));
      } catch {
        continue;
      }
      const linked = [];
      const messageGuid = messageGuids(detail)[0];
      if (messageGuid && httpRequests < RESEARCH_BUDGET.maxHttpRequests && now() - started < RESEARCH_BUDGET.totalTimeoutMs) {
        try {
          httpRequests += 1;
          linked.push({ guid: messageGuid, payload: await requestJson(efrsbMessageUrl(messageGuid)), url: efrsbMessageUrl(messageGuid) });
        } catch {
          // A bidding detail may still contain a real lot projection; never manufacture one.
        }
      }
      const parsedLots = parseEfrsbLots(catalog.item, detail, linked, new Date().toISOString(), now());
      for (const lot of parsedLots) if (matchesQuery(lot, parsed)) lots.push(lot);
      if (lots.length >= safeLimit) break;
    }

    const selected = dedupeLots(lots).slice(0, safeLimit);
    const catalogLimited = catalogs.length > 5;
    const coverage = budgetExhausted ? 'PARTIAL_BUDGET' : reachedLastPage && !catalogLimited ? 'SCANNED_AVAILABLE_PAGES' : (scannedPages === 1 ? 'FIRST_PAGE_ONLY' : 'PARTIAL_COVERAGE');
    const value = {
      ok: true,
      lots: selected,
      status: selected.length ? 'PRELIMINARY_SOURCE_DATA' : 'NO_MATCHES_IN_SCANNED_PAGES',
      coverage,
      coverage_note: 'Проверены только последние публичные записи и не более пяти процедур; результат не доказывает отсутствие лотов во всём ЕФРСБ.',
      normalized_query: key,
      retrieved_at: new Date().toISOString(),
      cost: {
        http_requests: httpRequests,
        opened_pages: scannedPages + Math.min(catalogs.length, 5),
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
      cost: { http_requests: httpRequests, opened_pages: scannedPages, elapsed_ms: Math.max(0, now() - started), llm_calls: 0, llm_tokens: 0 }
    });
  } finally {
    activeResearch -= 1;
  }
}

export async function metsMiniSearch(rawQuery, {
  requestHtml = safeHtmlGet,
  now = Date.now,
  cacheEnabled = true,
  rateKey = null,
  limit = RESEARCH_BUDGET.maxLots
} = {}) {
  const parsed = parseSimpleQuery(rawQuery);
  const key = parsed.normalized;
  const safeLimit = Math.min(RESEARCH_BUDGET.maxLots, Math.max(1, Number(limit) || RESEARCH_BUDGET.maxLots));
  const cacheKey = `mets|${key}|${safeLimit}`;
  const started = now();
  if (cacheEnabled) {
    const hit = cache.get(cacheKey);
    if (hit && started - hit.at < RESEARCH_BUDGET.cacheTtlMs) return { ...hit.value, cost: { ...hit.value.cost, cache_hit: true } };
  }
  const limiterKey = `mets:${rateKey || key}`;
  const previous = rate.get(limiterKey) || 0;
  if (previous && started - previous < RESEARCH_BUDGET.minQueryIntervalMs) return emptyResearch(rawQuery, 'RATE_LIMITED');
  rate.set(limiterKey, started);
  if (activeResearch >= RESEARCH_BUDGET.maxConcurrentSearches) return emptyResearch(rawQuery, 'BUSY');
  activeResearch += 1;
  let httpRequests = 0;
  let openedPages = 0;
  let budgetExhausted = false;
  try {
    httpRequests += 1;
    const feed = await requestHtml(metsFeedUrl());
    openedPages += 1;
    const targets = parseMetsFeed(feed);
    const lots = [];
    for (const target of targets.slice(0, 6)) {
      if (httpRequests >= RESEARCH_BUDGET.maxHttpRequests || now() - started >= RESEARCH_BUDGET.totalTimeoutMs) { budgetExhausted = true; break; }
      try {
        httpRequests += 1;
        const html = await requestHtml(target.url);
        openedPages += 1;
        const lot = parseMetsDetail(html, target);
        if (lot && matchesQuery(lot, parsed)) lots.push(lot);
      } catch {
        // Individual event cards may expire, redirect or be blocked; continue inside the bounded feed window.
      }
      if (lots.length >= safeLimit) break;
    }
    const selected = dedupeLots(lots).slice(0, safeLimit);
    const value = {
      ok: true,
      lots: selected,
      status: selected.length ? 'PRELIMINARY_SOURCE_DATA' : 'NO_MATCHES_IN_SCANNED_PAGES',
      coverage: budgetExhausted ? 'PARTIAL_BUDGET' : 'BOUNDED_EVENT_FEED',
      coverage_note: 'МЭТС проверяется только по ограниченной ленте недавних событий и максимум шести карточкам; это не поиск по полному каталогу.',
      normalized_query: key,
      retrieved_at: new Date().toISOString(),
      cost: { http_requests: httpRequests, opened_pages: openedPages, elapsed_ms: Math.max(0, now() - started), llm_calls: 0, llm_tokens: 0 }
    };
    if (cacheEnabled) cache.set(cacheKey, { at: started, value });
    return value;
  } catch (error) {
    return emptyResearch(rawQuery, error?.code || 'SOURCE_BLOCKED', {
      coverage: openedPages ? 'BOUNDED_EVENT_FEED' : 'NO_SOURCE_PAGES',
      cost: { http_requests: httpRequests, opened_pages: openedPages, elapsed_ms: Math.max(0, now() - started), llm_calls: 0, llm_tokens: 0 }
    });
  } finally {
    activeResearch -= 1;
  }
}

export async function publicResearchMiniSearch(rawQuery, {
  source = 'all',
  ...options
} = {}) {
  if (source === 'government') return gisMiniSearch(rawQuery, options);
  if (source === 'bankruptcy') return efrsbMiniSearch(rawQuery, options);
  if (source === 'commercial') return metsMiniSearch(rawQuery, options);
  const normalized = normalizeQuery(rawQuery);
  const selected = /банкрот|ефрсб|публичн(?:ое|ого) предлож/.test(normalized) ? 'efrsb' : 'gis-torgi';
  const result = selected === 'efrsb'
    ? await efrsbMiniSearch(rawQuery, options)
    : await gisMiniSearch(rawQuery, options);
  return {
    ...result,
    planned_sources: [selected],
    unsearched_sources: selected === 'efrsb' ? ['gis-torgi', 'mets', 'rad'] : ['efrsb', 'mets', 'rad'],
    coverage_note: `${result.coverage_note || ''} Планировщик выбрал один источник в пределах бюджета; режим «Все» пока не означает полный обход всех площадок.`.trim()
  };
}
