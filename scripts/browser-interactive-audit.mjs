/* TEST_ONLY interactive acceptance. It starts a local static server and mocks only
 * the documented same-origin endpoints; no production requests or user data. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '/home/deploy/.aa-pw-pkg/playwright/driver/package/index.js';

const { chromium } = playwright;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/torgatlas-web-program/evidence/wave-03/interactive-matrix.json');
const chrome = '/home/deploy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const results = [];
function record(id, status, evidence) { results.push({ id, status, evidence }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function save() { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(`${output}.tmp`, JSON.stringify({ generated_at: new Date().toISOString(), environment: 'TEST_ONLY local HTTP server, intercepted APIs, no production requests', results }, null, 2)); fs.renameSync(`${output}.tmp`, output); }
const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.json':'application/json' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname.startsWith('/api/') || pathname.startsWith('/ta/')) { res.writeHead(404); return res.end('mocked by Playwright where applicable'); }
  const candidate = pathname === '/' ? '/index.html' : (pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  const filename = path.resolve(root, `.${candidate}`);
  if (!filename.startsWith(root) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream' }); fs.createReadStream(filename).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chrome, headless: true });
async function pageFor(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  return { context, page };
}
async function scenario(id, fn) { try { await fn(); record(id, 'PASS', 'Browser action and assertion completed in isolated local preview.'); } catch (error) { record(id, 'FAIL', String(error.message || error)); } finally { save(); } }

await scenario('mobile-navigation-keyboard', async () => {
  const { context, page } = await pageFor({ width: 320 });
  await page.goto(`${base}/`); const nav = page.locator('nav[aria-label="Основное меню"]');
  assert(await nav.isVisible(), 'main navigation is not visible at 320px');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.matches('a,button')), 'Tab did not focus an interactive control');
  const link = page.locator('.nav-links a[href="/proverka-lota/"]'); await link.focus(); await page.keyboard.press('Enter');
  await page.waitForURL('**/proverka-lota/'); await context.close();
});

await scenario('cta-anchor-and-focus', async () => {
  const { context, page } = await pageFor(); await page.goto(`${base}/`);
  const cta = page.locator('a[href="/proverka-lota/#lot-check-form"]').first(); await cta.focus(); await page.keyboard.press('Enter');
  await page.waitForURL('**/proverka-lota/#lot-check-form'); assert(await page.locator('#lot-check-form').isVisible(), 'CTA target is not visible'); await context.close();
});

async function mapScenario(route, selectors, changedText) {
  const { context, page } = await pageFor(); let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; route.fulfill({ status: 204, body: '' }); });
  await page.goto(`${base}${route}`); await page.locator(selectors.submit).click();
  assert(await page.locator(selectors.result).isHidden(), 'invalid form exposed a result');
  for (const [selector, value] of Object.entries(selectors.values)) await page.locator(selector).fill(value);
  for (const [selector, value] of Object.entries(selectors.selects || {})) await page.locator(selector).selectOption({ label: value });
  await page.locator(selectors.submit).click(); await page.locator(selectors.result).waitFor({ state: 'visible' });
  await page.locator(selectors.copy).click(); await page.waitForTimeout(50);
  assert(await page.locator(selectors.copy).innerText() === 'Скопировано', 'copy action did not acknowledge completion');
  await page.locator(selectors.change).fill(changedText); assert(await page.locator(selectors.result).isHidden(), 'changing input did not invalidate map');
  await page.locator(selectors.submit).click(); await page.locator(selectors.result).waitFor({ state: 'visible' });
  assert(apiCalls === 0, `unexpected API request before explicit lead action: ${apiCalls}`); await context.close();
}
await scenario('lot-map-validation-generation-copy-regeneration', () => mapScenario('/proverka-lota/', {
  submit:'#generate-lot-map', result:'#lot-check-result', copy:'#copy-lot-check', change:'#concern', values:{'#lot-url':'https://example.test/lot/1','#concern':'TEST_ONLY'}, selects:{'#asset-type':'Автомобиль','#concern-short':'Ограничения и обременения'},
}, 'TEST_ONLY changed'));
await scenario('search-map-validation-generation-copy-regeneration', () => mapScenario('/poisk-imushchestva/', {
  submit:'#search-brief-form button[type="submit"]', result:'#search-brief-result', copy:'#copy-search-brief', change:'#search-region', values:{'#search-region':'Тестовый регион','#search-budget':'до 100000'}, selects:{'#search-asset-type':'Автомобиль или транспорт','#search-goal':'Для себя'},
}, 'Другой тестовый регион'));

async function aiScenario(id, mode) {
  await scenario(id, async () => {
    const { context, page } = await pageFor(); let posts = 0;
    await page.route('**/api/ai-lot-search', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ contentType:'application/json', body:JSON.stringify({ enabled: mode !== 'disabled', max_results:10 }) });
      posts++;
      if (mode === 'network') return route.abort('failed');
      if (mode === 'server') return route.fulfill({ status:503, contentType:'application/json', body:'{}' });
      const lots = mode === 'empty' ? [] : [{ title:'TEST_ONLY лот', url:'https://torgi.gov.ru/lot/123', region:'Тестовый регион' }];
      return route.fulfill({ contentType:'application/json', body:JSON.stringify({ ok:true, lots, retrieved_at:'TEST_ONLY' }) });
    });
    await page.goto(`${base}/ai-poisk-lotov/`); await page.waitForTimeout(50);
    const query = page.locator('#ai-query'); const submit = page.locator('#ai-submit');
    if (mode === 'disabled') { assert(await query.isDisabled() && await submit.isDisabled(), 'disabled state enabled input'); assert(posts === 0, 'disabled state submitted a query'); await context.close(); return; }
    assert(!(await query.isDisabled()), 'enabled mock did not enable input'); await query.fill('Тестовый публичный запрос'); await submit.click();
    await page.waitForFunction(({ mode }) => {
      const text = document.querySelector('#ai-status')?.textContent || '';
      return mode === 'success' ? text.includes('Подборка сформирована') :
        mode === 'empty' ? text.includes('Нет подтверждаемых') :
        mode === 'server' ? text.includes('пока не подключён') :
        mode === 'network' ? text.includes('Сервис недоступен') : false;
    }, { mode });
    const status = await page.locator('#ai-status').innerText();
    if (mode === 'success') assert(await page.locator('.ai-card').count() === 1, 'success response was not rendered');
    if (mode === 'empty') assert(status.includes('Нет подтверждаемых'), 'empty response was not rendered');
    if (mode === 'server') assert(status.includes('пока не подключён'), 'server error was not handled');
    if (mode === 'network') assert(status.includes('Сервис недоступен'), 'network failure was not handled');
    assert(posts === 1, `expected one mocked POST, received ${posts}`); await context.close();
  });
}
await aiScenario('ai-disabled-no-query', 'disabled'); await aiScenario('ai-enabled-success', 'success'); await aiScenario('ai-enabled-empty', 'empty'); await aiScenario('ai-enabled-server-error', 'server'); await aiScenario('ai-enabled-network-failure', 'network');

await scenario('consent-decline-persistence-and-no-umami', async () => {
  const { context, page } = await pageFor(); let umami = 0;
  await page.route('**/ta/**', route => { umami++; route.fulfill({ status:200, contentType:'application/javascript', body:'' }); });
  await page.goto(`${base}/`); await page.waitForTimeout(80); assert(umami === 0, 'Umami loaded before consent');
  await page.locator('[data-analytics-decline]').click(); await page.reload(); assert(await page.locator('[data-analytics-accept]').count() === 0, 'decline was not persisted'); assert(umami === 0, 'Umami loaded after decline'); await context.close();
});
await scenario('consent-accept-persistence-and-local-umami', async () => {
  const { context, page } = await pageFor(); let umami = 0;
  await page.route('**/ta/**', route => { umami++; route.fulfill({ status:200, contentType:'application/javascript', body:'window.umami={track:()=>{}};' }); });
  await page.goto(`${base}/`); await page.locator('[data-analytics-accept]').click(); await page.waitForTimeout(80); assert(umami === 1, `expected local Umami script once, got ${umami}`);
  await page.reload(); await page.waitForTimeout(50); assert(umami === 2, 'accepted consent did not reload local Umami'); await context.close();
});

record('mobile-menu-open-close', 'BLOCKED', 'The implemented mobile navigation is an always-visible wrapping link list, not a disclosure/menu control; there is no open/close state to exercise. Keyboard link navigation is separately PASS.');
record('altcha-challenge-pass-reject-replay', 'BLOCKED', 'Existing isolated ALTCHA E2E harness requires a TLS lead-intake test service and a browser adapter not exposed to this Node static preview. No challenge endpoint was invented and no lead/SQLite production store was contacted.');
save(); await browser.close(); await new Promise(resolve => server.close(resolve));
const totals = results.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
console.log(JSON.stringify({ output, totals }));
