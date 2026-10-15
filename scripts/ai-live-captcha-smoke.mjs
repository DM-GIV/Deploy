/* Live check of the «Я человек» flow on the PUBLIC domain with a real browser (real mouse/touch, keyboard, real ALTCHA proof of work,
 * real daemon). Real searches are spaced >= 40 s (public limit 2 POST/min per IP) and kept to a minimum: one per viewport.
 * Usage: node scripts/ai-live-captcha-smoke.mjs <baseUrl> <outDir> [expectRequired=true|false] */
import playwright from '/pw/playwright/driver/package/index.js';

const [base = 'https://torgatlas.ru', out = '/out', required = 'true'] = process.argv.slice(2);
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const rec = (kind, id, ok, evidence = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', kind, id, JSON.stringify(evidence).slice(0, 300)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function open(width) {
  const mobile = width < 500;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, userAgent: mobile ? MOBILE_UA : undefined, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU' });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const posts = []; const analytics = []; const errors = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/ai-lot-search' && r.method() === 'POST') posts.push(JSON.parse(r.postData() || '{}')); if (u.pathname.startsWith('/ta/')) analytics.push(u.pathname); });
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));
  await page.goto(`${base}/ai-poisk-lotov/`, { waitUntil: 'load' });
  return { context, page, posts, analytics, errors, mobile };
}
async function click(h, selector) { const loc = h.page.locator(selector).first(); await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; if (h.mobile) await h.page.touchscreen.tap(x, y); else await h.page.mouse.click(x, y); }
async function type(h, text) { await click(h, '#ai-query'); await h.page.keyboard.press('Control+A'); await h.page.keyboard.press('Delete'); await h.page.keyboard.type(text, { delay: 12 }); }
async function tick(h) {
  await h.page.waitForSelector('altcha-widget', { state: 'attached' });
  const box = await h.page.evaluate(() => { const w = document.querySelector('altcha-widget'); const c = w && (w.shadowRoot ? w.shadowRoot.querySelector('input[type=checkbox]') : w.querySelector('input[type=checkbox]')); if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (!box) throw new Error('checkbox not found');
  if (h.mobile) await h.page.touchscreen.tap(box.x, box.y); else await h.page.mouse.click(box.x, box.y);
  await h.page.waitForFunction(() => /Проверка пройдена/.test(document.getElementById('ai-captcha-hint').textContent), null, { timeout: 30000 });
}
const status = page => page.textContent('#ai-status');
const done = page => page.waitForFunction(() => !document.getElementById('ai-results').hidden, null, { timeout: 40000 });
const noH = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// published HTML itself
const html = await (await fetch(`${base}/ai-poisk-lotov/`)).text();
rec('REAL', 'published HTML: nothing disabled, CAPTCHA before the button, «до 10 подходящих лотов», CTA «В разработке» without a link, no marketplace list',
  !/<textarea[^>]*\sdisabled/.test(html) && html.indexOf('id="ai-captcha"') < html.indexOf('id="ai-submit"') && /до 10 подходящих лотов/i.test(html)
  && /Посмотреть больше лотов в каталоге ТоргАтлас/.test(html) && !/<p class="ai-catalog-cta"[^>]*>[^]*?<a\b/.test(html.match(/<p class="ai-catalog-cta"[^]*?<\/p>/)[0]) && !/УТПЛ|УЭТП|Центр реализации|ГИС Торги|ЕФРСБ|МЭТС/.test(html), { script: (html.match(/ai-search\.js\?v=[a-f0-9]{12}/) || [])[0] });

// API-level negative probes (plain HTTP, labelled as such)
const post = (body, origin = 'https://torgatlas.ru') => fetch(`${base}/api/ai-lot-search`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
if (required === 'true') {
  const r1 = await post({ query: 'квартиры в Южном федеральном округе' });
  rec('API-PROBE', 'POST without a token is refused 403 CAPTCHA_REQUIRED (before any search work)', r1.status === 403 && (await r1.json()).code === 'CAPTCHA_REQUIRED', r1.status);
  const r2 = await post({ query: 'квартиры в Южном федеральном округе', altcha: 'A'.repeat(300) });
  rec('API-PROBE', 'POST with a garbage token is refused 403 CAPTCHA_INVALID', r2.status === 403 && (await r2.json()).code === 'CAPTCHA_INVALID', r2.status);
}
const ch = await (await fetch(`${base}/api/ai-lot-search?altcha=1`)).json();
rec('API-PROBE', 'challenge endpoint answers with a signed challenge', ch.algorithm === 'SHA-256' && ch.challenge?.length === 64 && ch.signature?.length === 64 && ch.maxnumber === 100000);

// DESKTOP
const D = await open(1440);
rec('REAL', 'desktop: field and button not disabled on load', await D.page.evaluate(() => !document.getElementById('ai-query').disabled && !document.getElementById('ai-submit').disabled));
await type(D, 'Найди транспорт на торгах, где ещё можно подать заявку');
rec('REAL', 'desktop: keyboard typing reaches the field', (await D.page.inputValue('#ai-query')).startsWith('Найди транспорт'));
await click(D, '#ai-submit'); await sleep(500);
if (required === 'true') rec('REAL', 'desktop: submit without «Я человек» -> clear message, text kept, no POST', /Я человек/.test(await status(D.page)) && D.posts.length === 0 && (await D.page.inputValue('#ai-query')).length > 20, (await status(D.page)).slice(0, 80));
await tick(D);
rec('REAL', 'desktop: real click on the checkbox solved the proof of work', true);
const t0 = Date.now(); await click(D, '#ai-submit');
const thinking = await D.page.waitForFunction(() => /Думаю/.test(document.getElementById('ai-status').textContent), null, { timeout: 4000 }).then(() => Date.now() - t0).catch(() => -1);
await done(D.page);
const cardsD = await D.page.$$eval('#ai-cards .ai-card', cs => cs.map(c => ({ href: c.querySelector('a[target=_blank]')?.href, text: c.textContent })));
rec('REAL', 'desktop: «Думаю…» shown, POST carried a token, response rendered (0–5 cards, links https)', thinking >= 0 && D.posts.length === 1 && typeof D.posts[0].altcha === 'string' && cardsD.length <= 5 && cardsD.every(c => /^https:\/\//.test(c.href)), { thinking, cards: cardsD.length, title: await D.page.textContent('#ai-results-title') });
rec('REAL', 'desktop: CTA «В разработке» visible after results, inactive, caveat names no marketplaces', await D.page.evaluate(() => { const c = document.getElementById('ai-catalog-cta'); return !c.hidden && /В разработке/.test(c.textContent) && !c.querySelector('a,[href]') && !/УТПЛ|УЭТП|Центр реализации|ГИС|ЕФРСБ|МЭТС/.test(document.getElementById('ai-results-coverage').textContent); }));
rec('REAL', 'desktop: CAPTCHA reset after the search and the typed text kept', /снова отметьте/.test(await D.page.textContent('#ai-captcha-hint')) && (await D.page.inputValue('#ai-query')).startsWith('Найди транспорт'));
rec('REAL', 'desktop: no analytics requests before consent, no page errors', D.analytics.length === 0 && D.errors.length === 0, { analytics: D.analytics, errors: D.errors });
await D.page.screenshot({ path: `${out}/live-core-desktop.png`, fullPage: true });
await D.context.close();

await sleep(45000);
// MOBILE
const M = await open(412);
await click(M, '.ai-example:nth-of-type(3)');
rec('REAL', 'mobile: example button (tap) fills the field', (await M.page.inputValue('#ai-query')).length > 10);
await tick(M);
await click(M, '#ai-submit'); await done(M.page);
const cardsM = await M.page.$$eval('#ai-cards .ai-card', cs => cs.length);
rec('REAL', 'mobile: tap-verified CAPTCHA, tap submit, response rendered, no horizontal scroll', cardsM <= 5 && await noH(M.page) && M.posts.length === 1, { cards: cardsM, title: await M.page.textContent('#ai-results-title') });
await M.page.screenshot({ path: `${out}/live-core-mobile.png`, fullPage: true });
await M.context.close();
await browser.close();
console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
