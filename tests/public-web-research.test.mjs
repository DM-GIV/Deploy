import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import {
  allowedPublicUrl,
  efrsbDetailUrl,
  efrsbMessageUrl,
  efrsbMiniSearch,
  efrsbSearchUrl,
  gisDetailUrl,
  gisMiniSearch,
  gisSearchUrl,
  isPrivateIp,
  metsDetailUrl,
  metsFeedUrl,
  metsMiniSearch,
  parseEfrsbLots,
  parseGisLot,
  parseMetsDetail,
  parseMetsFeed,
  parseSimpleQuery,
  ResearchError,
  RESEARCH_BUDGET,
  resolvePublicHost,
  safeJsonGet
  , parseUtplCatalog
  , parseUtplDetail
  , utplCatalogUrl
  , utplDetailUrl
  , utplMiniSearch
} from '../lib/torgatlas-public-web-research.mjs';

const efrsbList = JSON.parse(fs.readFileSync('tests/fixtures/efrsb-list.test-only.json', 'utf8'));
const efrsbDetail = JSON.parse(fs.readFileSync('tests/fixtures/efrsb-detail.test-only.json', 'utf8'));
const efrsbMessage = JSON.parse(fs.readFileSync('tests/fixtures/efrsb-message.test-only.json', 'utf8'));
const metsFeed = fs.readFileSync('tests/fixtures/mets-feed.test-only.html', 'utf8');
const metsDetail = fs.readFileSync('tests/fixtures/mets-detail.test-only.html', 'utf8');
const utplCatalog = fs.readFileSync('tests/fixtures/utpl-catalog.test-only.html', 'utf8');
const utplDetail = fs.readFileSync('tests/fixtures/utpl-detail.test-only.html', 'utf8');

const listing = {
  id: '21000000000000000001_1',
  noticeNumber: '21000000000000000001',
  lotNumber: 1,
  lotName: 'Прицеп автомобильный TEST_ONLY',
  lotDescription: 'Тестовая карточка из локального fixture',
  priceMin: 125000,
  lotStatus: 'PUBLISHED',
  biddEndTime: '2026-12-01T00:00:00Z',
  category: { name: 'Прицепы и полуприцепы' },
  subjectRFCode: '52',
  etpCode: 'TEST_ETP'
};

test('listing biddEndTime is not treated as application deadline or open applications', () => {
  const lot = parseGisLot(listing, null, '2026-10-14T00:00:00Z');
  assert.equal(lot.source_bidd_end_time, listing.biddEndTime);
  assert.equal(lot.application_deadline, null);
  assert.equal(lot.accepting_applications, 'UNKNOWN');
  assert.equal(lot.source_status, 'PUBLISHED');
});

test('detail confirms applications only with explicit status and explicit deadline', () => {
  const lot = parseGisLot(listing, {
    ...listing,
    applicationStatus: 'APPLICATIONS_SUBMISSION',
    applicationEndDate: '2026-11-20T10:00:00Z'
  });
  assert.equal(lot.application_deadline, '2026-11-20T10:00:00Z');
  assert.equal(lot.accepting_applications, 'CONFIRMED');
  assert.equal(lot.provenance.application_deadline, 'detail.applicationEndDate');
});

test('bounded search reads listing and fixed detail, filters PFO and reports coverage', async () => {
  const requested = [];
  const requestJson = async url => {
    requested.push(url);
    if (url.includes('/lotcards/21000000000000000001_1')) return { ...listing };
    if (url.includes('page=0')) return { content: [listing, { ...listing, id: 'x_2', lotName: 'Катер', subjectRFCode: '41' }], last: false };
    return { content: [], last: true };
  };
  const result = await gisMiniSearch('Найди прицепы в Приволжском федеральном округе', {
    requestJson, cacheEnabled: false, rateKey: 'pfo-test', now: () => 10_000
  });
  assert.equal(result.lots.length, 1);
  assert.equal(result.lots[0].region_code, '52');
  assert.equal(result.coverage, 'SCANNED_AVAILABLE_PAGES');
  assert.equal(result.cost.http_requests, 3);
  assert.equal(result.cost.llm_tokens, 0);
  assert.match(requested[2], /\/new\/api\/public\/lotcards\/21000000000000000001_1$/);
});

test('empty bounded window never claims whole-source absence', async () => {
  const result = await gisMiniSearch('прицепы в ПФО', {
    requestJson: async () => ({ content: [], last: false }),
    cacheEnabled: false,
    rateKey: 'empty-test',
    now: () => 20_000
  });
  assert.equal(result.status, 'NO_MATCHES_IN_SCANNED_PAGES');
  assert.equal(result.coverage, 'PARTIAL_COVERAGE');
  assert.match(result.coverage_note, /не доказывает отсутствие/);
});

test('detail failure preserves listing fields and UNKNOWN application state', async () => {
  const result = await gisMiniSearch('прицеп', {
    requestJson: async url => {
      if (url.includes('/lotcards/21000000000000000001_1')) throw new Error('blocked');
      return { content: [listing], last: true };
    },
    cacheEnabled: false,
    rateKey: 'detail-failure',
    now: () => 30_000
  });
  assert.equal(result.lots.length, 1);
  assert.equal(result.lots[0].accepting_applications, 'UNKNOWN');
});

test('source failure is explicit and contains no fixture lots', async () => {
  const result = await gisMiniSearch('прицеп', {
    requestJson: async () => { const error = new Error('denied'); error.code = 'SOURCE_BLOCKED'; throw error; },
    cacheEnabled: false,
    rateKey: 'blocked-test',
    now: () => 40_000
  });
  assert.equal(result.reason, 'SOURCE_BLOCKED');
  assert.deepEqual(result.lots, []);
});

test('query parser handles trailer synonym and PFO deterministically', () => {
  const parsed = parseSimpleQuery('Найди полуприцепы в ПФО');
  assert.ok(parsed.assetTerms.includes('полуприцеп'));
  assert.ok(parsed.regionCodes.has('52'));
});

test('region parser distinguishes Moscow region and recognises Tyumen city', () => {
  assert.ok(parseSimpleQuery('недвижимость в Московской области').regionCodes.has('50'));
  assert.ok(parseSimpleQuery('помещение в Тюмени').regionCodes.has('72'));
});

test('process-local abuse controls have hard memory caps', () => {
  assert.equal(RESEARCH_BUDGET.maxCacheEntries, 500);
  assert.equal(RESEARCH_BUDGET.maxRateEntries, 5000);
  assert.equal(RESEARCH_BUDGET.maxConcurrentSearches, 2);
  assert.equal(RESEARCH_BUDGET.llmTokens, 0);
});

test('fixed GIS URLs and SSRF rules reject arbitrary input', async () => {
  assert.match(gisSearchUrl(0), /^https:\/\/torgi\.gov\.ru\/new\/api\/public\/lotcards\/search\?/);
  assert.match(gisDetailUrl('notice_1'), /\/lotcards\/notice_1$/);
  assert.throws(() => gisDetailUrl('../admin'), /INVALID_LOT_ID/);
  assert.equal(allowedPublicUrl('https://localhost/x'), null);
  assert.equal(allowedPublicUrl('http://torgi.gov.ru/new/api/public/lotcards/search'), null);
  assert.equal(allowedPublicUrl('https://evil.test/new/api/public/lotcards/search'), null);
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  await assert.rejects(
    resolvePublicHost('torgi.gov.ru', async () => [{ address: '127.0.0.1', family: 4 }]),
    /PRIVATE_IP_DENIED/
  );
});

test('fixed EFRSB routes allow only bounded list and UUID detail/message URLs', () => {
  assert.match(efrsbSearchUrl(0), /^https:\/\/fedresurs\.ru\/backend\/biddings\?limit=5&offset=0$/);
  assert.match(efrsbDetailUrl(efrsbDetail.guid), /\/backend\/biddings\/38d2b184-/);
  assert.match(efrsbMessageUrl(efrsbMessage.guid), /\/backend\/bankruptcy-messages\/33333333-/);
  assert.throws(() => efrsbSearchUrl(10), /PAGE_LIMIT/);
  assert.throws(() => efrsbDetailUrl('../admin'), /INVALID_SOURCE_ID/);
  assert.equal(allowedPublicUrl('https://fedresurs.ru/backend/biddings?limit=200&offset=0'), null);
  assert.equal(allowedPublicUrl('https://fedresurs.ru/backend/biddings/x'), null);
});

test('EFRSB parser preserves explicit application window and publication provenance', () => {
  const lots = parseEfrsbLots(
    efrsbList.pageData[0],
    efrsbDetail,
    [{ guid: efrsbMessage.guid, payload: efrsbMessage, url: efrsbMessageUrl(efrsbMessage.guid) }],
    '2026-10-14T10:00:00Z',
    Date.parse('2026-10-14T10:00:00Z')
  );
  assert.equal(lots.length, 1);
  assert.equal(lots[0].region_code, '52');
  assert.equal(lots[0].price_rub, 562500);
  assert.equal(lots[0].application_deadline, '2026-11-01T10:00:00+03:00');
  assert.equal(lots[0].accepting_applications, 'CONFIRMED_BY_PUBLICATION_DATES');
  assert.match(lots[0].provenance.title, /^bankruptcy-message:/);
});

test('EFRSB never claims open applications after the explicit window', () => {
  const [lot] = parseEfrsbLots(
    efrsbList.pageData[0], efrsbDetail,
    [{ guid: efrsbMessage.guid, payload: efrsbMessage }],
    '2026-12-01T00:00:00Z', Date.parse('2026-12-01T00:00:00Z')
  );
  assert.equal(lot.accepting_applications, 'UNKNOWN');
});

test('bounded EFRSB research reads list, detail and linked message without documents', async () => {
  const requested = [];
  const requestJson = async url => {
    requested.push(url);
    if (url.includes('/bankruptcy-messages/')) return efrsbMessage;
    if (url.includes('/backend/biddings/')) return efrsbDetail;
    return efrsbList;
  };
  const result = await efrsbMiniSearch('Найди прицепы в Приволжском федеральном округе', {
    requestJson, cacheEnabled: false, rateKey: 'efrsb-pfo-test', now: () => Date.parse('2026-10-14T10:00:00Z')
  });
  assert.equal(result.lots.length, 1);
  assert.equal(result.lots[0].source, 'efrsb');
  assert.equal(result.cost.http_requests, 3);
  assert.equal(result.cost.llm_tokens, 0);
  assert.equal(result.coverage, 'SCANNED_AVAILABLE_PAGES');
  assert.ok(requested.every(url => !/\.pdf|\.zip/i.test(url)));
});

test('EFRSB blocked source is transparent and never leaks TEST_ONLY lots', async () => {
  const result = await efrsbMiniSearch('прицепы на торгах по банкротству', {
    requestJson: async () => { throw new ResearchError('SOURCE_BLOCKED'); },
    cacheEnabled: false,
    rateKey: 'efrsb-blocked-test',
    now: () => 50_000
  });
  assert.equal(result.reason, 'SOURCE_BLOCKED');
  assert.deepEqual(result.lots, []);
});

test('METS bounded feed accepts only exact public event/card paths', () => {
  assert.equal(metsFeedUrl(), 'https://m-ets.ru/');
  assert.equal(metsDetailUrl('238369', '1'), 'https://m-ets.ru/238369-1');
  assert.throws(() => metsDetailUrl('../admin', '1'), /INVALID_SOURCE_ID/);
  assert.equal(allowedPublicUrl('https://m-ets.ru/search?q=anything'), null);
  assert.equal(allowedPublicUrl('https://m-ets.ru/238369-1'), 'https://m-ets.ru/238369-1');
  assert.deepEqual(parseMetsFeed(metsFeed).map(row => row.key), ['238369:1']);
});

test('METS detail extracts source facts and does not invent timezone dates', () => {
  const lot = parseMetsDetail(metsDetail, { trade_number: '238369', lot_number: '1' }, '2026-10-14T00:00:00Z');
  assert.equal(lot.source_lot_id, '269509384');
  assert.equal(lot.price_rub, 1072800);
  assert.equal(lot.region_code, '52');
  assert.equal(lot.application_deadline, '24.10.2026 00:00');
  assert.equal(lot.accepting_applications, 'CONFIRMED_BY_SOURCE_STATUS');
  assert.equal(lot.checked_at, '2026-10-14T00:00:00Z');
});

test('METS mini search is bounded to event feed and reports incomplete coverage', async () => {
  const requested = [];
  const result = await metsMiniSearch('Найди прицепы в Приволжском федеральном округе', {
    requestHtml: async url => { requested.push(url); return url === metsFeedUrl() ? metsFeed : metsDetail; },
    cacheEnabled: false,
    rateKey: 'mets-test',
    now: () => 60_000
  });
  assert.equal(result.lots.length, 1);
  assert.equal(result.coverage, 'BOUNDED_EVENT_FEED');
  assert.equal(result.cost.http_requests, 2);
  assert.equal(result.cost.llm_tokens, 0);
  assert.deepEqual(requested, [metsFeedUrl(), metsDetailUrl('238369', '1')]);
});

test('UTPL parser reads public catalog and confirms only an open unexpired detail card', async () => {
  const candidates = parseUtplCatalog(utplCatalog, 'auction');
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, utplDetailUrl('auction', '127861'));
  assert.equal(utplCatalogUrl('auction'), 'https://bankrupt.utpl.ru/public/auctions-all/');
  const lot = parseUtplDetail(utplDetail, candidates[0], '2026-10-15T00:00:00Z', Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(lot.source, 'utpl');
  assert.equal(lot.region_code, '63');
  assert.equal(lot.price_rub, 1190000);
  assert.equal(lot.accepting_applications, 'CONFIRMED_BY_SOURCE_STATUS_AND_DATE');
  const expired = parseUtplDetail(utplDetail.replace('18.11.2026', '01.01.2026'), candidates[0], '2026-10-15T00:00:00Z', Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(expired.accepting_applications, 'UNKNOWN');
});

test('UTPL mini search reopens matching detail and excludes expired or closed rows', async () => {
  const requested = [];
  const result = await utplMiniSearch('Найди транспорт в Самарской области', {
    requestHtml: async url => {
      requested.push(url);
      if (url.includes('/lots/view/127861/')) return utplDetail;
      return url.includes('public-offers-all') ? '<html></html>' : utplCatalog;
    },
    cacheEnabled: false,
    rateKey: 'utpl-test',
    now: () => Date.parse('2026-10-15T00:00:00Z')
  });
  assert.equal(result.status, 'LIVE_VERIFIED_SOURCE_DATA');
  assert.equal(result.lots.length, 1);
  assert.ok(requested.includes(utplDetailUrl('auction', '127861')));
  assert.ok(requested.every(url => !url.includes('127.0.0.1')));
});

function fakeHttpsResponse({ status = 200, contentType = 'application/json', body = '{}' }) {
  return (_options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      const response = Readable.from([Buffer.from(body)]);
      response.statusCode = status;
      response.headers = { 'content-type': contentType, location: 'https://evil.test/' };
      callback(response);
    };
    request.destroy = error => request.emit('error', error);
    return request;
  };
}

test('safe network layer rejects redirects and oversized responses', async () => {
  const lookupFn = async () => [{ address: '8.8.8.8', family: 4 }];
  await assert.rejects(
    safeJsonGet(gisSearchUrl(0), { lookupFn, requestFn: fakeHttpsResponse({ status: 302 }) }),
    /REDIRECT_DENIED/
  );
  await assert.rejects(
    safeJsonGet(gisSearchUrl(0), { lookupFn, requestFn: fakeHttpsResponse({ body: '{"large":"123456789"}' }), maxBytes: 5 }),
    /SOURCE_TOO_LARGE/
  );
});
