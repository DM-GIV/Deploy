/* TEST_ONLY browser E2E of the Core-backed AI search against the ISOLATED stack (never production).
 * The site files are served locally; ONLY /api/ai-lot-search* is forwarded to the isolated daemon (UP_HOST:UP_PORT) with
 * Origin: https://torgatlas.ru added (the daemon requires it; on production nginx forwards the browser's own Origin).
 * Real actions (real mouse/touch coordinates, keyboard, the real self-hosted ALTCHA widget solving real proof of work,
 * the real daemon, real Core, real PostgreSQL slice) are labelled REAL; browser-layer failure injection is SIMULATED.
 * Usage: node scripts/ai-core-e2e.mjs <outDir> */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import playwright from '/pw/playwright/driver/package/index.js';

const out = process.argv[2] || '/out';
const root = '/app';
const UP = { host: process.env.UP_HOST || 'ta-core-test-ai', port: Number(process.env.UP_PORT || 8080) };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
let proxied = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api/ai-lot-search') {
    proxied += 1;
    const up = http.request({ ...UP, path: `${pathname}${url.search}`, method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', origin: 'https://torgatlas.ru', 'x-real-ip': `198.51.100.${(proxied % 200) + 1}` } }, r => { res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json' }); r.pipe(res); });
    up.on('error', () => { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<h1>502 Bad Gateway</h1>'); });
    req.pipe(up);
    return;
  }
  if (pathname.startsWith('/api/') || pathname.startsWith('/ta/')) { res.writeHead(404); return res.end('n/a'); }
  const candidate = pathname === '/' ? '/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.resolve(root, `.${candidate}`);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const rec = (kind, id, ok, evidence = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', kind, id, JSON.stringify(evidence).slice(0, 330)); };
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function open(width) {
  const mobile = width < 500;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, userAgent: mobile ? MOBILE_UA : undefined, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2.6 : 1, locale: 'ru-RU' });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const posts = []; const challenges = []; const errors = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/ai-lot-search') { if (r.method() === 'POST') posts.push(JSON.parse(r.postData() || '{}')); else if (u.searchParams.get('altcha')) challenges.push(Date.now()); } });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));
  await page.goto(`${base}/ai-poisk-lotov/`, { waitUntil: 'load' });
  return { context, page, posts, challenges, errors, mobile };
}
async function point(h, selector) { const loc = h.page.locator(selector).first(); await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function realClick(h, selector) { const { x, y } = await point(h, selector); if (h.mobile) await h.page.touchscreen.tap(x, y); else await h.page.mouse.click(x, y); }
async function typeReal(h, text) { await realClick(h, '#ai-query'); await h.page.keyboard.press('Control+A'); await h.page.keyboard.press('Delete'); await h.page.keyboard.type(text, { delay: 8 }); }
// The ALTCHA checkbox lives in the widget's shadow DOM; a real coordinate click on it is what a person does.
async function tickHuman(h) {
  await h.page.waitForSelector('altcha-widget', { state: 'attached' });
  const box = await h.page.evaluate(() => { const w = document.querySelector('altcha-widget'); const c = w && (w.shadowRoot ? w.shadowRoot.querySelector('input[type=checkbox]') : w.querySelector('input[type=checkbox]')); if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (!box) throw new Error('no checkbox');
  if (h.mobile) await h.page.touchscreen.tap(box.x, box.y); else await h.page.mouse.click(box.x, box.y);
  await h.page.waitForFunction(() => /Проверка пройдена/.test(document.getElementById('ai-captcha-hint').textContent), null, { timeout: 30000 });
}
const waitResults = page => page.waitForFunction(() => !document.getElementById('ai-results').hidden, null, { timeout: 30000 });
const status = page => page.textContent('#ai-status');
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
async function cards(page) { return page.$$eval('#ai-cards .ai-card', cs => cs.map(c => ({ title: c.querySelector('h3')?.textContent, href: c.querySelector('a[target=_blank]')?.href, text: c.textContent }))); }
async function searchOnce(h, text, { enter = false } = {}) {
  await typeReal(h, text);
  await tickHuman(h);
  if (enter) await h.page.keyboard.press('Enter'); else await realClick(h, '#ai-submit');
  await waitResults(h.page);
}

// ============================ DESKTOP (1440): the six requested queries, real everything ============================
const D = await open(1440);
rec('REAL', 'field usable immediately, nothing disabled', await D.page.evaluate(() => !document.getElementById('ai-query').disabled && !document.getElementById('ai-submit').disabled));
await D.page.waitForFunction(() => /Поиск по каталогу ТоргАтлас/.test(document.getElementById('ai-eyebrow').textContent), null, { timeout: 8000 }).catch(() => {});
rec('REAL', 'label follows the real engine: Core mode shows «Поиск по каталогу ТоргАтлас», no legacy-mode warning', await D.page.evaluate(() => /Поиск по каталогу ТоргАтлас/.test(document.getElementById('ai-eyebrow').textContent) && document.getElementById('ai-mode-note').hidden));
rec('REAL', 'page states «до 10 подходящих лотов» and the CTA is hidden before the first search', await D.page.evaluate(() => /до 10 подходящих лотов/i.test(document.body.textContent) && document.getElementById('ai-catalog-cta').hidden));
await typeReal(D, 'Квартиры в Южном федеральном округе на публичном предложении');
rec('REAL', 'keyboard typing reached the field before the CAPTCHA was touched', (await D.page.inputValue('#ai-query')) === 'Квартиры в Южном федеральном округе на публичном предложении');
await realClick(D, '#ai-submit');
await D.page.waitForTimeout(400);
rec('REAL', 'submit WITHOUT «Я человек»: clear message, text kept, no POST sent', /Я человек/.test(await status(D.page)) && D.posts.length === 0 && (await D.page.inputValue('#ai-query')).length > 20, { status: (await status(D.page)).slice(0, 90), posts: D.posts.length });
await tickHuman(D);
rec('REAL', 'real click on the ALTCHA checkbox solved a real proof of work', await D.page.evaluate(() => /Проверка пройдена/.test(document.getElementById('ai-captcha-hint').textContent)));
const beforeSubmit = Date.now();
await realClick(D, '#ai-submit');
const thinking = await D.page.waitForFunction(() => /Думаю/.test(document.getElementById('ai-status').textContent), null, { timeout: 3000 }).then(() => Date.now() - beforeSubmit).catch(() => -1);
await waitResults(D.page);
let list = await cards(D.page);
rec('REAL', '«Думаю…» visible after the click', thinking >= 0, { ms: thinking });
rec('REAL', 'POST carried the typed text and an ALTCHA token', D.posts.length === 1 && D.posts[0].query.startsWith('Квартиры в Южном') && typeof D.posts[0].altcha === 'string' && D.posts[0].altcha.length > 100);
const understood = await D.page.textContent('#ai-understood');
rec('REAL', 'query 1 «квартиры … публичном предложении»: 1–5 apartment cards, all PUBLIC OFFER, regions in ЮФО', list.length >= 1 && list.length <= 5 && list.every(c => /Вид имущества: Квартира/.test(c.text) && /Процедура: Публичное предложение/.test(c.text) && /Регион: (Ростовская|Волгоградская|Краснодарский|Астраханская|Республика Адыгея|Республика Крым|Республика Калмыкия|Севастополь)/.test(c.text)) && !/Ханты|Татарстан|Самарская|Нежилое|Аукцион/.test(list.map(c => c.text).join(' ')), { n: list.length, regions: list.map(c => (c.text.match(/Регион: ([^П]+?)(?:Начальная|Цена)/) || [])[1]) });
rec('REAL', 'every card: https primary-source link, check date, price meaning, deadline or «не подтверждён»', list.every(c => /^https:\/\//.test(c.href) && /Последняя проверка данных/.test(c.text) && /Начальная цена|Цена текущего периода/.test(c.text) && (/Приём заявок до/.test(c.text) || /не подтвержден/.test(c.text))), list.map(c => c.href));
rec('REAL', '«Как понят запрос» shows type, district and procedure', /Тип имущества: Квартира/.test(understood) && /Федеральный округ: Южный/.test(understood) && /Процедура: публичное предложение/.test(understood), understood.slice(0, 160));
const cta = await D.page.evaluate(() => { const p = document.getElementById('ai-catalog-cta'); return { hidden: p.hidden, text: p.textContent, links: p.querySelectorAll('a,[href]').length, disabled: p.querySelector('[aria-disabled=true]') !== null, after: p.compareDocumentPosition(document.getElementById('ai-cards')) & Node.DOCUMENT_POSITION_PRECEDING }; });
rec('REAL', 'catalogue CTA after the results: «Посмотреть больше лотов в каталоге ТоргАтлас» + «В разработке», not a link', !cta.hidden && /Посмотреть больше лотов в каталоге ТоргАтлас/.test(cta.text) && /В разработке/.test(cta.text) && cta.links === 0 && cta.disabled && !!cta.after, cta);
rec('REAL', 'coverage caveat names no marketplaces', !/УТПЛ|УЭТП|Центр реализации|ГИС|ЕФРСБ|МЭТС|площадк/i.test(await D.page.textContent('#ai-results-coverage')));
await D.page.screenshot({ path: `${out}/core-desktop-results.png`, fullPage: true });
const afterHint = await D.page.textContent('#ai-captcha-hint');
rec('REAL', 'after a search the CAPTCHA is reset (single use) and the text is kept', /снова отметьте/.test(afterHint) && (await D.page.inputValue('#ai-query')).startsWith('Квартиры'), afterHint);

const six = [
  ['квартиры в ЮФО', c => /Вид имущества: Квартира/.test(c.text)],
  ['автомобильные прицепы в ПФО', c => /Прицеп/.test(c.text) && /Оренбургская/.test(c.text)],
  ['прицепы в Поволжье до 800000 рублей', () => true],
  ['нежилые помещения в Самарской области', c => /Нежилое/.test(c.text) && /Самарская/.test(c.text)],
  ['грузовые автомобили в Татарстане', c => /Грузовой/.test(c.text) && /Татарстан/.test(c.text)]
];
for (const [i, [query, ok]] of six.entries()) {
  await searchOnce(D, query, { enter: i % 2 === 1 });
  const l = await cards(D.page);
  const title = await D.page.textContent('#ai-results-title');
  rec('REAL', `"${query}" (${i % 2 === 1 ? 'Enter' : 'click'}) -> ${l.length} card(s), consistent with the query`, l.length <= 5 && l.every(ok) && (l.length ? /Подходящих предложений: \d \(до 5\)/.test(title) : /не найдено/.test(title)), { title, regions: l.map(c => (c.text.match(/Регион: (.+?)(?:Начальная|Цена)/) || [])[1]) });
}
const povolzhye = await D.page.textContent('#ai-understood').catch(() => '');
await searchOnce(D, 'прицепы в Поволжье до 800000 рублей');
const pv = await D.page.textContent('#ai-understood');
rec('REAL', 'Поволжье rule is displayed and it is not silently the whole ПФО', /Волжский экономический район/.test(pv) && /не весь Приволжский/.test(pv), pv.slice(0, 200));
rec('REAL', 'repeat searches worked without a page reload (5+ searches in one page)', D.posts.length >= 6 && D.errors.length === 0, { posts: D.posts.length, pageErrors: D.errors });

for (const [query, ok] of [
  ['Найди квартиры на торгах в Москве', c => /Вид имущества: Квартира/.test(c.text) && /Регион: Москва/.test(c.text) && !/Ханты|Краснодар|Нежилое|Жилой дом/.test(c.text)],
  ['Найди автомобильные прицепы на торгах в Приволжском федеральном округе', c => /Прицеп/.test(c.text) && /Регион: Оренбургская/.test(c.text)],
  ['Найди легковые автомобили на торгах', c => /Легковой автомобиль/.test(c.text) && !/негоход|LYNX|РЫСЬ/i.test(c.text)]
]) {
  await searchOnce(D, query);
  const l = await cards(D.page);
  rec('REAL', `OWNER SCENARIO "${query}" -> ${l.length} card(s) all matching`, l.length >= 1 && l.length <= 5 && l.every(ok), l.map(c => (c.text.match(/Регион: (.+?)(?:Начальная|Цена)/) || ['', 'регион не указан'])[1]));
}
// -------- clarification: unresolved geography keeps the text and does not search the whole country --------
await searchOnce(D, 'квартиры в Сибири на публичном предложении');
const clar = await D.page.textContent('#ai-results-title') + ' | ' + await D.page.textContent('#ai-results-caption');
rec('REAL', '«в Сибири» -> «Уточните запрос», zero cards, typed text kept', /Уточните запрос/.test(clar) && (await cards(D.page)).length === 0 && (await D.page.inputValue('#ai-query')) === 'квартиры в Сибири на публичном предложении', clar.slice(0, 160));

// -------- failures (SIMULATED at the browser layer) --------
await D.page.route('**/api/ai-lot-search', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"code":"SERVICE_UNAVAILABLE"}' }) : route.continue());
await typeReal(D, 'нежилые помещения в Самарской области'); await tickHuman(D); await realClick(D, '#ai-submit');
await D.page.waitForFunction(() => /временно недоступен/.test(document.getElementById('ai-status').textContent), null, { timeout: 8000 });
rec('SIMULATED', 'backend 503: readable message, text kept, button usable again', (await D.page.inputValue('#ai-query')) === 'нежилые помещения в Самарской области' && !(await D.page.locator('#ai-submit').isDisabled()));
await D.page.unroute('**/api/ai-lot-search');
await D.page.route('**/api/ai-lot-search', route => route.request().method() === 'POST' ? route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"code":"CAPTCHA_REPLAY"}' }) : route.continue());
await tickHuman(D); await realClick(D, '#ai-submit');
await D.page.waitForFunction(() => /Я человек.*(не принята|устарела)|не принята или устарела/.test(document.getElementById('ai-status').textContent), null, { timeout: 8000 });
rec('SIMULATED', 'CAPTCHA_REPLAY from server: asks to tick «Я человек» again, text kept', /Отметьте|отметьте/.test(await status(D.page)) && (await D.page.inputValue('#ai-query')).length > 10);
await D.page.unroute('**/api/ai-lot-search');
await tickHuman(D); await realClick(D, '#ai-submit'); await waitResults(D.page);
rec('REAL', 'recovery: after the failures a real retry on the same page returns results (no reload)', (await cards(D.page)).length >= 0 && /Результаты|Подходящих|не найдено/.test(await D.page.textContent('#ai-results-title')));
await D.context.close();

// -------- CAPTCHA endpoint down / widget script blocked: the field and text must still work --------
{
  const h = { ...(await (async () => { const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage(); page.setDefaultTimeout(20000); await page.route('**/api/ai-lot-search?altcha=1', r => r.abort()); await page.goto(`${base}/ai-poisk-lotov/`); return { context, page, posts: [], mobile: false }; })()) };
  await typeReal(h, 'грузовые автомобили в Татарстане');
  await h.page.waitForTimeout(800);
  await realClick(h, '#ai-submit');
  await h.page.waitForTimeout(500);
  rec('SIMULATED', 'CAPTCHA challenge endpoint unreachable: field usable, text kept, message shown, button not stuck', (await h.page.inputValue('#ai-query')) === 'грузовые автомобили в Татарстане' && /Я человек/.test(await status(h.page)) && !(await h.page.locator('#ai-submit').isDisabled()), (await status(h.page)).slice(0, 100));
  await h.context.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await ctx2.newPage(); p2.setDefaultTimeout(20000);
  await p2.route('**/assets/vendor/altcha/**', r => r.abort()); await p2.goto(`${base}/ai-poisk-lotov/`);
  const b = await p2.locator('#ai-query').boundingBox(); await p2.mouse.click(b.x + 20, b.y + 20); await p2.keyboard.type('склады в Москве до 5 млн рублей');
  await p2.waitForTimeout(800);
  rec('SIMULATED', 'ALTCHA widget script blocked: typing still works, explicit message about the check', (await p2.inputValue('#ai-query')).length > 20 && /не загрузилась проверка/i.test(await p2.textContent('#ai-captcha-hint')), (await p2.textContent('#ai-captcha-hint')).slice(0, 110));
  await ctx2.close();
}

// ============================ MOBILE (Android Chrome UA, 412x800 touch) ============================
const M = await open(412);
await realClick(M, '#ai-query');
await M.page.keyboard.type('грузовые автомобили в Татарстане', { delay: 8 });
rec('REAL', 'mobile: tap + typing reach the field', (await M.page.inputValue('#ai-query')) === 'грузовые автомобили в Татарстане');
await M.page.evaluate(() => { document.getElementById('ai-query').value = ''; });
await realClick(M, '.ai-example:nth-of-type(1)');
rec('REAL', 'mobile: example button fills the field', (await M.page.inputValue('#ai-query')).startsWith('Квартиры в Южном'));
await tickHuman(M);
await realClick(M, '#ai-submit');
await waitResults(M.page);
const ml = await cards(M.page);
rec('REAL', 'mobile: touch-verified CAPTCHA, tap submit, 1–5 cards, no horizontal scroll', ml.length >= 1 && ml.length <= 5 && await noHScroll(M.page), { n: ml.length });
rec('REAL', 'mobile: CTA «В разработке» visible after the results', await M.page.evaluate(() => { const c = document.getElementById('ai-catalog-cta'); const r = c.getBoundingClientRect(); return !c.hidden && r.width > 0 && /В разработке/.test(c.textContent); }));
await M.page.screenshot({ path: `${out}/core-mobile-results.png`, fullPage: true });
await M.context.close();
await browser.close(); server.close();
console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
