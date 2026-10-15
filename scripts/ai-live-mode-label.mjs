/* Live check (no search is sent): the page describes the engine that is really connected. Usage: node scripts/ai-live-mode-label.mjs <baseUrl> <outDir> */
import playwright from '/pw/playwright/driver/package/index.js';
const [base = 'https://torgatlas.ru', out = '/out'] = process.argv.slice(2);
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const html = await (await fetch(`${base}/ai-poisk-lotov/`)).text();
const api = await (await fetch(`${base}/api/ai-lot-search`)).json();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(`${base}/ai-poisk-lotov/`); await page.waitForTimeout(2500);
const ui = await page.evaluate(() => ({ eyebrow: document.getElementById('ai-eyebrow').textContent, note: document.getElementById('ai-mode-note').hidden ? '' : document.getElementById('ai-mode-note').textContent, disabled: document.getElementById('ai-query').disabled }));
console.log(JSON.stringify({ api_mode: api.mode, static_claims_catalogue: /Поиск по каталогу/.test(html), ui }));
const ok = !/Поиск по каталогу/.test(html) && !ui.disabled && (api.mode === 'CORE_SEARCH' ? /Поиск по каталогу ТоргАтлас/.test(ui.eyebrow) : api.mode === 'PUBLIC_WEB_RESEARCH_MINI' ? /Упрощённый режим/.test(ui.note) && !/каталогу/.test(ui.eyebrow) : /недоступен/.test(ui.note));
await page.screenshot({ path: `${out}/live-mode-label.png` });
console.log(ok ? 'PASS label matches the real engine mode' : 'FAIL label/mode mismatch');
await browser.close(); process.exit(ok ? 0 : 1);
