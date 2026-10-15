/* Real-browser acceptance of the growth package: home, simplified menu, inactive «Каталог», AI-search page, services, blog cards,
 * the three articles (with and without JavaScript), CTAs, the preserved individual-selection page. Real mouse/touch/keyboard.
 * Usage: node scripts/site-growth-e2e.mjs <baseUrl|local> <outDir>   (`local` serves the repo from /app) */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import playwright from '/pw/playwright/driver/package/index.js';

const [arg = 'https://torgatlas.ru', out = '/out'] = process.argv.slice(2);
const root = '/app';
const mime = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
let server = null, base = arg;
if (arg === 'local') {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname.startsWith('/api/') || pathname.startsWith('/ta/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"enabled":false}'); }
    const candidate = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = path.resolve(root, `.${candidate}`);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const rec = (kind, id, ok, evidence = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', kind, id, JSON.stringify(evidence).slice(0, 300)); };
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SLUGS = ['kak-uchastvovat-v-torgah-po-bankrotstvu', 'publichnoe-predlozhenie-bankrotstvo', 'zadatok-na-torgah-po-bankrotstvu'];
const futureHosts = [];

async function session(width, { js = true } = {}) {
  const mobile = width < 500;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, userAgent: mobile ? MOBILE_UA : undefined, isMobile: mobile, hasTouch: mobile, javaScriptEnabled: js, locale: 'ru-RU' });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const h = { context, page, mobile, errors: [], js };
  page.on('request', r => { const u = new URL(r.url()); if (/^app\.|torgatos/.test(u.hostname)) futureHosts.push(u.hostname); });
  page.on('pageerror', e => h.errors.push(String(e.message).slice(0, 100)));
  return h;
}
async function go(h, p) {
  await h.page.goto(`${base}${p}`, { waitUntil: 'load' }); await h.page.waitForTimeout(400);
  // The analytics consent banner is fixed at the bottom and covers footer links until the visitor chooses: choose «decline» like a visitor would.
  const decline = h.page.locator('[data-analytics-decline]');
  if (h.js !== false && await decline.count() && await decline.first().isVisible()) { await tap(h, decline.first()); await h.page.waitForTimeout(300); }
}
async function tap(h, locator) {
  await locator.scrollIntoViewIfNeeded();
  let b = await locator.boundingBox();
  for (let i = 0; i < 20; i += 1) {                                   // smooth scrolling: wait until the element stops moving
    await h.page.waitForTimeout(150);
    const next = await locator.boundingBox();
    if (next && b && Math.abs(next.y - b.y) < 0.5 && Math.abs(next.x - b.x) < 0.5) { b = next; break; }
    b = next;
  }
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  if (h.mobile) await h.page.touchscreen.tap(x, y); else await h.page.mouse.click(x, y);
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const pathOf = page => new URL(page.url()).pathname + new URL(page.url()).hash;

for (const [label, width] of [['DESKTOP 1440', 1440], ['ANDROID 412', 412]]) {
  const h = await session(width); const tag = `${label}`;
  // ---------- home ----------
  await go(h, '/');
  const nav = await h.page.$$eval('.home-nav .nav-links > *', els => els.map(e => ({ tag: e.tagName, text: e.textContent.trim().replace(/\s+/g, ' '), href: e.getAttribute('href') })));
  rec('REAL', `${tag} home menu: simplified, one inactive «Каталог Скоро» marker, no «Поиск»`, nav.length <= 8 && nav.filter(n => n.tag === 'SPAN').length === 1 && nav.find(n => n.tag === 'SPAN').text === 'Каталог Скоро' && !nav.some(n => /^Поиск/.test(n.text)) && nav.some(n => n.href === '/ai-poisk-lotov/') && nav.some(n => n.href === '/proverka-lota/'), nav.map(n => n.text));
  const status = await h.page.textContent('.home-status');
  rec('REAL', `${tag} home explains AI-search vs catalogue`, /AI-поиск — уже работает/.test(status) && /Полный каталог — в разработке/.test(status) && /app\.torgatlas\.ru/.test(status));
  rec('REAL', `${tag} catalogue card has no link and no click target`, await h.page.evaluate(() => { const card = document.querySelector('.home-status-card--soon'); return card.querySelectorAll('a,[href],button').length === 0; }));
  rec('REAL', `${tag} primary actions still visible: «Проверить лот», «Подобрать объект»`, await h.page.locator('.hero-buttons a').first().isVisible() && (await h.page.$$eval('.hero-buttons a', a => a.map(x => x.textContent.trim()))).join('|') === 'Проверить лот|Подобрать объект');
  rec('REAL', `${tag} home: no horizontal scroll, no JS errors`, await noHScroll(h.page) && h.errors.length === 0, h.errors);
  const beforeUrl = h.page.url();
  const marker = h.page.locator('.home-nav .nav-soon');
  if (await marker.isVisible()) await tap(h, marker);
  await tap(h, h.page.locator('.home-status-card--soon p')); await h.page.waitForTimeout(500);
  rec('REAL', `${tag} clicking the catalogue marker/card does not navigate`, h.page.url() === beforeUrl, h.page.url());
  if (width >= 900) await h.page.screenshot({ path: `${out}/growth-home-desktop.png`, fullPage: false }); else await h.page.screenshot({ path: `${out}/growth-home-mobile.png`, fullPage: false });
  // real navigation clicks
  await tap(h, h.page.locator('.home-nav .nav-links a[href="/ai-poisk-lotov/"]')); await h.page.waitForURL('**/ai-poisk-lotov/');
  rec('REAL', `${tag} menu «AI-поиск лотов» opens the AI page with a usable field`, (await h.page.evaluate(() => !document.getElementById('ai-query').disabled)) && pathOf(h.page) === '/ai-poisk-lotov/');
  const cta = await h.page.textContent('#ai-catalog-cta');
  rec('REAL', `${tag} AI page: catalogue CTA says «В разработке» with the address as text, hidden before a search, no link`, /Посмотреть больше лотов в каталоге ТоргАтлас/.test(cta) && /В разработке/.test(cta) && /app\.torgatlas\.ru/.test(cta) && await h.page.evaluate(() => document.getElementById('ai-catalog-cta').hidden && !document.getElementById('ai-catalog-cta').querySelector('a,[href]')));
  rec('REAL', `${tag} AI page: ALTCHA container and cap «До 5 результатов» present`, await h.page.evaluate(() => !!document.getElementById('ai-captcha') && /До 5 результатов/.test(document.body.textContent)));
  await go(h, '/'); await tap(h, h.page.locator('.home-nav .nav-links a[href="/proverka-lota/"]')); await h.page.waitForURL('**/proverka-lota/');
  rec('REAL', `${tag} menu «Проверка лота» opens the check page with its form`, await h.page.locator('#lot-check-form').count() === 1);
  // ---------- services, individual selection ----------
  await go(h, '/soprovozhdenie-torgov/');
  rec('REAL', `${tag} services page: menu without «Поиск», footer reaches «Индивидуальный подбор»`, (await h.page.$$eval('.nav a', a => a.map(x => x.textContent.trim()))).every(t => t !== 'Поиск') && await h.page.locator('footer a[href="/poisk-imushchestva/"]').count() === 1 && await noHScroll(h.page));
  await tap(h, h.page.locator('footer a[href="/poisk-imushchestva/"]')); await h.page.waitForURL('**/poisk-imushchestva/');
  rec('REAL', `${tag} individual selection page preserved with its form`, await h.page.locator('#search-brief-form').count() === 1 && await h.page.evaluate(() => !/noindex/.test(document.querySelector('meta[name=robots]').content)));
  // ---------- blog cards ----------
  await go(h, '/blog/');
  const cards = await h.page.$$('article.guide-card');
  rec('REAL', `${tag} blog: 6 compact cards, three new with «Развернуть»`, cards.length === 6 && await h.page.locator('details.card-more').count() === 3);
  const firstMore = h.page.locator('#card-kak-uchastvovat-v-torgah-po-bankrotstvu details.card-more');
  await tap(h, firstMore.locator('summary'));
  rec('REAL', `${tag} «Развернуть» shows the short overview and the label becomes «Свернуть»`, await firstMore.evaluate(d => d.open) && await firstMore.locator('.card-overview').isVisible() && await firstMore.locator('.when-open').isVisible() && !(await firstMore.locator('.when-closed').isVisible()));
  await tap(h, firstMore.locator('summary'));
  rec('REAL', `${tag} «Свернуть» returns the compact card`, !(await firstMore.evaluate(d => d.open)) && !(await firstMore.locator('.card-overview').isVisible()));
  const full = await h.page.evaluate(() => document.body.textContent.includes('Главная ошибка: выбирать объект по низкой начальной цене'));
  rec('REAL', `${tag} /blog/ does not duplicate the full article`, !full && await noHScroll(h.page));
  await tap(h, h.page.locator('#card-kak-uchastvovat-v-torgah-po-bankrotstvu a.card-read')); await h.page.waitForURL('**/kak-uchastvovat-v-torgah-po-bankrotstvu/');
  rec('REAL', `${tag} «Читать полную статью» opens the standalone article`, (await h.page.textContent('h1')).startsWith('Как участвовать в торгах по банкротству'));
  if (width >= 900) await h.page.screenshot({ path: `${out}/growth-article-desktop.png`, fullPage: false }); else await h.page.screenshot({ path: `${out}/growth-article-mobile.png`, fullPage: false });
  // ---------- the three articles ----------
  for (const slug of SLUGS) {
    await go(h, `/blog/${slug}/`);
    const info = await h.page.evaluate(() => ({ h1: document.querySelector('h1').textContent, answerVisible: (() => { const r = document.getElementById('answer').getBoundingClientRect(); return r.height > 0; })(), sections: document.querySelectorAll('details.art-sec').length, first: document.querySelector('details.art-sec').open, toolsVisible: !document.querySelector('[data-art-tools]').hidden }));
    rec('REAL', `${tag} ${slug}: H1, visible direct answer, sections, first open, expand/collapse toolbar`, info.h1.length > 30 && info.answerVisible && info.sections >= 4 && info.first && info.toolsVisible, info);
    const second = h.page.locator('details.art-sec').nth(1);
    await tap(h, second.locator('summary'));
    const opened = await second.evaluate(d => d.open);
    await h.page.keyboard.press('Enter'); // summary keeps focus after a real click: Enter must toggle it again (keyboard access)
    const closedByKey = !(await second.evaluate(d => d.open));
    rec('REAL', `${tag} ${slug}: summary opens by pointer and toggles by keyboard`, opened && closedByKey);
    await tap(h, h.page.locator('[data-expand-all]'));
    const allOpen = await h.page.evaluate(() => [...document.querySelectorAll('details.art-sec')].every(d => d.open));
    await tap(h, h.page.locator('[data-collapse-all]'));
    const allClosed = await h.page.evaluate(() => [...document.querySelectorAll('details.art-sec')].every(d => !d.open));
    rec('REAL', `${tag} ${slug}: «Развернуть все» / «Свернуть все»`, allOpen && allClosed);
    await tap(h, h.page.locator('.art-toc a[href="#s3"]')); await h.page.waitForTimeout(400);
    rec('REAL', `${tag} ${slug}: plan link opens its section`, await h.page.evaluate(() => document.getElementById('s3').open) && pathOf(h.page).endsWith('#s3'));
    rec('REAL', `${tag} ${slug}: no horizontal scroll, summary tap target >= 44px`, await noHScroll(h.page) && (await h.page.evaluate(() => document.querySelector('details.art-sec > summary').getBoundingClientRect().height)) >= 44);
    await tap(h, h.page.locator('.art-conclusion a[href="/ai-poisk-lotov/"]')); await h.page.waitForURL('**/ai-poisk-lotov/');
    const aiOk = await h.page.evaluate(() => !document.getElementById('ai-query').disabled);
    await go(h, `/blog/${slug}/`); await tap(h, h.page.locator('.art-conclusion a[href="/proverka-lota/#lot-check-form"]')); await h.page.waitForURL('**/proverka-lota/**');
    rec('REAL', `${tag} ${slug}: CTA «AI-поиск» and «карта проверки» work`, aiOk && pathOf(h.page) === '/proverka-lota/#lot-check-form' && await h.page.locator('#lot-check-form').count() === 1);
  }
  rec('REAL', `${tag} never requested the future catalogue host`, futureHosts.length === 0, futureHosts);
  await h.context.close();
}

// ---------- no JavaScript at all ----------
{
  const h = await session(412, { js: false });
  for (const slug of SLUGS) {
    await go(h, `/blog/${slug}/`);
    const info = await h.page.evaluate(() => ({ text: document.querySelector('details.art-sec:nth-of-type(2) .art-body').textContent.trim().length, tools: document.querySelector('[data-art-tools]').hidden, sections: document.querySelectorAll('details.art-sec').length }));
    const second = h.page.locator('details.art-sec').nth(1);
    await tap(h, second.locator('summary'));
    rec('REAL', `NO-JS ${slug}: text present, toolbar stays hidden, sections open natively`, info.text > 150 && info.tools === true && info.sections >= 4 && await second.evaluate(d => d.open), info);
  }
  await go(h, '/blog/'); await tap(h, h.page.locator('#card-zadatok-na-torgah-po-bankrotstvu details.card-more summary'));
  rec('REAL', 'NO-JS blog card expands natively', await h.page.locator('#card-zadatok-na-torgah-po-bankrotstvu details.card-more').evaluate(d => d.open));
  await h.context.close();
}
await browser.close(); if (server) server.close();
console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
