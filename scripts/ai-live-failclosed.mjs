/* Live fail-closed check: with the Core container stopped, a real search must end in a clear "temporarily unavailable" message,
 * with no cards and no substitution by another engine; the typed text is kept. Usage: node scripts/ai-live-failclosed.mjs <baseUrl> */
import playwright from '/pw/playwright/driver/package/index.js';
const [base = 'https://torgatlas.ru'] = process.argv.slice(2);
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' })).newPage(); page.setDefaultTimeout(30000);
const statuses = []; page.on('response', r => { if (new URL(r.url()).pathname === '/api/ai-lot-search' && r.request().method() === 'POST') statuses.push(r.status()); });
await page.goto(`${base}/ai-poisk-lotov/`);
const get = await (await fetch(`${base}/api/ai-lot-search`)).json();
const click = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await page.waitForTimeout(900); const b = await l.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
await click('#ai-query'); await page.keyboard.type('Найди квартиры на торгах в Москве', { delay: 8 });
await page.waitForSelector('altcha-widget', { state: 'attached' }); await page.waitForTimeout(900);
await page.locator('altcha-widget').scrollIntoViewIfNeeded(); await page.waitForTimeout(900);
const box = await page.evaluate(() => { const w = document.querySelector('altcha-widget'); const c = w.shadowRoot ? w.shadowRoot.querySelector('input[type=checkbox]') : w.querySelector('input[type=checkbox]'); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(box.x, box.y); await page.waitForFunction(() => /Проверка пройдена/.test(document.getElementById('ai-captcha-hint').textContent));
await click('#ai-submit');
await page.waitForFunction(() => /недоступен/.test(document.getElementById('ai-status').textContent), null, { timeout: 30000 });
const res = { get_mode: get.mode, post_status: statuses, status: await page.textContent('#ai-status'), cards: (await page.$$('#ai-cards .ai-card')).length, results_hidden: await page.evaluate(() => document.getElementById('ai-results').hidden), kept: await page.inputValue('#ai-query'), button_enabled: !(await page.locator('#ai-submit').isDisabled()) };
console.log(JSON.stringify(res));
const ok = res.post_status.length === 1 && res.post_status[0] === 503 && res.cards === 0 && /Не подставляем|не подставляем/.test(res.status) && res.kept.startsWith('Найди квартиры') && res.button_enabled;
console.log(ok ? 'PASS fail-closed: clear unavailability, no cards, no fallback, text kept, button usable' : 'FAIL');
await browser.close(); process.exit(ok ? 0 : 1);
