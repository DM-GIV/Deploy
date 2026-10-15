/* Public smoke against the live site. No form submissions, no consent clicks (no analytics events), no lead POSTs.
 * Usage: node scripts/public-smoke.mjs <baseUrl> <site|ai|all> <outDir>
 * Every AI scenario is labelled REAL (real request to the public API) or SIMULATED (browser-layer response injection). */
import fs from 'node:fs';
import playwright from '/pw/playwright/driver/package/index.js';

// SMOKE_LITE=1: skip the empty/cancel/429-burst real probes (keeps only the real queries + simulated UI states) to spare the sources.
const LITE = process.env.SMOKE_LITE === '1';
const [base = 'https://torgatlas.ru', mode = 'all', out = '/out'] = process.argv.slice(2);
const results = [];
const rec = (id, ok, kind, evidence) => { results.push({ id, status: ok ? 'PASS' : 'FAIL', kind, evidence }); console.log(ok ? 'PASS' : 'FAIL', kind, id, JSON.stringify(evidence).slice(0, 260)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const pages = ['/', '/poisk-imushchestva/', '/pokupka-imushchestva/', '/soprovozhdenie-torgov/', '/proverka-lota/', '/primery-lotov/', '/formaty-raboty/', '/o-torgatlas/', '/blog/', '/privacy/', '/ai-poisk-lotov/'];

async function ctx(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, userAgent: width < 500 ? 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' : undefined, isMobile: width < 500, hasTouch: width < 500 });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const taRequests = []; const consoleErrors = [];
  page.on('request', r => { if (/\/ta\//.test(new URL(r.url()).pathname)) taRequests.push(r.url()); });
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
  return { context, page, taRequests, consoleErrors };
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function keyboard(page) {
  const seen = []; await page.keyboard.press('Tab');
  for (let i = 0; i < 10; i += 1) {
    const info = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== 'none', visible: r.width > 0 && r.height > 0 }; });
    if (info) seen.push(info); await page.keyboard.press('Tab');
  }
  return { focusable: seen.length, withVisibleIndicator: seen.filter(s => s.visible && (s.outline || s.shadow)).length };
}

if (mode === 'site' || mode === 'all') {
  for (const width of [1440, 390]) {
    for (const route of pages) {
      const { context, page, taRequests, consoleErrors } = await ctx(width);
      try {
        const resp = await page.goto(base + route, { waitUntil: 'networkidle' });
        const h1 = await page.locator('h1').count(); const ov = await overflow(page); const kb = await keyboard(page);
        const noindex = await page.locator('meta[name=robots][content*=noindex]').count();
        rec(`page ${route} @${width}`, resp.status() === 200 && h1 >= 1 && ov <= 1 && kb.focusable >= 3 && kb.withVisibleIndicator >= Math.min(3, kb.focusable) && taRequests.length === 0,
          'REAL', { status: resp.status(), h1, horizontal_overflow_px: ov, keyboard: kb, analytics_requests_before_consent: taRequests.length, console_errors: consoleErrors.length, noindex });
      } catch (e) { rec(`page ${route} @${width}`, false, 'REAL', { error: String(e.message).slice(0, 160) }); }
      await context.close();
    }
  }
  // Home: eight rotation cards with external primary-source links, contact icons, consent banner without any analytics traffic.
  for (const width of [1440, 390]) {
    const { context, page, taRequests } = await ctx(width);
    try {
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      const cards = await page.$$eval('.rotation-case-card', cs => cs.map(c => ({ links: [...c.querySelectorAll('a[href^="https://"]')].map(a => new URL(a.href).hostname) })));
      const icons = await page.$$eval('.contact-icons .contact-icon', es => es.map(e => ({ tag: e.tagName, label: e.getAttribute('aria-label') || '', disabled: e.classList.contains('contact-icon--disabled'), box: [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)] })));
      const banner = await page.locator('[data-analytics-accept]').count();
      rec(`home cards+contacts @${width}`, cards.length === 8 && icons.filter(i => !i.disabled).length >= 4 && icons.every(i => i.label) && icons.filter(i => !i.disabled).every(i => i.box[0] >= 36 && i.box[1] >= 36) && taRequests.length === 0,
        'REAL', { rotation_cards: cards.length, cards_with_external_link: cards.filter(c => c.links.length).length, icons: icons.length, active_icons: icons.filter(i => !i.disabled).length, consent_banner: banner, analytics_requests: taRequests.length });
      if (width === 1440) await page.screenshot({ path: `${out}/home-${width}.png`, fullPage: false });
    } catch (e) { rec(`home cards+contacts @${width}`, false, 'REAL', { error: String(e.message).slice(0, 160) }); }
    await context.close();
  }
  // Free maps / forms exist and are keyboard-reachable (never submitted).
  { const { context, page } = await ctx(390);
    try {
      await page.goto(base + '/proverka-lota/', { waitUntil: 'networkidle' });
      const forms = await page.$$eval('form', fs_ => fs_.map(f => ({ id: f.id, inputs: f.querySelectorAll('input,textarea,select').length })));
      rec('free-map forms present (not submitted) /proverka-lota/', forms.length >= 1, 'REAL', { forms });
      await page.goto(base + '/primery-lotov/', { waitUntil: 'networkidle' });
      rec('examples page content /primery-lotov/', (await page.locator('a[href^="https://"]').count()) >= 5, 'REAL', { external_links: await page.locator('a[href^="https://"]').count() });
    } catch (e) { rec('free-map forms', false, 'REAL', { error: String(e.message).slice(0, 160) }); }
    await context.close(); }
  // Plain endpoints: robots, sitemap, llms, ALTCHA challenge (GET only), lead-config, Umami script (GET only).
  const ctxApi = await browser.newContext(); const api = ctxApi.request;
  for (const [path, expect] of [['/robots.txt', /User-agent|Sitemap/i], ['/sitemap.xml', /<urlset/], ['/llms.txt', /TorgAtlas|ТоргАтлас/i]]) {
    const r = await api.get(base + path); const t = await r.text(); rec(`GET ${path}`, r.status() === 200 && expect.test(t), 'REAL', { status: r.status(), bytes: t.length });
  }
  { const r = await api.get(base + '/api/lead-config'); const j = await r.json().catch(() => ({})); rec('GET /api/lead-config', r.status() === 200 && 'enabled' in j, 'REAL', { status: r.status(), enabled: j.enabled }); }
  { const r = await api.get(base + '/api/altcha-challenge'); const j = await r.json().catch(() => ({})); rec('GET /api/altcha-challenge (ALTCHA, no submit)', r.status() === 200 && !!(j.algorithm || j.challenge), 'REAL', { status: r.status(), keys: Object.keys(j).slice(0, 6) }); }
  { const r = await api.get(base + '/ta/s.js'); rec('GET /ta/s.js (Umami script, no events)', r.status() === 200 && /javascript/.test(r.headers()['content-type'] || ''), 'REAL', { status: r.status(), type: r.headers()['content-type'] }); }
  await ctxApi.close();
}

if (mode === 'ai' || mode === 'all') {
  const open = async (width, routeFn) => { const c = await ctx(width); if (routeFn) await c.page.route('**/api/ai-lot-search', routeFn); await c.page.goto(base + '/ai-poisk-lotov/', { waitUntil: 'networkidle' });
    await c.page.waitForFunction(() => !document.getElementById('ai-query').disabled, null, { timeout: 15000 }); return c; };
  const run = async (page, text) => { await page.fill('#ai-query', text); const t0 = Date.now(); await page.click('#ai-submit');
    const thinking = await page.waitForFunction(() => /Думаю/.test(document.getElementById('ai-status').textContent), null, { timeout: 3000 }).then(() => Date.now() - t0).catch(() => -1); return { t0, thinking }; };
  const real = [['транспорт', 'найди транспортные средства на торгах банкротов', 1440], ['оборудование', 'найди оборудование станки на торгах', 390], ['недвижимость', 'найди нежилое здание помещение на торгах', 390]];
  for (const [name, text, width] of real) {
    const { context, page, taRequests } = await open(width);
    try {
      const { t0, thinking } = await run(page, text);
      await page.waitForFunction(() => /Результаты сформированы|не подтверждены|временно недоступен|занят/.test(document.getElementById('ai-status').textContent), null, { timeout: 30000 });
      const ms = Date.now() - t0; const n = await page.locator('#ai-cards .ai-card').count();
      const cards = await page.$$eval('#ai-cards .ai-card', cs => cs.map(c => ({ title: c.querySelector('h3').textContent.slice(0, 60), href: c.querySelector('a[target=_blank]').href, price: (c.textContent.match(/(\d[\d\s ]*)\s*₽/) || [])[0] || null, until: (c.textContent.match(/Приём заявок до: ([^П]*?)(?=Возмож|Источник)/) || [])[1] || null })));
      const okHosts = cards.every(c => /^https:\/\/bankrupt\.(utpl|etpu|centerr)\.ru\/public\/(auctions|public-offers)\/lots\/view\/\d+\/$/.test(c.href));
      const pii = cards.some(c => /[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]*(?:вич|вна)/.test(c.title));
      await page.screenshot({ path: `${out}/ai-${name}-${width}.png`, fullPage: true });
      rec(`ai real query: ${name} @${width}`, thinking >= 0 && n >= 1 && okHosts && !pii && taRequests.length === 0, 'REAL', { thinking_visible_ms: thinking, total_ms: ms, cards: n, primary_source_links_ok: okHosts, pii_in_titles: pii, sample: cards.slice(0, 3) });
    } catch (e) { rec(`ai real query: ${name} @${width}`, false, 'REAL', { error: String(e.message).slice(0, 160) }); }
    await context.close(); await sleep(36000);
  }
  if (!LITE) { // REAL empty result
    const { context, page } = await open(390);
    try {
      await run(page, 'подводная лодка атомная торги');
      await page.waitForFunction(() => !document.getElementById('ai-results').hidden || /временно недоступен|занят/.test(document.getElementById('ai-status').textContent), null, { timeout: 30000 });
      const title = await page.textContent('#ai-results-title').catch(() => ''); const n = await page.locator('#ai-cards .ai-card').count();
      rec('ai real empty result', n === 0 && /не найдено|не завершён/.test(title), 'REAL', { title, cards: n });
    } catch (e) { rec('ai real empty result', false, 'REAL', { error: String(e.message).slice(0, 160) }); }
    await context.close(); await sleep(36000);
  }
  if (!LITE) { // REAL cancel
    const { context, page } = await open(390);
    try {
      await run(page, 'найди автомобиль грузовой на торгах банкротов');
      await page.waitForSelector('#ai-cancel:not([hidden])'); await page.click('#ai-cancel');
      await page.waitForFunction(() => /отменён/.test(document.getElementById('ai-status').textContent), null, { timeout: 5000 });
      rec('ai real cancel', await page.isEnabled('#ai-submit'), 'REAL', { status: (await page.textContent('#ai-status')).slice(0, 80) });
    } catch (e) { rec('ai real cancel', false, 'REAL', { error: String(e.message).slice(0, 160) }); }
    await context.close(); await sleep(36000);
  }
  if (!LITE) { // REAL 429 / BUSY at the public edge: burst of POSTs from one IP (same page context)
    const { context, page } = await open(1440);
    const codes = await page.evaluate(async () => { const out = []; for (let i = 0; i < 6; i += 1) { const r = await fetch('/api/ai-lot-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'нагрузочный запрос на торги ' + i + ' транспорт' }) }); const j = await r.json().catch(() => ({})); out.push([r.status, j.code || j.reason || j.status]); } return out; });
    rec('ai real rate limit 429 / BUSY at public edge', codes.some(c => c[0] === 429) && codes.every(c => c[0] === 200 || c[0] === 429), 'REAL', { responses: codes });
    await context.close(); await sleep(70000);
  }
  // SIMULATED visitor-facing error paths (browser-layer injection): source error, timeout result, BUSY result, 429, 502, hard UI timeout.
  const sims = [
    ['timeout result', { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lots: [], status: 'TIMEOUT', reason: 'TIME_BUDGET_EXHAUSTED', retrieved_at: new Date().toISOString() }) }, /занято|исчерпано/],
    ['BUSY result', { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lots: [], status: 'PARTIAL_NO_VERIFIED_SOURCE', reason: 'BUSY', retrieved_at: new Date().toISOString() }) }, /занят/],
    ['source error (pacing skipped)', { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, lots: [], status: 'PARTIAL_SOURCES_SKIPPED', reason: 'SOURCE_PACING_BUSY', retrieved_at: new Date().toISOString() }) }, /занят|исчерпано/],
    ['429 JSON', { status: 429, contentType: 'application/json', body: '{"ok":false,"code":"RATE_LIMITED"}' }, /временно недоступен/],
    ['502 raw html', { status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' }, /временно недоступен/]
  ];
  for (const [name, fulfill, expect] of sims) {
    const { context, page } = await open(390, r => (r.request().method() === 'GET' ? r.continue() : r.fulfill(fulfill)));
    try {
      await run(page, 'имитация ошибки для проверки интерфейса');
      await page.waitForFunction(() => /занят|исчерпано|временно недоступен|не подтверждены/.test(document.getElementById('ai-status').textContent), null, { timeout: 10000 });
      const st = await page.textContent('#ai-status'); const raw = await page.evaluate(() => /502|Bad Gateway|<h1>/.test(document.body.innerText));
      rec(`ai simulated: ${name}`, expect.test(st) && !raw && await page.isEnabled('#ai-submit'), 'SIMULATED', { status_text: st.slice(0, 110), raw_error_visible: raw });
    } catch (e) { rec(`ai simulated: ${name}`, false, 'SIMULATED', { error: String(e.message).slice(0, 160) }); }
    await context.close();
  }
}
fs.writeFileSync(`${out}/public-smoke-${mode}.json`, JSON.stringify({ generated_at: new Date().toISOString(), base, mode, results }, null, 1));
await browser.close();
const fails = results.filter(r => r.status === 'FAIL').length; console.log(`SUMMARY pass=${results.length - fails} fail=${fails}`);
process.exitCode = fails ? 1 : 0;
