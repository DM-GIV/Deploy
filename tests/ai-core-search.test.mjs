import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createChallenge, verifyPayload, ReplayStore, IssueLimiter, ALTCHA } from '../lib/torgatlas-altcha.mjs';
import { createAiLotSearchHandler } from '../api/ai-lot-search.mjs';
import { mapCard, safeSourceUrl, searchCore, CoreSearchError } from '../lib/torgatlas-core-search.mjs';

const KEY = 'K'.repeat(8) + '0123456789abcdefghijklmnopqrstuvwxyz';
const NOW = 1_800_000_000;
const sha = text => createHash('sha256').update(text).digest('hex');

// What the browser widget does: brute-force the proof-of-work number, then base64(JSON).
function solve(challenge, tamper = {}) {
  for (let number = 0; number <= challenge.maxnumber; number += 1) {
    if (sha(challenge.salt + number) === challenge.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: challenge.algorithm, challenge: challenge.challenge, number, salt: challenge.salt, signature: challenge.signature, ...tamper })).toString('base64');
    }
  }
  throw new Error('unsolvable');
}

test('interop vector: Node produces exactly what the Python ALTCHA v1 reference (used by the lead forms) produces', () => {
  const salt = '00112233445566778899aabbccddeeff?expires=1900000000&';
  const challenge = sha(salt + '4242');
  assert.equal(challenge, 'b4c4b1bddab5228d9c29796b81f444c475b348bb750bbcbd20a8548f1018b474');
  assert.equal(createHmac('sha256', KEY).update(challenge).digest('hex'), '11e378e9afc460aac813a3f3164a55840239fc4d046b7fa6b59839ce5473e922');
  const token = 'eyJhbGdvcml0aG0iOiAiU0hBLTI1NiIsICJjaGFsbGVuZ2UiOiAiYjRjNGIxYmRkYWI1MjI4ZDljMjk3OTZiODFmNDQ0YzQ3NWIzNDhiYjc1MGJiY2JkMjBhODU0OGYxMDE4YjQ3NCIsICJudW1iZXIiOiA0MjQyLCAic2FsdCI6ICIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZj9leHBpcmVzPTE5MDAwMDAwMDAmIiwgInNpZ25hdHVyZSI6ICIxMWUzNzhlOWFmYzQ2MGFhYzgxM2EzZjMxNjRhNTU4NDAyMzlmYzRkMDQ2YjdmYTZiNTk4MzljZTU0NzNlOTIyIn0=';
  assert.equal(verifyPayload(token, KEY, { nowSeconds: 1900000000 - 100 }).ok, true);
});

test('a freshly issued challenge verifies once solved; wrong key, missing and malformed tokens fail', () => {
  const challenge = createChallenge(KEY, NOW);
  assert.equal(challenge.maxnumber, ALTCHA.maxNumber);
  const token = solve(challenge);
  assert.equal(verifyPayload(token, KEY, { nowSeconds: NOW + 5 }).ok, true);
  assert.equal(verifyPayload(token, 'Z'.repeat(8) + '0123456789abcdefghijklmnopqrstuvwxyz', { nowSeconds: NOW + 5 }).code, 'CAPTCHA_INVALID');
  assert.equal(verifyPayload(undefined, KEY, { nowSeconds: NOW }).code, 'CAPTCHA_REQUIRED');
  assert.equal(verifyPayload('', KEY, { nowSeconds: NOW }).code, 'CAPTCHA_REQUIRED');
  assert.equal(verifyPayload('not base64 !!!!!!!!!!!!!!!!!!!!', KEY, { nowSeconds: NOW }).code, 'CAPTCHA_INVALID');
  assert.equal(verifyPayload(Buffer.from('{"a":1}').toString('base64').padEnd(30, '='), KEY, { nowSeconds: NOW }).ok, false);
  assert.equal(verifyPayload('A'.repeat(ALTCHA.payloadMax + 1), KEY, { nowSeconds: NOW }).code, 'CAPTCHA_INVALID');
});

test('forgery: wrong number, forged signature, forged challenge, altered or extended expiry are all refused', () => {
  const challenge = createChallenge(KEY, NOW);
  const good = JSON.parse(Buffer.from(solve(challenge), 'base64'));
  const enc = payload => Buffer.from(JSON.stringify(payload)).toString('base64');
  assert.equal(verifyPayload(enc({ ...good, number: good.number + 1 }), KEY, { nowSeconds: NOW }).ok, false);
  assert.equal(verifyPayload(enc({ ...good, signature: '0'.repeat(64) }), KEY, { nowSeconds: NOW }).ok, false);
  // the attacker solves a challenge of their own making (no key) and signs it with a guessed key
  const forgedSalt = `${'ab'.repeat(16)}?expires=${NOW + 100}&`;
  const forgedChallenge = sha(forgedSalt + '7');
  const forged = enc({ algorithm: 'SHA-256', challenge: forgedChallenge, number: 7, salt: forgedSalt, signature: createHmac('sha256', 'guess-guess-guess-guess-guess-guess').update(forgedChallenge).digest('hex') });
  assert.equal(verifyPayload(forged, KEY, { nowSeconds: NOW }).ok, false);
  // extended expiry changes the salt, so the challenge hash no longer matches
  const extended = good.salt.replace(/expires=\d+/, `expires=${NOW + 200}`);
  assert.equal(verifyPayload(enc({ ...good, salt: extended }), KEY, { nowSeconds: NOW }).ok, false);
  // duplicated expires parameter (parameter-splicing) is refused outright
  const spliced = `${good.salt}expires=${NOW + 100}&`;
  assert.equal(verifyPayload(enc({ ...good, salt: spliced, challenge: sha(spliced + good.number) }), KEY, { nowSeconds: NOW }).ok, false);
  assert.equal(verifyPayload(enc({ ...good, algorithm: 'SHA-1' }), KEY, { nowSeconds: NOW }).ok, false);
  assert.equal(verifyPayload(enc({ ...good, number: -1 }), KEY, { nowSeconds: NOW }).ok, false);
  assert.equal(verifyPayload(enc({ ...good, number: '5' }), KEY, { nowSeconds: NOW }).ok, false);
  assert.equal(verifyPayload(enc({ ...good, number: ALTCHA.maxNumber + 1 }), KEY, { nowSeconds: NOW }).ok, false);
});

test('expiry: a challenge is refused after its time-to-live and one issued before the process started is refused', () => {
  const challenge = createChallenge(KEY, NOW);
  const token = solve(challenge);
  assert.equal(verifyPayload(token, KEY, { nowSeconds: NOW + ALTCHA.ttlSeconds + 1 }).code, 'CAPTCHA_EXPIRED');
  assert.equal(verifyPayload(token, KEY, { nowSeconds: NOW + 10, notBefore: NOW + 5 }).code, 'CAPTCHA_EXPIRED');
  assert.equal(verifyPayload(token, KEY, { nowSeconds: NOW + 10, notBefore: NOW - 5 }).ok, true);
});

test('replay store: second use is refused, capacity is bounded, expired entries are purged', () => {
  const store = new ReplayStore(3);
  assert.equal(store.consume('a', NOW + 100, NOW), 'OK');
  assert.equal(store.consume('a', NOW + 100, NOW), 'REPLAY');
  store.consume('b', NOW + 100, NOW); store.consume('c', NOW + 100, NOW);
  assert.equal(store.consume('d', NOW + 100, NOW), 'FULL');
  assert.equal(store.consume('d', NOW + 100, NOW + 101), 'OK');
});

test('challenge issuing is rate limited per client', () => {
  const limiter = new IssueLimiter(3);
  assert.deepEqual([1, 2, 3, 4].map(() => limiter.allow('1.2.3.4', 60_000)), [true, true, true, false]);
  assert.equal(limiter.allow('5.6.7.8', 60_000), true);
  assert.equal(limiter.allow('1.2.3.4', 120_000), true);
});

// ---------- handler -----------------------------------------------------------------------------------------------
const GATES = { AI_LOT_SEARCH_ENABLED: 'true', AI_LOT_SECURITY_APPROVED: 'true', AI_LOT_LEGAL_APPROVED: 'true' };
function response() { return { headers: {}, code: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return b; } }; }
function build({ env = {}, clock = { now: NOW }, core, web } = {}) {
  const calls = { core: [], web: [] };
  const environment = { ...GATES, AI_LOT_ALTCHA_REQUIRED: 'true', AI_LOT_ALTCHA_HMAC_KEY: KEY, AI_LOT_CORE_URL: 'http://core.invalid/api/v1/public-search', AI_LOT_CORE_TOKEN: 'x'.repeat(32), ...env };
  const handler = createAiLotSearchHandler({
    env: environment, nowSeconds: () => clock.now,
    core: core || (async filters => { calls.core.push(filters); return { lots: [], meta: {} }; }),
    web: web || (async query => { calls.web.push(query); return { ok: true, lots: [], status: 'PARTIAL_NO_VERIFIED_SOURCE' }; })
  });
  const post = async (body, headers = {}) => {
    const res = response();
    await handler({ method: 'POST', headers: { origin: 'https://torgatlas.ru', 'content-type': 'application/json', ...headers }, body, socket: { remoteAddress: '203.0.113.9' } }, res);
    return res;
  };
  const get = async (query = {}) => { const res = response(); await handler({ method: 'GET', headers: {}, query, socket: { remoteAddress: '203.0.113.9' } }, res); return res; };
  return { handler, post, get, calls, clock };
}
const token = (clockValue = NOW) => solve(createChallenge(KEY, clockValue));
const Q = 'Квартиры в Южном федеральном округе на публичном предложении';

test('without a token the request is refused BEFORE parsing, Core access or any source research', async () => {
  const t = build();
  const res = await t.post({ query: Q });
  assert.equal(res.code, 403); assert.equal(res.body.code, 'CAPTCHA_REQUIRED');
  assert.deepEqual([t.calls.core.length, t.calls.web.length], [0, 0]);
});

test('a valid token reaches Core with the structured filter; the same token cannot be used twice (replay)', async () => {
  const t = build();
  const altcha = token();
  t.clock.now = NOW + 3;
  const first = await t.post({ query: Q, altcha });
  assert.equal(first.code, 200); assert.equal(first.body.status, 'CORE_NO_MATCHES');
  assert.deepEqual(t.calls.core[0], { limit: 5, asset_subtypes: ['APARTMENT'], federal_districts: ['Южный федеральный округ'], procedures: ['PUBLIC_OFFER'] });
  const second = await t.post({ query: Q, altcha });
  assert.equal(second.code, 403); assert.equal(second.body.code, 'CAPTCHA_REPLAY');
  assert.equal(t.calls.core.length, 1);
});

test('parallel use of one token: exactly one of two simultaneous requests is served', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const t = build({ core: async () => { await gate; return { lots: [], meta: {} }; } });
  const altcha = token(); t.clock.now = NOW + 1;
  const a = t.post({ query: Q, altcha });
  const b = t.post({ query: Q, altcha });
  release();
  const codes = (await Promise.all([a, b])).map(r => r.body.code || r.body.status).sort();
  assert.deepEqual(codes, ['CAPTCHA_REPLAY', 'CORE_NO_MATCHES']);
});

test('expired, forged and wrong-key tokens are refused with specific codes and never reach Core', async () => {
  const t = build();
  const old = token(NOW - 1000); t.clock.now = NOW;
  assert.equal((await t.post({ query: Q, altcha: old })).body.code, 'CAPTCHA_EXPIRED');
  assert.equal((await t.post({ query: Q, altcha: 'A'.repeat(100) })).body.code, 'CAPTCHA_INVALID');
  const foreign = solve(createChallenge('Z'.repeat(8) + '0123456789abcdefghijklmnopqrstuvwxyz', NOW));
  assert.equal((await t.post({ query: Q, altcha: foreign })).body.code, 'CAPTCHA_INVALID');
  assert.equal(t.calls.core.length, 0);
});

test('a challenge issued before the process started is refused (no replay memory across restarts)', async () => {
  const clock = { now: NOW };
  const t = build({ clock });
  const stale = solve(createChallenge(KEY, NOW - 100));
  assert.equal((await t.post({ query: Q, altcha: stale })).body.code, 'CAPTCHA_EXPIRED');
});

test('challenge endpoint issues solvable, key-signed challenges and is limited per client', async () => {
  const t = build();
  const res = await t.get({ altcha: '1' });
  assert.equal(res.code, 200);
  assert.equal(res.body.maxnumber, ALTCHA.maxNumber);
  t.clock.now = NOW + 1;
  assert.equal((await t.post({ query: Q, altcha: solve(res.body) })).code, 200);
  let limited = 0;
  for (let i = 0; i < 40; i += 1) if ((await t.get({ altcha: '1' })).code === 429) limited += 1;
  assert.ok(limited >= 9);
  assert.equal((await build({ env: { AI_LOT_ALTCHA_HMAC_KEY: 'short' } }).get({ altcha: '1' })).code, 503);
});

test('fail-closed: CAPTCHA required but no usable key configured => 503, nothing is searched', async () => {
  const t = build({ env: { AI_LOT_ALTCHA_HMAC_KEY: '' } });
  const res = await t.post({ query: Q, altcha: 'A'.repeat(100) });
  assert.equal(res.code, 503); assert.equal(res.body.code, 'CAPTCHA_UNAVAILABLE');
  assert.equal(t.calls.core.length + t.calls.web.length, 0);
});

test('existing protections stay: gates, Origin, content type, unknown fields, body size, query length', async () => {
  assert.equal((await build({ env: { AI_LOT_SEARCH_ENABLED: 'false' } }).post({ query: Q })).code, 503);
  const t = build();
  assert.equal((await t.post({ query: Q }, { origin: 'https://evil.example' })).code, 403);
  assert.equal((await t.post({ query: Q }, { origin: undefined })).code, 403);
  assert.equal((await t.post({ query: Q }, { 'content-type': 'text/plain' })).code, 415);
  assert.equal((await t.post({ query: Q, source: 'x', altcha: token() })).code, 422);
  assert.equal((await t.post({ query: 'x'.repeat(401) })).code, 422);
  assert.equal((await t.post({ query: 'коротко' })).code, 422);
  assert.equal((await t.post({ query: Q, altcha: 'A'.repeat(4000) })).code, 413);
  assert.equal(t.calls.core.length, 0);
});

test('an unresolved region asks for clarification and still never queries Core with a broader filter', async () => {
  const t = build();
  t.clock.now = NOW + 1;
  const res = await t.post({ query: 'квартиры в Сибири на публичном предложении', altcha: token() });
  assert.equal(res.code, 200); assert.equal(res.body.status, 'NEEDS_CLARIFICATION');
  assert.match(res.body.clarification, /субъект РФ|федеральный округ/);
  assert.equal(t.calls.core.length, 0);
});

test('Core failures become clear errors, never "no lots found"', async () => {
  for (const [code, http, expected] of [['CORE_BUSY', 503, 'BUSY'], ['CORE_TIMEOUT', 504, 'TIMEOUT'], ['CORE_UNREACHABLE', 503, 'SERVICE_UNAVAILABLE'], ['CORE_AUTH', 503, 'SERVICE_UNAVAILABLE']]) {
    const t = build({ core: async () => { throw new CoreSearchError(code); } });
    t.clock.now = NOW + 1;
    const res = await t.post({ query: Q, altcha: token() });
    assert.equal(res.code, http); assert.equal(res.body.code, expected); assert.equal(res.body.lots, undefined);
  }
});

test('without a Core connection the existing web-research path is used and capped at five cards', async () => {
  const lots = Array.from({ length: 9 }, (_, i) => ({ title: `lot ${i}`, url: 'https://bankrupt.utpl.ru/x' }));
  const t = build({ env: { AI_LOT_CORE_URL: '', AI_LOT_CORE_TOKEN: '' }, web: async () => ({ ok: true, lots, status: 'OK' }) });
  t.clock.now = NOW + 1;
  const res = await t.post({ query: Q, altcha: token() });
  assert.equal(res.code, 200); assert.equal(res.body.lots.length, 5);
});

test('GET status never lists marketplaces and states the five-result cap', async () => {
  const res = await build().get();
  assert.equal(res.body.max_results, 5);
  assert.equal(res.body.sources, undefined);
  assert.equal(res.body.captcha.required, true);
  assert.equal(res.body.mode, 'CORE_SEARCH');
});

// ---------- Core client -----------------------------------------------------------------------------------------------
const GOOD_CARD = { title: 'Квартира, 50 кв. м', category: 'Квартира', region: 'Ростовская область', procedure: { code: 'PUBLIC_OFFER', label: 'Публичное предложение' },
  price: { amount: '3078000.00', currency: 'RUB', meaning: 'Начальная цена лота по данным каталога' }, status: { code: 'CONFIRMED_OPEN', label: 'x', confirmed: true },
  application_deadline: '2026-10-24T09:00:00+00:00', checked_at: '2026-10-02T10:00:00+00:00', source_url: 'https://torgi.cdtrf.ru/trades/372672', source_host: 'torgi.cdtrf.ru' };
const CONFIG = { url: 'http://core.invalid/api/v1/public-search', token: 'x'.repeat(32) };
const reply = (status, body, headers = {}) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

test('Core cards are re-validated: unsafe links are dropped, personal data is redacted, price/status are mapped', () => {
  for (const bad of ['http://x.ru/a', 'javascript:alert(1)', 'https://user:pw@x.ru/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://[::1]/a', 'https://x.ru:8443/a', '']) assert.equal(safeSourceUrl(bad), null, bad);
  assert.equal(mapCard({ ...GOOD_CARD, source_url: 'http://x.ru/a' }), null);
  assert.equal(mapCard({ ...GOOD_CARD, title: '' }), null);
  const mapped = mapCard(GOOD_CARD);
  assert.equal(mapped.price_rub, 3078000);
  assert.equal(mapped.accepting_applications, 'CONFIRMED_BY_CATALOGUE_DEADLINE');
  assert.equal(mapCard({ ...GOOD_CARD, status: { confirmed: false } }).accepting_applications, 'NOT_CONFIRMED');
  assert.equal(mapCard({ ...GOOD_CARD, price: null }).price_rub, null);
  const pii = mapCard({ ...GOOD_CARD, title: 'Квартира должника Иванова Ивана Ивановича, ИНН 773370123456' });
  assert.doesNotMatch(pii.title, /Иванов|773370123456/);
});

test('Core client: only whitelisted filter keys are sent, with a bearer token, no redirects; failures map to codes', async () => {
  let seen;
  const ok = await searchCore({ asset_subtypes: ['APARTMENT'], evil: 'x', limit: 99 }, { config: CONFIG, fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ results: [GOOD_CARD, { ...GOOD_CARD, source_url: 'http://bad' }], meta: { candidates: 7 } })); } });
  assert.equal(ok.lots.length, 1);
  assert.deepEqual(JSON.parse(seen.init.body), { asset_subtypes: ['APARTMENT'], limit: 5 });
  assert.equal(seen.init.redirect, 'error');
  assert.match(seen.init.headers.Authorization, /^Bearer /);
  const expectations = [[503, 'CORE_BUSY'], [504, 'CORE_TIMEOUT'], [401, 'CORE_AUTH'], [422, 'CORE_REJECTED_FILTER'], [500, 'CORE_ERROR']];
  for (const [status, code] of expectations) await assert.rejects(searchCore({}, { config: CONFIG, fetchImpl: reply(status, {}) }), error => error.code === code);
  await assert.rejects(searchCore({}, { config: CONFIG, fetchImpl: reply(200, 'not json') }), error => error.code === 'CORE_BAD_RESPONSE');
  await assert.rejects(searchCore({}, { config: CONFIG, fetchImpl: reply(200, { results: 'x' }) }), error => error.code === 'CORE_BAD_RESPONSE');
  await assert.rejects(searchCore({}, { config: CONFIG, fetchImpl: reply(200, 'x'.repeat(250_000)) }), error => error.code === 'CORE_RESPONSE_TOO_LARGE');
  await assert.rejects(searchCore({}, { config: CONFIG, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), error => error.code === 'CORE_UNREACHABLE');
  await assert.rejects(searchCore({}, { config: CONFIG, timeoutMs: 20, fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))) }), error => error.code === 'CORE_TIMEOUT');
  await assert.rejects(searchCore({}, { config: null }), error => error.code === 'CORE_NOT_CONFIGURED');
});

test('policy AI_LOT_REQUIRE_CORE=true: no silent fallback to the legacy engine; clear unavailability instead', async () => {
  const t = build({ env: { AI_LOT_CORE_URL: '', AI_LOT_CORE_TOKEN: '', AI_LOT_REQUIRE_CORE: 'true' } });
  t.clock.now = NOW + 1;
  const res = await t.post({ query: Q, altcha: token() });
  assert.equal(res.code, 503); assert.equal(res.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(res.body.reason, 'CORE_NOT_CONNECTED');
  assert.equal(res.body.lots, undefined);
  assert.equal(t.calls.web.length + t.calls.core.length, 0);
  assert.equal((await t.get()).body.mode, 'UNAVAILABLE_CORE_REQUIRED');
  // a Core failure with Core configured also never falls back
  const failing = build({ env: { AI_LOT_REQUIRE_CORE: 'true' }, core: async () => { throw new CoreSearchError('CORE_UNREACHABLE'); } });
  failing.clock.now = NOW + 1;
  assert.equal((await failing.post({ query: Q, altcha: token() })).code, 503);
  assert.equal(failing.calls.web.length, 0);
});

test('GET reports the engine that is really connected', async () => {
  assert.equal((await build({ env: { AI_LOT_CORE_URL: '', AI_LOT_CORE_TOKEN: '' } }).get()).body.mode, 'PUBLIC_WEB_RESEARCH_MINI');
  assert.equal((await build().get()).body.mode, 'CORE_SEARCH');
});

test('lots that share one publication link are marked, so one publication is never shown as several independent sources', async () => {
  const same = ['Лот №4', 'Лот №7', 'Лот №9'].map(title => ({ ...GOOD_CARD, title, source_url: 'https://fedresurs.ru/biddings/6e47f89f-5bf4-465d-942d-01fbc32f1205' }));
  const other = { ...GOOD_CARD, title: 'Квартира', source_url: 'https://fedresurs.ru/biddings/aaaaaaaa-0000-0000-0000-000000000000' };
  const result = await searchCore({}, { config: CONFIG, fetchImpl: async () => new Response(JSON.stringify({ results: [...same, other] })) });
  assert.deepEqual(result.lots.map(l => l.same_publication_count), [2, 2, 2, 0]);
});
