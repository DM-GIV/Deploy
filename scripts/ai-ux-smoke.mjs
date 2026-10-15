/* Real-interaction check of the public AI search form. Nothing sets textarea.value or calls fetch() directly:
 * the page is driven with real mouse/touch coordinates, the keyboard and a real clipboard paste.
 * Usage: node scripts/ai-ux-smoke.mjs <baseUrl> <warm|check> <outDir>
 *   warm   : populate a persistent browser profile (HTTP cache) with whatever JS/CSS the site currently serves (run BEFORE a release)
 *   check  : full run. Every scenario is labelled REAL (real input + real server) or SIMULATED (browser-layer failure injection).
 * Real searches are spaced >= 36 s apart (public rate limit is 2 POST/min per IP) and kept to a handful. */
import fs from 'node:fs';
import playwright from '/pw/playwright/driver/package/index.js';

const [base = 'https://torgatlas.ru', phase = 'check', out = '/out'] = process.argv.slice(2);
const URL_PAGE = `${base}/ai-poisk-lotov/`;
const API = '**/api/ai-lot-search';
const results = [];
const rec = (id, ok, kind, evidence) => { results.push({ id, status: ok ? 'PASS' : 'FAIL', kind, evidence }); console.log(ok ? 'PASS' : 'FAIL', kind, id, JSON.stringify(evidence).slice(0, 300)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const launchOpts = { executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] };
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

if (phase === 'warm') {
  const context = await playwright.chromium.launchPersistentContext(`${out}/profile-warm`, { ...launchOpts, viewport: { width: 1280, height: 900 } });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(URL_PAGE, { waitUntil: 'networkidle' });
  const info = await page.evaluate(() => ({ disabled: document.getElementById('ai-query').disabled, scripts: [...document.scripts].map(s => s.src).filter(Boolean) }));
  console.log('WARM profile cached', JSON.stringify(info));
  await context.close();
  process.exit(0);
}

const browser = await playwright.chromium.launch(launchOpts);
async function open(width, opts = {}) {
  const mobile = width < 500;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, userAgent: mobile ? MOBILE_UA : undefined, isMobile: mobile, hasTouch: mobile, permissions: ['clipboard-read', 'clipboard-write'], ...opts.context });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const posts = []; const pageErrors = []; const ta = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/ai-lot-search' && r.method() === 'POST') posts.push(Date.now()); if (u.pathname.startsWith('/ta/')) ta.push(u.pathname); });
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 120)));
  if (opts.before) await opts.before(page, context);
  await page.goto(URL_PAGE, { waitUntil: 'load' });
  return { context, page, posts, pageErrors, ta, mobile };
}
async function point(page, selector) {
  const loc = page.locator(selector); await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function realClick(h, selector) { const { x, y } = await point(h.page, selector); if (h.mobile) await h.page.touchscreen.tap(x, y); else await h.page.mouse.click(x, y); }
const focusedId = page => page.evaluate(() => document.activeElement && document.activeElement.id);
const value = page => page.inputValue('#ai-query');
const statusText = page => page.textContent('#ai-status');
async function typeReal(h, text) { await realClick(h, '#ai-query'); await h.page.keyboard.press('Control+A'); await h.page.keyboard.press('Delete'); await h.page.keyboard.type(text, { delay: 15 }); }
const waitResults = page => page.waitForFunction(() => !document.getElementById('ai-results').hidden, null, { timeout: 40000 });
async function cardsInfo(page) {
  return page.$$eval('#ai-cards .ai-card', cs => cs.map(c => ({ title: c.querySelector('h3')?.textContent.slice(0, 50), href: c.querySelector('a[target=_blank]')?.href, text: c.textContent })));
}
const okHref = h => /^https:\/\/bankrupt\.(utpl|etpu|centerr)\.ru\/public\/(auctions|public-offers)\/lots\/view\/\d+\/$/.test(h || '');

// ---- 0. published HTML itself (a plain HTTP fetch, not the DOM after JS) -------------------------------------------------------------
{
  const res = await fetch(URL_PAGE); const html = await res.text();
  const bad = /<textarea[^>]*\sdisabled|id="ai-submit"[^>]*\sdisabled/.test(html);
  rec('published HTML: textarea and submit are NOT disabled', res.status === 200 && !bad, 'REAL', { status: res.status, has_noscript: /<noscript>/.test(html), script: (html.match(/ai-search\.js\?v=\d+/) || [])[0] });
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const banned = /УТПЛ|УЭТП|Центр реализации|ГИС|torgi\.gov|ЕФРСБ|МЭТС|Объединённая торговая|не подключен|отключен/i;
  rec('PUBLIC_SOURCE_TEXT: no marketplace names / counts / disabled-source notes in page text and meta description', !banned.test(visible) && !banned.test(desc) && visible.includes('ТоргАтлас использует открытые сведения, опубликованные на электронных торговых площадках, для поиска и отображения предложений об имуществе. Результаты сопровождаются ссылками на первоисточники. Актуальность и условия участия необходимо проверить перед покупкой.'), 'REAL', { description: desc });
}

// ---- 1. desktop, fresh (cold cache) session: mouse focus, keyboard typing, button click, real result ----------------------------------
let h = await open(1440);
try {
  const early = await h.page.evaluate(() => ({ q: document.getElementById('ai-query').disabled, b: document.getElementById('ai-submit').disabled, ready: window.__aiSearchReady === true }));
  rec('COLD_CACHE desktop: field and button enabled right after load, script ready', !early.q && !early.b && early.ready && h.pageErrors.length === 0, 'REAL', { ...early, pageErrors: h.pageErrors });
  await realClick(h, '#ai-query');
  rec('INPUT_MOUSE desktop: real mouse click puts the cursor in the textarea', (await focusedId(h.page)) === 'ai-query', 'REAL', {});
  await h.page.keyboard.type('найди транспорт на торгах банкротов', { delay: 15 });
  const typed = await value(h.page);
  rec('INPUT_KEYBOARD desktop: ordinary typing works', typed === 'найди транспорт на торгах банкротов', 'REAL', { typed });
  const t0 = Date.now(); await realClick(h, '#ai-submit');
  const thinking = await h.page.waitForFunction(() => /Думаю/.test(document.getElementById('ai-status').textContent), null, { timeout: 3000 }).then(() => Date.now() - t0).catch(() => -1);
  const busyBtn = await h.page.evaluate(() => ({ disabled: document.getElementById('ai-submit').disabled, text: document.getElementById('ai-submit').textContent, cancel: !document.getElementById('ai-cancel').hidden }));
  await waitResults(h.page);
  const cards = await cardsInfo(h.page); const cov = await h.page.textContent('#ai-results-coverage');
  rec('SUBMIT_CLICK + REAL_POST + RESULT_RENDER desktop: «Думаю…», real results with primary-source links and check dates', thinking >= 0 && h.posts.length === 1 && cards.length >= 1 && cards.every(c => okHref(c.href) && /Проверено:/.test(c.text)) && busyBtn.disabled && busyBtn.cancel, 'REAL', { thinking_ms: thinking, total_ms: Date.now() - t0, posts: h.posts.length, cards: cards.length, sample: cards.slice(0, 2).map(c => c.href), busyBtn });
  rec('PUBLIC_SOURCE_TEXT: coverage text shown after a result is the neutral caveat (no platform list)', !/УТПЛ|УЭТП|Центр реализации|ГИС|площадок|ОТП/i.test(cov), 'REAL', { coverage: cov.slice(0, 160) });
  const afterBtn = await h.page.evaluate(() => ({ disabled: document.getElementById('ai-submit').disabled, text: document.getElementById('ai-submit').textContent, value: document.getElementById('ai-query').value }));
  rec('desktop: button returns to ready state after the result and the query text is kept', !afterBtn.disabled && afterBtn.text === 'Найти лоты' && afterBtn.value.length > 11, 'REAL', afterBtn);
  await sleep(36000);
  // repeat search from the same session using Enter
  await typeReal(h, 'найди оборудование на торгах банкротов');
  const before = h.posts.length; await h.page.keyboard.press('Enter');
  await h.page.waitForFunction(() => /Думаю|Ищу/.test(document.getElementById('ai-status').textContent), null, { timeout: 3000 });
  await h.page.waitForFunction(() => /Результаты сформированы|не подтверждены|временно недоступен|занят/.test(document.getElementById('ai-status').textContent), null, { timeout: 40000 });
  const cards2 = await cardsInfo(h.page);
  rec('SUBMIT_ENTER + repeat search desktop: Enter sends, second real search renders new results', h.posts.length === before + 1 && cards2.length >= 1 && cards2.every(c => okHref(c.href)), 'REAL', { posts: h.posts.length, cards: cards2.length, first: cards2[0]?.title });
  await h.page.screenshot({ path: `${out}/ux-desktop-results.png`, fullPage: true });
  rec('analytics: no /ta/ requests before consent during the whole search session', h.ta.length === 0, 'REAL', { ta: h.ta });
} catch (e) { rec('desktop interactive session', false, 'REAL', { error: String(e.message).slice(0, 200) }); }
await h.context.close();
await sleep(36000);

// ---- 2. mobile, fresh session: tap, REAL clipboard paste, example button, tap submit -------------------------------------------------
h = await open(390);
try {
  await realClick(h, '#ai-query');
  rec('INPUT_MOUSE mobile: real tap puts the cursor in the textarea', (await focusedId(h.page)) === 'ai-query', 'REAL', {});
  await h.page.evaluate(() => navigator.clipboard.writeText('найди недвижимость на публичном предложении')); // clipboard SETUP only
  await h.page.keyboard.press('Control+V');
  const pasted = await value(h.page);
  rec('INPUT_PASTE mobile: real paste (Ctrl+V into the focused field)', pasted === 'найди недвижимость на публичном предложении', 'REAL', { pasted });
  await realClick(h, '.ai-example[data-query*="оборудование"]');
  const ex = await value(h.page);
  rec('example button fills the field and focuses it', /оборудование/.test(ex) && (await focusedId(h.page)) === 'ai-query', 'REAL', { ex });
  await typeReal(h, 'найди недвижимость на публичном предложении');
  const over = await h.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const t0 = Date.now(); await realClick(h, '#ai-submit');
  await waitResults(h.page);
  const cards = await cardsInfo(h.page);
  rec('MOBILE: tap submit -> real POST -> cards with primary-source links, no horizontal scroll', h.posts.length === 1 && cards.length >= 1 && cards.every(c => okHref(c.href)) && over <= 0, 'REAL', { cards: cards.length, posts: h.posts.length, overflow_px: over, total_ms: Date.now() - t0 });
  await h.page.screenshot({ path: `${out}/ux-mobile-results.png`, fullPage: true });
} catch (e) { rec('mobile interactive session', false, 'REAL', { error: String(e.message).slice(0, 200) }); }
await h.context.close();
await sleep(36000);

// ---- 3. failed preliminary GET + failed first POST, then recovery with a REAL search ----------------------------------------------------
let failGetAbort = 0, postAborts = 0;
h = await open(1440, { before: async page => {
  await page.route(API, route => {
    const m = route.request().method();
    if (m === 'GET') { failGetAbort += 1; return route.abort('failed'); }
    if (m === 'POST' && postAborts < 1) { postAborts += 1; return route.abort('connectionreset'); }
    return route.continue();
  });
} });
try {
  await h.page.waitForTimeout(1500);
  const st = await h.page.evaluate(() => ({ q: document.getElementById('ai-query').disabled, b: document.getElementById('ai-submit').disabled, text: document.getElementById('ai-submit').textContent }));
  rec('GET_FAILURE_RECOVERY (SIMULATED GET failure): field and button stay enabled', failGetAbort >= 1 && !st.q && !st.b && st.text === 'Найти лоты', 'SIMULATED', { get_aborts: failGetAbort, ...st });
  await typeReal(h, 'найди оборудование на торгах банкротов');
  await realClick(h, '#ai-submit');
  await h.page.waitForFunction(() => /Нет связи/.test(document.getElementById('ai-status').textContent), null, { timeout: 8000 });
  const kept = await h.page.evaluate(() => ({ v: document.getElementById('ai-query').value, b: document.getElementById('ai-submit').disabled, t: document.getElementById('ai-submit').textContent, cancelHidden: document.getElementById('ai-cancel').hidden }));
  rec('network failure on POST (SIMULATED): clear message, text kept, button ready again', kept.v.includes('оборудование') && !kept.b && kept.t === 'Найти лоты' && kept.cancelHidden, 'SIMULATED', kept);
  const t0 = Date.now(); await realClick(h, '#ai-submit');
  await waitResults(h.page);
  const cards = await cardsInfo(h.page);
  rec('GET_FAILURE_RECOVERY: after failed GET + failed POST the SAME page re-sends and gets REAL results (no reload)', cards.length >= 1 && cards.every(c => okHref(c.href)) && postAborts === 1, 'REAL', { cards: cards.length, total_ms: Date.now() - t0, title: await h.page.textContent('#ai-results-title') });
} catch (e) { rec('GET failure recovery', false, 'REAL', { error: String(e.message).slice(0, 200) }); }
await h.context.close();

// ---- 4. simulated server/timeout/cancel/double-submit (no load on the server) ---------------------------------------------------------
{ // server errors map to clear messages and never leave the button disabled
  const cases = [[429, { ok: false, code: 'RATE_LIMITED' }, /Слишком много/], [503, { ok: false, code: 'NOT_ENABLED' }, /временно недоступен/], [502, null, /временно недоступен/], [403, { ok: false, code: 'ORIGIN_DENIED' }, /защитой/], [200, { nope: 1 }, /неожиданный/]];
  for (const [code, body, re] of cases) {
    const hh = await open(1440, { before: p => p.route(API, r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true}' }) : r.fulfill({ status: code, contentType: body ? 'application/json' : 'text/html', body: body ? JSON.stringify(body) : '<html>502 Bad Gateway</html>' })) });
    await typeReal(hh, 'найди оборудование на торгах банкротов'); await realClick(hh, '#ai-submit');
    await hh.page.waitForFunction(() => !/Думаю|Ищу/.test(document.getElementById('ai-status').textContent) && !document.getElementById('ai-submit').disabled, null, { timeout: 8000 });
    const s = await statusText(hh.page); const v = await value(hh.page);
    rec(`HTTP ${code} response (SIMULATED): readable message, text kept, button re-enabled`, re.test(s) && v.length > 11 && !/Bad Gateway/.test(s), 'SIMULATED', { status: s.slice(0, 110) });
    await hh.context.close();
  }
}
{ // double submit + cancel with a held request
  let held = 0; const hh = await open(1440, { before: p => p.route(API, r => { if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true}' }); held += 1; /* never answered */ }) });
  await typeReal(hh, 'найди транспорт на торгах банкротов');
  await realClick(hh, '#ai-submit'); await hh.page.keyboard.press('Enter'); await realClick(hh, '#ai-submit').catch(() => {});
  await hh.page.waitForTimeout(600);
  rec('double submit (button, Enter, button again) sends exactly ONE request', held === 1, 'SIMULATED', { requests: held });
  await realClick(hh, '#ai-cancel');
  await hh.page.waitForFunction(() => /отменён/.test(document.getElementById('ai-status').textContent), null, { timeout: 4000 });
  const st = await hh.page.evaluate(() => ({ v: document.getElementById('ai-query').value, b: document.getElementById('ai-submit').disabled, cancelHidden: document.getElementById('ai-cancel').hidden }));
  rec('cancel a running request: message, text kept, button ready, can start again', st.v.length > 11 && !st.b && st.cancelHidden, 'SIMULATED', st);
  await realClick(hh, '#ai-submit'); await hh.page.waitForTimeout(400);
  rec('search can be started again after cancel without reload', held === 2, 'SIMULATED', { requests: held });
  await hh.context.close();
}
{ // 24 s client timeout
  const hh = await open(1440, { before: p => p.route(API, r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true}' }) : undefined) });
  await typeReal(hh, 'найди транспорт на торгах банкротов'); await realClick(hh, '#ai-submit');
  await hh.page.waitForFunction(() => /Время ожидания истекло/.test(document.getElementById('ai-status').textContent), null, { timeout: 30000 });
  const st = await hh.page.evaluate(() => ({ v: document.getElementById('ai-query').value.length, b: document.getElementById('ai-submit').disabled }));
  rec('client timeout after 24 s (SIMULATED hung server): message, button ready, text kept', st.v > 11 && !st.b, 'SIMULATED', st);
  await hh.context.close();
}

// ---- 5. JavaScript blocked / failed to load -------------------------------------------------------------------------------------------
{
  let posts = 0;
  const hh = await open(1440, { before: async p => { await p.route('**/assets/ai-search.js*', r => r.abort('blockedbyclient')); p.on('request', r => { if (r.method() === 'POST') posts += 1; }); } });
  await realClick(hh, '#ai-query'); await hh.page.keyboard.type('найди транспорт на торгах', { delay: 10 }); await realClick(hh, '#ai-submit');
  const s = await statusText(hh.page);
  rec('external JS blocked (SIMULATED): visible message instead of a silently dead form; typing still possible; nothing sent', /Скрипт поиска не загрузился/.test(s) && (await value(hh.page)).length > 11 && posts === 0, 'SIMULATED', { status: s.slice(0, 90), posts });
  await hh.context.close();
  const c = await browser.newContext({ javaScriptEnabled: false }); const p = await c.newPage(); await p.goto(URL_PAGE);
  const ns = await p.locator('noscript').first().evaluate(n => n.textContent).catch(() => '');
  const visible = await p.locator('.ai-status[data-error="true"]').first().isVisible().catch(() => false);
  rec('JavaScript disabled in the browser: <noscript> notice is shown', /JavaScript/.test(ns) && visible, 'SIMULATED', { visible });
  await c.close();
}

// ---- 6. stale cache: a profile that cached the previously published JS/CSS must pick up the fixed page ---------------------------------
if (fs.existsSync(`${out}/profile-warm`)) {
  const context = await playwright.chromium.launchPersistentContext(`${out}/profile-warm`, { ...launchOpts, viewport: { width: 1280, height: 900 } });
  const page = context.pages()[0] || await context.newPage(); const scriptReq = [];
  page.on('response', r => { if (/\/assets\/ai-search\.js/.test(r.url())) scriptReq.push({ url: r.url().replace(base, ''), status: r.status(), fromCache: r.fromServiceWorker() ? 'sw' : (r.request().timing().responseStart <= 0 ? 'cache?' : 'network') }); });
  await page.goto(URL_PAGE, { waitUntil: 'load' });
  const h2 = { page, mobile: false };
  await realClick(h2, '#ai-query'); await page.keyboard.type('найди транспорт на торгах', { delay: 10 });
  const st = await page.evaluate(() => ({ q: document.getElementById('ai-query').disabled, b: document.getElementById('ai-submit').disabled, v: document.getElementById('ai-query').value, ready: window.__aiSearchReady === true }));
  rec('stale cache (profile primed with the previous JS): fixed page works, new versioned script is fetched', !st.q && !st.b && st.v.length > 11 && st.ready && scriptReq.some(r => /v=\d+/.test(r.url) && r.status === 200), 'REAL', { ...st, scriptReq });
  await context.close();
} else rec('stale cache: no primed profile (run phase "warm" before the release)', false, 'REAL', {});

fs.writeFileSync(`${out}/ai-ux-smoke.json`, JSON.stringify({ generated_at: new Date().toISOString(), base, results }, null, 1));
const fail = results.filter(r => r.status === 'FAIL').length;
console.log(`SUMMARY pass=${results.length - fail} fail=${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
