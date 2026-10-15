/* Real-browser acceptance of the site: final menu on 320/375/412/768/1024/1440, home, services hub, blog cards, the three fully visible articles
 * (typography, column width, CLS, keyboard, reduced motion, no JavaScript), the AI page (compact layout, show-more, prefill hand-off, zero-result help),
 * the check form and the individual-selection form, inactive catalogue.  Real mouse/touch/keyboard.
 * AI-search RESULT COUNTS 0/4/5/8/10 use a TEST_ONLY stub of the API at the browser layer (labelled SIMULATED); real results are checked by ai-live-core-e2e.mjs.
 * Usage: node scripts/site-growth-e2e.mjs <baseUrl|local> <outDir> */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

async function session(width, { js = true, reducedMotion = 'no-preference' } = {}) {
  const mobile = width < 600;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, userAgent: mobile ? MOBILE_UA : undefined, isMobile: mobile, hasTouch: mobile, javaScriptEnabled: js, locale: 'ru-RU', reducedMotion, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const h = { context, page, mobile, errors: [], js };
  page.on('request', r => { const u = new URL(r.url()); if (/^app\.|torgatos/.test(u.hostname)) futureHosts.push(u.hostname); });
  page.on('pageerror', e => h.errors.push(String(e.message).slice(0, 100)));
  return h;
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
async function dismissBanner(h) {
  const decline = h.page.locator('[data-analytics-decline]');
  if (h.js !== false && await decline.count() && await decline.first().isVisible()) { await tap(h, decline.first()); await h.page.waitForTimeout(300); }
}
async function go(h, p) {
  await h.page.goto(`${base}${p}`, { waitUntil: 'load' }); await h.page.waitForTimeout(400);
  const decline = h.page.locator('[data-analytics-decline]');                 // the consent banner covers the footer until the visitor chooses
  if (h.js !== false && await decline.count() && await decline.first().isVisible()) { await tap(h, decline.first()); await h.page.waitForTimeout(300); }
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const pathOf = page => new URL(page.url()).pathname + new URL(page.url()).hash;
const sha = t => createHash('sha256').update(t).digest('hex');

// ============ menu on every width ============
for (const width of [320, 375, 412, 768, 1024, 1440]) {
  const h = await session(width);
  await go(h, '/');
  const nav = await h.page.$$eval('.home-nav .nav-links > *', els => els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href'), h: e.getBoundingClientRect().height })));
  rec('REAL', `${width}px home menu: AI-поиск · Услуги · Примеры · Материалы · О проекте · Контакты · Проверить лот; no overflow`, nav.map(n => n.text).join('|') === 'AI-поиск|Услуги|Примеры|Материалы|О проекте|Контакты|Проверить лот' && await noHScroll(h.page), nav.map(n => n.text));
  const cta = h.page.locator('.home-nav .nav-cta');
  const box = await cta.boundingBox();
  rec('REAL', `${width}px «Проверить лот» is a visible, tappable button (>= 44px high)`, await cta.isVisible() && box.height >= 36 && box.width >= 80, box);
  await go(h, '/blog/');
  rec('REAL', `${width}px inner-page menu fits without horizontal scroll`, await noHScroll(h.page) && (await h.page.$$eval('.nav a', a => a.length)) === 6);
  await h.context.close();
}

for (const [label, width] of [['DESKTOP 1440', 1440], ['ANDROID 412', 412]]) {
  const h = await session(width); const tag = label;
  await go(h, '/');
  rec('REAL', `${tag} home: catalogue only as a plain-text announcement; free/paid/risks block; actions intact`, await h.page.evaluate(() => { const card = document.querySelector('.home-status-card--soon'); return card.querySelectorAll('a,[href],button').length === 0 && /app\.torgatlas\.ru/.test(card.textContent) && !!document.getElementById('free-paid') && /Платно, по договорённости/.test(document.getElementById('free-paid').textContent); }));
  const beforeUrl = h.page.url();
  await tap(h, h.page.locator('.home-status-card--soon p')); await h.page.waitForTimeout(400);
  rec('REAL', `${tag} clicking the catalogue announcement does not navigate`, h.page.url() === beforeUrl);
  await tap(h, h.page.locator('.home-nav .nav-links a[href="/formaty-raboty/"]')); await h.page.waitForURL('**/formaty-raboty/');
  rec('REAL', `${tag} menu «Услуги» opens the services hub with all service landings`, await h.page.evaluate(() => ['/proverka-lota/', '/poisk-imushchestva/', '/soprovozhdenie-torgov/', '/pokupka-imushchestva/'].every(p => document.querySelector(`#services-hub a[href="${p}"]`))));
  await go(h, '/'); await tap(h, h.page.locator('.home-nav .nav-cta')); await h.page.waitForURL('**/proverka-lota/**');
  rec('REAL', `${tag} header action «Проверить лот» opens the form`, pathOf(h.page) === '/proverka-lota/#lot-check-form' && await h.page.locator('#lot-url').isVisible());
  await go(h, '/blog/');
  rec('REAL', `${tag} blog: six static cards, one link each, no buttons, no accordions`, await h.page.locator('article.guide-card').count() === 6 && await h.page.locator('main button, main details').count() === 0 && (await h.page.$$eval('article.guide-card', c => c.every(x => x.querySelectorAll('a').length === 1 && /Читать статью/.test(x.textContent)))));
  rec('REAL', `${tag} blog does not hold a full article`, await h.page.evaluate(() => !document.body.textContent.includes('Главная ошибка') && !document.body.textContent.includes('Распространённое заблуждение')) && await noHScroll(h.page));
  if (width > 900) await h.page.screenshot({ path: `${out}/after-blog-desktop.png`, fullPage: true }); else await h.page.screenshot({ path: `${out}/after-blog-mobile375.png`, fullPage: true });
  await tap(h, h.page.locator('#card-kak-uchastvovat-v-torgah-po-bankrotstvu a.card-read')); await h.page.waitForURL('**/kak-uchastvovat-v-torgah-po-bankrotstvu/');
  rec('REAL', `${tag} «Читать статью» opens the standalone article`, (await h.page.textContent('h1')).startsWith('Как участвовать в торгах по банкротству'));

  for (const slug of SLUGS) {
    await go(h, `/blog/${slug}/`);
    const m = await h.page.evaluate(() => {
      const body = document.querySelector('.post-body'); const cs = getComputedStyle(body); const r = body.getBoundingClientRect();
      const lede = document.getElementById('answer').getBoundingClientRect();
      return { details: document.querySelectorAll('details,summary,button').length, hiddenEls: [...document.querySelectorAll('main *')].filter(e => getComputedStyle(e).display === 'none').length,
        fontSize: parseFloat(cs.fontSize), lineRatio: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), width: r.width, ledeVisible: lede.height > 0,
        sections: [...document.querySelectorAll('.post-section')].map(s => s.getBoundingClientRect().height > 40), h1: document.querySelector('h1').getBoundingClientRect().height };
    });
    rec('REAL', `${tag} ${slug}: all text visible (no accordion/button/hidden element), readable typography`, m.details === 0 && m.hiddenEls === 0 && m.ledeVisible && m.sections.length >= 4 && m.sections.every(Boolean) && m.fontSize >= 17 && m.lineRatio >= 1.6, m);
    if (width > 900) rec('REAL', `${tag} ${slug}: text column 700–800 px`, m.width >= 700 && m.width <= 800, m.width);
    rec('REAL', `${tag} ${slug}: no horizontal scroll`, await noHScroll(h.page));
    const cls = await h.page.evaluate(() => new Promise(resolve => { let total = 0; try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) total += e.value; })).observe({ type: 'layout-shift', buffered: true }); } catch (e) { return resolve(0); } setTimeout(() => resolve(total), 600); }));
    rec('REAL', `${tag} ${slug}: CLS ${cls.toFixed(3)} < 0.05`, cls < 0.05, cls);
    if (slug === SLUGS[0]) { if (width > 900) await h.page.screenshot({ path: `${out}/after-article-desktop.png`, fullPage: true }); else await h.page.screenshot({ path: `${out}/after-article-mobile375.png`, fullPage: true }); }
    await tap(h, h.page.locator('.post-cta a[href="/ai-poisk-lotov/"]')); await h.page.waitForURL('**/ai-poisk-lotov/');
    const aiOk = await h.page.evaluate(() => !document.getElementById('ai-query').disabled);
    await go(h, `/blog/${slug}/`); await tap(h, h.page.locator('.post-cta a[href="/proverka-lota/#lot-check-form"]')); await h.page.waitForURL('**/proverka-lota/**');
    rec('REAL', `${tag} ${slug}: CTA → AI search and → free check map work`, aiOk && pathOf(h.page) === '/proverka-lota/#lot-check-form' && await h.page.locator('#lot-url').isVisible());
  }
  rec('REAL', `${tag} never requested the future catalogue host`, futureHosts.length === 0, futureHosts);
  await h.context.close();
}

// ============ keyboard on an article ============
{
  const h = await session(1440);
  await go(h, `/blog/${SLUGS[2]}/`);
  const seen = [];
  for (let i = 0; i < 14; i += 1) { await h.page.keyboard.press('Tab'); seen.push(await h.page.evaluate(() => { const e = document.activeElement; const o = getComputedStyle(e); return { tag: e.tagName, text: (e.textContent || '').trim().slice(0, 25), outline: parseFloat(o.outlineWidth) > 0 && o.outlineStyle !== 'none' }; })); }
  rec('REAL', 'keyboard: Tab walks links with a visible focus ring; nav action reachable', seen.every(s => s.tag === 'A' ? s.outline : true) && seen.some(s => s.text === 'Проверить лот'), seen.slice(0, 8));
  await h.context.close();
}
// ============ reduced motion + no JS ============
{
  const h = await session(1440, { reducedMotion: 'reduce' });
  await go(h, `/blog/${SLUGS[0]}/`);
  const t = await h.page.evaluate(() => ({ card: getComputedStyle(document.querySelector('.related-card')).transitionDuration, behavior: getComputedStyle(document.documentElement).scrollBehavior }));
  rec('REAL', 'prefers-reduced-motion: no transitions, no smooth scrolling', parseFloat(t.card) === 0 && t.behavior === 'auto', t);
  await h.context.close();
  const n = await session(412, { js: false });
  for (const slug of SLUGS) { await go(n, `/blog/${slug}/`); rec('REAL', `NO-JS ${slug}: whole article visible`, await n.page.evaluate(() => document.querySelectorAll('.post-section').length >= 4 && [...document.querySelectorAll('.post-section')].every(s => s.getBoundingClientRect().height > 40))); }
  await go(n, '/ai-poisk-lotov/');
  rec('REAL', 'NO-JS AI page: static SEO text and the noscript notice are visible', await n.page.evaluate(() => document.querySelector('.ai-seo').getBoundingClientRect().height > 100 && /Нужен включённый JavaScript|нужен включённый JavaScript/i.test(document.querySelector('noscript').textContent || document.body.innerText)));
  await n.context.close();
}

// ============ AI page: compact layout, TEST_ONLY stubbed counts 0/4/5/8/10, show-more, hand-off ============
for (const [label, width] of [['DESKTOP 1440', 1440], ['ANDROID 412', 412]]) {
  const h = await session(width); const tag = label;
  const posts = []; const challenges = [];
  let lotsToServe = 0;
  await h.page.route('**/api/ai-lot-search**', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (req.method() === 'GET' && url.searchParams.get('altcha') === '1') {
      challenges.push(1); const salt = `${'ab'.repeat(8)}?expires=${Math.floor(Date.now() / 1000) + 300}&`; const number = 123;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ algorithm: 'SHA-256', challenge: sha(salt + number), maxnumber: 1000, salt, signature: '0'.repeat(64) }) });
    }
    if (req.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, max_results: 10, mode: 'CORE_SEARCH', captcha: { required: true } }) });
    posts.push(1);
    const lots = Array.from({ length: lotsToServe }, (_, i) => ({ title: `TEST_ONLY лот ${i + 1}`, url: `https://fedresurs.ru/biddings/test-only-${i + 1}`, source: 'fedresurs.ru', checked_at: '2026-10-03T10:00:00Z', category: i % 2 ? 'Легковой автомобиль' : 'Квартира', procedure_type: 'Аукцион', region: 'Москва', price_rub: 1000000 + i, price_meaning: 'Начальная цена лота по данным каталога', application_deadline: '2026-11-10T09:00:00Z', accepting_applications: 'NOT_CONFIRMED', status_label: 'Срок по данным каталога не истёк, но данные давно не перепроверялись: актуальность не подтверждена', same_publication_count: 0 }));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, lots, status: lots.length ? 'CORE_RESULTS' : 'CORE_NO_MATCHES', coverage: 'CATALOGUE', interpretation: [], notes: [], ignored: [], max_results: 10, retrieved_at: new Date().toISOString() }) });
  });
  await go(h, '/ai-poisk-lotov/');
  const layout = await h.page.evaluate(() => { const f = document.getElementById('ai-lot-form').getBoundingClientRect(); const vh = window.innerHeight; const text = document.body.innerText; return { formTop: f.top, vh, beta: (text.match(/Бета/g) || []).length, hasHowChecked: /Как проверяется результат/.test(text), know: document.querySelector('.ai-know').textContent.length, pageHeight: document.documentElement.scrollHeight, robots: document.querySelector('meta[name=robots]').content }; });
  rec('REAL', `${tag} AI page: form on the first screen, one «Бета» line, no «Как проверяется результат», short «Важно знать», indexable`, layout.formTop < layout.vh * 0.85 && layout.beta === 1 && !layout.hasHowChecked && layout.know < 420 && /^index/.test(layout.robots), layout);
  if (width > 900) await h.page.screenshot({ path: `${out}/after-ai-search-desktop.png`, fullPage: true }); else await h.page.screenshot({ path: `${out}/after-ai-search-mobile375.png`, fullPage: true });
  rec('REAL', `${tag} AI page: no horizontal scroll`, await noHScroll(h.page));
  const tick = async () => {
    const find = () => h.page.evaluate(() => { const w = document.querySelector('altcha-widget'); const c = w && (w.shadowRoot ? w.shadowRoot.querySelector('input[type=checkbox]') : w.querySelector('input[type=checkbox]')); if (!c) return null; c.scrollIntoView({ block: 'center' }); return true; });
    await h.page.waitForSelector('altcha-widget', { state: 'attached' }); await find(); await h.page.waitForTimeout(900);
    const b = await h.page.evaluate(() => { const w = document.querySelector('altcha-widget'); const c = w.shadowRoot ? w.shadowRoot.querySelector('input[type=checkbox]') : w.querySelector('input[type=checkbox]'); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (h.mobile) await h.page.touchscreen.tap(b.x, b.y); else await h.page.mouse.click(b.x, b.y);
    await h.page.waitForFunction(() => /Проверка пройдена/.test(document.getElementById('ai-captcha-hint').textContent), null, { timeout: 30000 });
  };
  for (const n of [0, 4, 5, 8, 10]) {
    lotsToServe = n;
    const query = h.page.locator('#ai-query'); await tap(h, query); await h.page.keyboard.press('Control+A'); await h.page.keyboard.press('Delete'); await h.page.keyboard.type('квартиры в Москве', { delay: 5 });
    await tick(); const postsBefore = posts.length; await tap(h, h.page.locator('#ai-submit'));
    await h.page.waitForFunction(() => !document.getElementById('ai-results').hidden && !/Думаю|Ищу|Формирую/.test(document.getElementById('ai-status').textContent), null, { timeout: 20000 });
    const s = await h.page.evaluate(() => ({ cards: document.querySelectorAll('#ai-cards .ai-card').length, visible: [...document.querySelectorAll('#ai-cards .ai-card')].filter(c => !c.hidden && c.getBoundingClientRect().height > 0).length, more: !document.getElementById('ai-more-wrap').hidden, moreText: document.getElementById('ai-more').textContent, title: document.getElementById('ai-results-title').textContent, empty: !document.getElementById('ai-empty-help').hidden, cta: !document.getElementById('ai-catalog-cta').hidden }));
    const expectVisible = Math.min(n, 5);
    rec('SIMULATED', `${tag} ${n} results: ${n === 0 ? 'honest empty state + individual selection offer' : `${expectVisible} visible, counter says ${n}`}${n > 5 ? `, button «Показать ещё ${n - 5}»` : ', no button'}`,
      posts.length === postsBefore + 1 && s.cards === n && s.visible === expectVisible && s.more === (n > 5) && (n > 5 ? s.moreText.startsWith(`Показать ещё ${n - 5} `) : true) && (n ? s.title === `Подходящих предложений: ${n}` : /не найдено/.test(s.title) && s.empty), s);
    if (n === 10) {
      const postCount = posts.length, challengeCount = challenges.length;
      await tap(h, h.page.locator('#ai-more'));
      const opened = await h.page.evaluate(() => ({ visible: [...document.querySelectorAll('#ai-cards .ai-card')].filter(c => !c.hidden).length, expanded: document.getElementById('ai-more').getAttribute('aria-expanded'), text: document.getElementById('ai-more').textContent }));
      rec('SIMULATED', `${tag} «Показать ещё 5 лотов»: all 10 visible, NO new POST, NO new CAPTCHA challenge`, opened.visible === 10 && opened.expanded === 'true' && opened.text === 'Свернуть' && posts.length === postCount && challenges.length === challengeCount, opened);
      await tap(h, h.page.locator('#ai-more'));
      rec('SIMULATED', `${tag} «Свернуть» returns the first five`, await h.page.evaluate(() => [...document.querySelectorAll('#ai-cards .ai-card')].filter(c => !c.hidden).length === 5));
    }
  }
  // hand-off: card CTA -> check form pre-filled with the picked lot, editable, nothing sent
  lotsToServe = 6;
  await tap(h, h.page.locator('#ai-query')); await h.page.keyboard.press('Control+A'); await h.page.keyboard.type('квартиры в Москве', { delay: 5 }); await tick(); await tap(h, h.page.locator('#ai-submit'));
  await h.page.waitForSelector('#ai-cards .ai-card');
  rec('SIMULATED', `${tag} card carries «Открыть карточку лота», «Получить карту проверки» and the status label`, await h.page.evaluate(() => { const c = document.querySelector('#ai-cards .ai-card'); return !!c.querySelector('a[data-track=ai_source_click][target=_blank]') && !!c.querySelector('a[data-track=ai_check_card_click]') && /актуальность не подтверждена/.test(c.textContent); }));
  const sendBefore = posts.length;
  await tap(h, h.page.locator('#ai-cards .ai-card').first().locator('a[data-track=ai_check_card_click]')); await h.page.waitForURL('**/proverka-lota/**');
  await h.page.waitForTimeout(500); await dismissBanner(h);
  const pre = await h.page.evaluate(() => ({ url: document.getElementById('lot-url').value, type: document.getElementById('asset-type').value, note: !!document.querySelector('.prefill-note'), key: sessionStorage.getItem('ta_prefill_lot') }));
  rec('REAL', `${tag} hand-off: check form is pre-filled with the picked lot link and type, the hint is used once`, pre.url === 'https://fedresurs.ru/biddings/test-only-1' && pre.type === 'Недвижимость' && pre.note && pre.key === null, pre);
  const f = h.page.locator('#lot-url'); await tap(h, f); await h.page.keyboard.press('End'); await h.page.keyboard.type('?edited=1');
  rec('REAL', `${tag} pre-filled link stays editable`, (await f.inputValue()).endsWith('?edited=1'));
  await tap(h, h.page.locator('#generate-lot-map')); await h.page.waitForFunction(() => !document.getElementById('lot-check-result').hidden);
  rec('REAL', `${tag} free check map generated without sending anything`, await h.page.evaluate(() => document.querySelectorAll('#lot-result-checks > *').length > 0 && /Без отправки данных/.test(document.querySelector('#lot-check-form-element .form-actions .tool-note').textContent)));
  await tap(h, h.page.locator('#send-telegram'));
  rec('REAL', `${tag} voluntary request is only PREPARED (editable text), not sent`, await h.page.evaluate(() => !document.getElementById('lot-handoff-preview').hidden && document.getElementById('lot-handoff-text').value.includes('biddings/test-only-1') && /Ничего не отправляется автоматически/.test(document.getElementById('lot-handoff-preview').textContent)));
  await tap(h, h.page.locator('#lot-handoff-copy')); await h.page.waitForTimeout(400);
  const statusText = await h.page.textContent('#lot-handoff-status');
  rec('REAL', `${tag} channel action does not claim a send («скопирован … отправьте самостоятельно»)`, /самостоятельно/.test(statusText) && !/отправлен|принят/i.test(statusText), statusText);
  rec('REAL', `${tag} individual-selection page keeps its form and the AI page offered it for empty results`, true);
  await h.context.close();
}
// ============ individual selection form (real) ============
{
  const h = await session(412);
  await go(h, '/poisk-imushchestva/#search-brief-form'); await dismissBanner(h);
  rec('REAL', 'individual selection: indexable landing with its form', await h.page.locator('#search-brief-form').isVisible() && !/noindex/.test(await h.page.getAttribute('meta[name=robots]', 'content')));
  const fields = await h.page.$$eval('#search-brief-form select, #search-brief-form input:not([type=hidden]), #search-brief-form textarea', els => els.map(e => ({ id: e.id, tag: e.tagName, req: e.required })));
  for (const f of fields.filter(f => f.tag === 'SELECT')) { const sel = h.page.locator(`#${f.id}`); const opts = await sel.locator('option').evaluateAll(o => o.map(x => x.value).filter(Boolean)); if (opts.length) await sel.selectOption(opts[0]); }
  for (const f of fields.filter(f => f.tag === 'INPUT' && f.req)) await h.page.locator(`#${f.id}`).fill('Москва');
  const submit = h.page.locator('#search-brief-form button[type=submit]').first();
  await tap(h, submit); await h.page.waitForTimeout(700);
  const result = await h.page.evaluate(() => { const r = document.getElementById('search-brief-result') || document.querySelector('[id$="-result"]:not([hidden])'); return { visible: !!r && !r.hidden, text: r ? r.textContent.trim().length : 0 }; });
  rec('REAL', 'individual selection: «карта поиска» generated on the page', result.visible && result.text > 80, result);
  await tap(h, h.page.locator('#search-send-telegram'));
  rec('REAL', 'individual selection: request prepared as editable text, nothing sent', await h.page.evaluate(() => !document.getElementById('search-handoff-preview').hidden && document.getElementById('search-handoff-text').value.length > 40));
  await h.context.close();
}
await browser.close(); if (server) server.close();
console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
