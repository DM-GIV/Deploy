/* TEST_ONLY browser E2E against the isolated throwaway stack (127.0.0.1:18092). Serves the static site locally and
 * forwards ONLY /api/ai-lot-search to the stack, adding Origin: https://torgatlas.ru (the daemon requires it).
 * No production requests. Usage: node scripts/ai-e2e-stack.mjs <outDir> */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import playwright from '/pw/playwright/driver/package/index.js';

const out = process.argv[2] || '/out';
const root = '/app';
const STACK = { host: '127.0.0.1', port: 18092 };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
let proxied = 0;
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/api/ai-lot-search') {
    proxied += 1;
    const up = http.request({ ...STACK, path: pathname, method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', origin: 'https://torgatlas.ru', 'x-real-ip': `198.51.100.${(proxied % 200) + 1}` } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
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
const results = [];
const rec = (id, ok, evidence) => { results.push({ id, status: ok ? 'PASS' : 'FAIL', evidence }); console.log(ok ? 'PASS' : 'FAIL', id, JSON.stringify(evidence).slice(0, 300)); };
async function open(width, route) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  if (route) await page.route('**/api/ai-lot-search', route);
  await page.goto(`${base}/ai-poisk-lotov/`);
  await page.waitForFunction(() => !document.getElementById('ai-query').disabled, null, { timeout: 15000 });
  return { context, page };
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
async function search(page, text) {
  await page.fill('#ai-query', text);
  const t0 = Date.now();
  await page.click('#ai-submit');
  const thinking = await page.waitForFunction(() => /Думаю/.test(document.getElementById('ai-status').textContent), null, { timeout: 3000 }).then(() => Date.now() - t0).catch(() => -1);
  return { t0, thinking };
}

// 1) real results on three widths (desktop, tablet-ish, mobile 390 and 320)
const coldQueries = { 1440: 'найди автомобиль на торгах банкротов', 390: 'найди транспортное средство для покупки на торгах', 320: 'найди грузовой транспорт на открытых торгах' };
for (const width of [1440, 390, 320]) {
  const { context, page } = await open(width);
  try {
    const { t0, thinking } = await search(page, coldQueries[width]);
    const busy = await page.getAttribute('#ai-lot-form', 'aria-busy').catch(() => null);
    await page.waitForSelector('#ai-cards .ai-card', { timeout: 30000 });
    const ms = Date.now() - t0;
    const cardsInfo = await page.$$eval('#ai-cards .ai-card', cs => cs.map(c => ({ title: c.querySelector('h3').textContent.slice(0, 40), href: c.querySelector('a[target=_blank]').href, state: c.querySelector('.ai-lot-state').textContent.slice(0, 40) })));
    const hosts = [...new Set(cardsInfo.map(c => new URL(c.href).hostname))];
    await page.screenshot({ path: `${out}/results-${width}.png`, fullPage: true });
    rec(`results-${width}px`, thinking >= 0 && cardsInfo.length >= 1 && await noHScroll(page) && cardsInfo.every(c => c.href.startsWith('https://')), { thinking_visible_ms: thinking, results_ms: ms, aria_busy_during: busy, cards: cardsInfo.length, hosts, no_horizontal_scroll: await noHScroll(page), sample: cardsInfo[0] });
  } catch (e) { rec(`results-${width}px`, false, { error: String(e.message).slice(0, 200) }); }
  await context.close();
  await new Promise(r => setTimeout(r, 3000));
}

// 2) empty result (no matches): honest empty state, no fake cards
{
  const { context, page } = await open(390);
  try {
    await search(page, 'подводная лодка атомная торги');
    await page.waitForFunction(() => !document.getElementById('ai-results').hidden, null, { timeout: 30000 });
    const t = await page.textContent('#ai-results-title'); const n = await page.locator('#ai-cards .ai-card').count();
    const status = await page.textContent('#ai-status');
    await page.screenshot({ path: `${out}/empty-390.png`, fullPage: true });
    rec('empty-result', n === 0 && /не найдено/.test(t), { title: t, cards: n, status: status.slice(0, 120) });
  } catch (e) { rec('empty-result', false, { error: String(e.message).slice(0, 200) }); }
  await context.close();
}

// 3) partial result (mocked API response with TIMEOUT-like partial coverage and one card)
{
  const body = { ok: true, status: 'PRELIMINARY_SOURCE_DATA', coverage: 'FIRST_PUBLIC_CATALOG_PAGES', coverage_note: 'TEST_ONLY partial: источник ГИС отвечал частично.', retrieved_at: new Date().toISOString(),
    lots: [{ source: 'gis-torgi', source_lot_id: 'TEST_ONLY_1', title: 'TEST_ONLY лот', url: 'https://torgi.gov.ru/new/public/lots/lot/TEST_ONLY_1', checked_at: new Date().toISOString(), accepting_applications: 'UNKNOWN' },
           { source: 'evil', source_lot_id: 'x', title: 'bad link must be dropped', url: 'https://evil.example/x', checked_at: new Date().toISOString() },
           { source: 'x', source_lot_id: 'y', title: 'javascript link dropped', url: 'javascript:alert(1)', checked_at: new Date().toISOString() }] };
  const { context, page } = await open(390, r => r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  try {
    await search(page, 'частичная выдача тестовый запрос');
    await page.waitForSelector('#ai-cards .ai-card');
    const n = await page.locator('#ai-cards .ai-card').count(); const cov = await page.textContent('#ai-results-coverage'); const st = await page.locator('.ai-lot-state').first().textContent();
    rec('partial-result-and-link-guard', n === 1 && /частично/.test(cov) && /не подтверждена/.test(st), { cards: n, coverage: cov, state: st });
  } catch (e) { rec('partial-result-and-link-guard', false, { error: String(e.message).slice(0, 200) }); }
  await context.close();
}

// 4) error paths: nginx-style JSON 503/429, raw 502 HTML, malformed JSON -> clean message, button usable again
for (const [id, fulfill] of [['error-503-json', { status: 503, contentType: 'application/json', body: '{"ok":false,"code":"SERVICE_UNAVAILABLE"}' }],
  ['error-429-json', { status: 429, contentType: 'application/json', body: '{"ok":false,"code":"RATE_LIMITED"}' }],
  ['error-502-html', { status: 502, contentType: 'text/html', body: '<html><h1>502 Bad Gateway</h1></html>' }]]) {
  const { context, page } = await open(390, r => r.request().method() === 'GET' ? r.continue() : r.fulfill(fulfill));
  try {
    await search(page, 'ошибка сервера тестовый запрос');
    await page.waitForFunction(() => /временно недоступен/.test(document.getElementById('ai-status').textContent), null, { timeout: 10000 });
    const txt = await page.textContent('#ai-status'); const enabled = await page.isEnabled('#ai-submit');
    const raw = await page.evaluate(() => /502|Bad Gateway|<h1>/.test(document.body.innerText));
    rec(id, enabled && !raw && (await page.getAttribute('#ai-status', 'data-error')) === 'true', { status_text: txt.slice(0, 100), button_enabled: enabled, raw_error_visible: raw });
  } catch (e) { rec(id, false, { error: String(e.message).slice(0, 200) }); }
  await context.close();
}

// 5) cancel in-flight (request never answered) and UI hard timeout (24 s) -> no hung screen
{
  const { context, page } = await open(390, r => r.request().method() === 'GET' ? r.continue() : undefined /* never fulfilled */);
  try {
    await search(page, 'отмена поиска тестовый запрос');
    await page.waitForSelector('#ai-cancel:not([hidden])');
    await page.click('#ai-cancel');
    await page.waitForFunction(() => /отменён/.test(document.getElementById('ai-status').textContent), null, { timeout: 5000 });
    rec('cancel-inflight', await page.isEnabled('#ai-submit'), { status: (await page.textContent('#ai-status')).slice(0, 90) });
  } catch (e) { rec('cancel-inflight', false, { error: String(e.message).slice(0, 200) }); }
  try {
    const t0 = Date.now();
    await page.fill('#ai-query', 'таймаут поиска тестовый запрос'); await page.click('#ai-submit');
    await page.waitForFunction(() => /лимита времени|отменён/.test(document.getElementById('ai-status').textContent), null, { timeout: 30000 });
    const ms = Date.now() - t0;
    rec('ui-hard-timeout', ms >= 23000 && ms <= 27000 && await page.isEnabled('#ai-submit'), { aborted_after_ms: ms });
  } catch (e) { rec('ui-hard-timeout', false, { error: String(e.message).slice(0, 200) }); }
  await context.close();
}
fs.writeFileSync(`${out}/e2e-results.json`, JSON.stringify({ generated_at: new Date().toISOString(), environment: 'TEST_ONLY isolated stack 127.0.0.1:18092; local static server; no production', results }, null, 1));
await browser.close(); server.close();
process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
