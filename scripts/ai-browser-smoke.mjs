/* TEST_ONLY responsive smoke for the fail-closed AI-search page. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import playwright from '/home/deploy/.aa-pw-pkg/playwright/driver/package/index.js';

const { chromium } = playwright;
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'docs/torgatlas-web-program/evidence/wave-06/ai-browser-smoke.json');
const widths = [320, 390, 768, 1440];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const candidate = pathname === '/' ? '/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const filename = path.resolve(root, `.${candidate}`);
  if (!filename.startsWith(root) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream' });
  fs.createReadStream(filename).pipe(response);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: '/home/deploy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const results = [];
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedResources = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', request => failedResources.push(`${request.url()} ${request.failure()?.errorText || ''}`));
    let enabled = false;
    await page.route('**/api/ai-lot-search', route => {
      if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled, max_results: 10 }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        ok: true,
        status: 'PRELIMINARY_SOURCE_DATA',
        coverage: 'FIRST_PAGE_ONLY',
        coverage_note: 'TEST_ONLY: проверена только первая страница.',
        retrieved_at: '2026-10-14T10:00:00Z',
        lots: [{
          source: 'gis-torgi', source_lot_id: 'TEST_ONLY', procedure_id: 'TEST_ONLY', lot_number: 1,
          title: 'Прицеп автомобильный TEST_ONLY', region_code: '52', price_rub: 125000,
          application_deadline: null, accepting_applications: 'UNKNOWN', checked_at: '2026-10-14T10:00:00Z',
          url: 'https://torgi.gov.ru/new/public/lots/lot/TEST_ONLY', summary: 'Локальный тест отображения карточки.'
        }]
      }) });
    });
    await page.goto(`${base}/ai-poisk-lotov/`, { waitUntil: 'networkidle', timeout: 10_000 });
    await page.locator('.ai-example').first().focus();
    const evidence = await page.evaluate(() => {
      const example = document.querySelector('.ai-example');
      const style = example ? getComputedStyle(example) : null;
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        scroll_width: document.documentElement.scrollWidth,
        query_disabled: document.querySelector('#ai-query')?.disabled === true,
        submit_disabled: document.querySelector('#ai-submit')?.disabled === true,
        examples_visible: [...document.querySelectorAll('.ai-example')].every(node => node.getClientRects().length > 0),
        main_navigation_visible: Boolean(document.querySelector('nav[aria-label="Основное меню"]')?.getClientRects().length),
        focus_visible_contract: style?.outlineStyle !== 'none' && Number.parseFloat(style?.outlineWidth || '0') >= 2
      };
    });
    enabled = true;
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#ai-query').fill('Найди прицепы в Приволжском федеральном округе');
    await page.locator('#ai-submit').click();
    await page.locator('.ai-card').waitFor({ state: 'visible' });
    const resultEvidence = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      result_focused: document.activeElement?.id === 'ai-results-title',
      coverage_visible: Boolean(document.querySelector('#ai-results-coverage')?.getClientRects().length),
      source_link: document.querySelector('.ai-card-actions a[target="_blank"]')?.getAttribute('href') || null,
      check_cta: document.querySelector('.ai-card-actions a[href="/proverka-lota/#lot-check-form"]') != null,
      unknown_state_visible: document.querySelector('.ai-lot-state')?.textContent?.includes('не подтверждена') === true
    }));
    const pass = !evidence.overflow && evidence.query_disabled && evidence.submit_disabled && evidence.examples_visible && evidence.main_navigation_visible && evidence.focus_visible_contract &&
      !resultEvidence.overflow && resultEvidence.result_focused && resultEvidence.coverage_visible && resultEvidence.source_link?.startsWith('https://torgi.gov.ru/') && resultEvidence.check_cta && resultEvidence.unknown_state_visible &&
      !consoleErrors.length && !failedResources.length;
    results.push({ route: '/ai-poisk-lotov/', width, status: pass ? 'PASS' : 'FAIL', disabled_state: evidence, result_state: resultEvidence, console_errors: consoleErrors, failed_resources: failedResources });
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
fs.mkdirSync(path.dirname(output), { recursive: true });
const temp = `${output}.tmp`;
fs.writeFileSync(temp, `${JSON.stringify({ generated_at: new Date().toISOString(), environment: 'TEST_ONLY local preview; API GET intercepted disabled', results }, null, 2)}\n`);
fs.renameSync(temp, output);
const failed = results.filter(row => row.status !== 'PASS');
console.log(JSON.stringify({ output, pass: results.length - failed.length, fail: failed.length }));
if (failed.length) process.exitCode = 1;
