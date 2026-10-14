import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  allowedPublicUrl,
  gisDetailUrl,
  gisMiniSearch,
  gisSearchUrl,
  isPrivateIp,
  parseGisLot,
  parseSimpleQuery,
  resolvePublicHost,
  safeJsonGet
} from '../lib/torgatlas-public-web-research.mjs';

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
