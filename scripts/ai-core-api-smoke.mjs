/* TEST_ONLY chain smoke: daemon API (ALTCHA + intent parser + Core client) -> Core public-search -> PostgreSQL slice.
 * Talks to the isolated stack only (BASE, default http://ta-core-test-ai:8080). Solves the proof of work like the widget.
 * Usage: BASE=http://host:8080 node scripts/ai-core-api-smoke.mjs [rounds] */
import { createHash } from 'node:crypto';

const BASE = process.env.BASE || 'http://ta-core-test-ai:8080';
const ROUNDS = Number(process.argv[2] || 1);
const HEADERS = { 'content-type': 'application/json', origin: 'https://torgatlas.ru', 'x-real-ip': '198.51.100.7' };
const sha = text => createHash('sha256').update(text).digest('hex');
let pass = 0, fail = 0;
const check = (name, ok, evidence = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${evidence}`); };

async function token() {
  const response = await fetch(`${BASE}/api/ai-lot-search?altcha=1`, { headers: { 'x-real-ip': '198.51.100.7' } });
  const c = await response.json();
  for (let n = 0; n <= c.maxnumber; n++) if (sha(c.salt + n) === c.challenge) return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString('base64');
  throw new Error('unsolvable');
}
async function ask(query, altcha) {
  const t = performance.now();
  const response = await fetch(`${BASE}/api/ai-lot-search`, { method: 'POST', headers: HEADERS, body: JSON.stringify(altcha === undefined ? { query } : { query, altcha }) });
  return { status: response.status, body: await response.json().catch(() => ({})), ms: Math.round(performance.now() - t) };
}

const QUERIES = [
  ['квартиры в ЮФО', { subtype: 'Квартира', fd: 'Южный федеральный округ' }],
  ['квартиры в ЮФО на публичном предложении', { subtype: 'Квартира', fd: 'Южный федеральный округ', procedure: 'Публичное предложение' }],
  ['автомобильные прицепы в ПФО', { subtype: 'Прицеп / полуприцеп', fdLike: true }],
  ['прицепы в Поволжье до 800000 рублей', { subtype: 'Прицеп / полуприцеп', maxPrice: 800000 }],
  ['нежилые помещения в Самарской области', { subtype: 'Нежилое помещение', region: 'Самарская область' }],
  ['грузовые автомобили в Татарстане', { subtype: 'Грузовой автомобиль', region: 'Республика Татарстан' }]
];
const POVOLZHYE = ['Астраханская область', 'Волгоградская область', 'Пензенская область', 'Самарская область', 'Саратовская область', 'Ульяновская область', 'Республика Калмыкия', 'Республика Татарстан'];
const PFO = ['Республика Башкортостан', 'Республика Марий Эл', 'Республика Мордовия', 'Республика Татарстан', 'Удмуртская Республика', 'Чувашская Республика — Чувашия', 'Пермский край', 'Кировская область', 'Нижегородская область', 'Оренбургская область', 'Пензенская область', 'Самарская область', 'Саратовская область', 'Ульяновская область'];
const times = [];

console.log('# without a token / with garbage');
let r = await ask(QUERIES[0][0]);
check('no token => 403 CAPTCHA_REQUIRED', r.status === 403 && r.body.code === 'CAPTCHA_REQUIRED', JSON.stringify(r.body));
r = await ask(QUERIES[0][0], 'A'.repeat(300));
check('garbage token => 403 CAPTCHA_INVALID', r.status === 403 && r.body.code === 'CAPTCHA_INVALID', JSON.stringify(r.body));
const forgedSalt = `${'ab'.repeat(16)}?expires=${Math.floor(Date.now() / 1000) + 200}&`;
const forged = Buffer.from(JSON.stringify({ algorithm: 'SHA-256', challenge: sha(forgedSalt + '5'), number: 5, salt: forgedSalt, signature: '0'.repeat(64) })).toString('base64');
r = await ask(QUERIES[0][0], forged);
check('self-made challenge with a guessed signature => 403 CAPTCHA_INVALID', r.status === 403 && r.body.code === 'CAPTCHA_INVALID', JSON.stringify(r.body));

console.log('# replay and parallel use');
const one = await token();
r = await ask(QUERIES[0][0], one);
check('valid token accepted once', r.status === 200 && r.body.ok === true, `status=${r.body.status}`);
r = await ask(QUERIES[0][0], one);
check('same token again => 403 CAPTCHA_REPLAY', r.status === 403 && r.body.code === 'CAPTCHA_REPLAY', JSON.stringify(r.body));
const shared = await token();
const pair = await Promise.all([ask(QUERIES[1][0], shared), ask(QUERIES[1][0], shared)]);
const outcome = pair.map(x => (x.status === 200 ? 'served' : x.body.code)).sort();
check('two parallel requests with one token: exactly one served', outcome.join() === 'CAPTCHA_REPLAY,served', outcome.join());

console.log('# real queries through the whole chain');
for (let round = 0; round < ROUNDS; round++) {
  for (const [query, expect] of QUERIES) {
    const res = await ask(query, await token());
    times.push(res.ms);
    const lots = res.body.lots || [];
    const bad = [];
    if (res.status !== 200 || res.body.ok !== true) bad.push(`status ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
    if (lots.length > 5) bad.push('more than 5 cards');
    for (const lot of lots) {
      if (expect.subtype && lot.category !== expect.subtype) bad.push(`category ${lot.category}`);
      if (expect.region && lot.region !== expect.region) bad.push(`region ${lot.region}`);
      if (expect.fd && !['Ростовская область', 'Волгоградская область', 'Краснодарский край', 'Астраханская область', 'Республика Адыгея', 'Республика Крым', 'Республика Калмыкия', 'Севастополь', 'Запорожская область', 'Херсонская область', 'Донецкая Народная Республика', 'Луганская Народная Республика'].includes(lot.region)) bad.push(`region outside ЮФО ${lot.region}`);
      if (expect.procedure && lot.procedure_type !== expect.procedure) bad.push(`procedure ${lot.procedure_type}`);
      if (expect.fdLike && !PFO.includes(lot.region)) bad.push(`region outside ПФО ${lot.region}`);
      if (expect.maxPrice && !(lot.price_rub <= expect.maxPrice)) bad.push(`price ${lot.price_rub}`);
      if (query.includes('Поволжье') && !POVOLZHYE.includes(lot.region)) bad.push(`region outside Поволжье ${lot.region}`);
      if (!/^https:\/\//.test(lot.url)) bad.push('link not https');
      if (!lot.checked_at) bad.push('no check date');
      if (!(lot.application_deadline ? new Date(lot.application_deadline) > new Date() : lot.accepting_applications === 'NOT_CONFIRMED')) bad.push('stale or unlabeled');
    }
    check(`"${query}" -> ${lots.length} card(s) in ${res.ms} ms`, bad.length === 0, bad.join('; '));
    if (round === 0) for (const lot of lots) console.log(`   · ${lot.category} | ${lot.region} | ${lot.procedure_type} | ${lot.price_rub} (${(lot.price_meaning || '').slice(0, 24)}) | до ${String(lot.application_deadline || 'срок не подтверждён').slice(0, 10)} | проверено ${String(lot.checked_at).slice(0, 10)} | ${lot.source} | ${String(lot.title).slice(0, 50)}`);
  }
}
console.log('# interpretation and clarification');
r = await ask('квартиры в Сибири на публичном предложении', await token());
check('"в Сибири" asks to clarify, no cards', r.status === 200 && r.body.status === 'NEEDS_CLARIFICATION' && r.body.lots.length === 0, r.body.clarification);
r = await ask('прицепы в Поволжье до 800000 рублей', await token());
check('Поволжье rule is displayed', (r.body.notes || []).some(n => /Поволжье/.test(n) && /Волжский экономический район/.test(n)), JSON.stringify(r.body.notes));
const leak = JSON.stringify(r.body);
check('no internal ids / raw fields in the public answer', !/"(id|lot_id|auction_id|source_id|source_data|catalogue_data|debtor|inn)"/i.test(leak));
times.sort((a, b) => a - b);
const p = q => times[Math.min(times.length - 1, Math.ceil(times.length * q) - 1)];
console.log(`\nLATENCY full chain (PoW excluded): n=${times.length} p50=${p(0.5)} ms p95=${p(0.95)} ms max=${times.at(-1)} ms`);
console.log(`SUMMARY pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
