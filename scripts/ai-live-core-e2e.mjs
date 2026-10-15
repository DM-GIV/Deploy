/* Live E2E of the Core-backed AI search on the PUBLIC domain: real browser, real mouse/touch/keyboard, real ALTCHA proof of work,
 * real daemon -> real Core container -> real Core database. Searches are spaced >= 38 s (public limit: 2 POST/min per IP).
 * Usage: node scripts/ai-live-core-e2e.mjs <baseUrl> <outDir> */
import playwright from '/pw/playwright/driver/package/index.js';
const [base = 'https://torgatlas.ru', out = '/out'] = process.argv.slice(2);
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const rec = (kind, id, ok, evidence = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', kind, id, JSON.stringify(evidence).slice(0, 360)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
async function open(width) {
  const mobile = width < 500;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, userAgent: mobile ? MOBILE_UA : undefined, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU' });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  const h = { context, page, mobile, posts: [], analytics: [], errors: [], responses: [], challenges: 0 };
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/ai-lot-search' && r.method() === 'POST') h.posts.push(JSON.parse(r.postData() || '{}')); if (u.pathname.startsWith('/ta/')) h.analytics.push(u.pathname); });
  page.on('response', r => { const u = new URL(r.url()); if (u.pathname === '/api/ai-lot-search' && r.request().method() === 'POST') h.responses.push(r.status()); });
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/api/ai-lot-search' && r.method() === 'GET' && u.searchParams.get('altcha')) h.challenges += 1; });
  page.on('pageerror', e => h.errors.push(String(e.message).slice(0, 120)));
  await page.goto(`${base}/ai-poisk-lotov/`, { waitUntil: 'load' });
  return h;
}
async function click(h, selector) { const loc = h.page.locator(selector).first(); await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; if (h.mobile) await h.page.touchscreen.tap(x, y); else await h.page.mouse.click(x, y); }
async function type(h, text) { await click(h, '#ai-query'); await h.page.keyboard.press('Control+A'); await h.page.keyboard.press('Delete'); await h.page.keyboard.type(text, { delay: 10 }); }
async function tick(h) {
  await h.page.waitForSelector('altcha-widget', { state: 'attached' });
  const find = () => h.page.evaluate(() => { const w = document.querySelector('altcha-widget'); const c = w && (w.shadowRoot ? w.shadowRoot.querySelector('input[type=checkbox]') : w.querySelector('input[type=checkbox]')); if (!c) return null; c.scrollIntoView({ block: 'center' }); return true; });
  await find(); await h.page.waitForTimeout(900);   // smooth scrolling: measure only after the page has settled
  const box = await h.page.evaluate(() => { const w = document.querySelector('altcha-widget'); const c = w.shadowRoot ? w.shadowRoot.querySelector('input[type=checkbox]') : w.querySelector('input[type=checkbox]'); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (!box) throw new Error('no checkbox');
  if (h.mobile) await h.page.touchscreen.tap(box.x, box.y); else await h.page.mouse.click(box.x, box.y);
  await h.page.waitForFunction(() => /Проверка пройдена/.test(document.getElementById('ai-captcha-hint').textContent), null, { timeout: 30000 });
}
async function search(h, text, { enter = false } = {}) {
  await type(h, text); await tick(h);
  if (enter) await h.page.keyboard.press('Enter'); else await click(h, '#ai-submit');
  await h.page.waitForFunction(() => !document.getElementById('ai-results').hidden && !/Думаю|Ищу|Формирую/.test(document.getElementById('ai-status').textContent), null, { timeout: 40000 });
  const cards = await h.page.$$eval('#ai-cards .ai-card', cs => cs.map(c => ({ href: c.querySelector('a[target=_blank]')?.href, text: c.textContent, title: c.querySelector('h3')?.textContent })));
  return { cards, title: await h.page.textContent('#ai-results-title'), status: await h.page.textContent('#ai-status'), understood: await h.page.textContent('#ai-understood').catch(() => '') };
}
const region = c => (c.text.match(/Регион: (.+?)(?:Начальная|Цена|Приём|Срок|Данные)/) || [])[1] || null;

const D = await open(1440);
await D.page.waitForFunction(() => /Поиск по каталогу ТоргАтлас/.test(document.getElementById('ai-eyebrow').textContent), null, { timeout: 8000 }).catch(() => {});
rec('REAL', 'GET status is reflected on the page: «Поиск по каталогу ТоргАтлас», no legacy-mode warning', await D.page.evaluate(() => /Поиск по каталогу ТоргАтлас/.test(document.getElementById('ai-eyebrow').textContent) && document.getElementById('ai-mode-note').hidden));
rec('REAL', 'field/button usable on load; «до 10 подходящих лотов» shown; CTA hidden before a search', await D.page.evaluate(() => !document.getElementById('ai-query').disabled && /до 10 подходящих лотов/.test(document.body.textContent) && document.getElementById('ai-catalog-cta').hidden));

let r = await search(D, 'Найди квартиры на торгах в Москве');
rec('REAL', 'Москва: 6–10 distinct apartments, region «Москва» only (no ХМАО/Краснодар/нежилое/дом)', r.cards.length >= 6 && r.cards.length <= 10 && new Set(r.cards.map(c => c.title)).size === r.cards.length && r.cards.every(c => /Вид имущества: Квартира/.test(c.text) && region(c) === 'Москва') && !/Ханты|Краснодар|Нежилое|Жилой дом/.test(r.cards.map(c => c.text).join(' ')), { n: r.cards.length, regions: r.cards.map(region) });
rec('REAL', 'cards: category, procedure, price with meaning, deadline, check date, status label, https first-source link', r.cards.every(c => /Вид имущества/.test(c.text) && /Процедура:/.test(c.text) && /Начальная цена|Цена текущего периода/.test(c.text) && /Приём заявок до:/.test(c.text) && /Последняя проверка данных/.test(c.text) && /не (?:истёк|подтвержден)|давно не перепроверялись/.test(c.text) && /^https:\/\/fedresurs\.ru\/biddings\/[0-9a-f-]{36}$/.test(c.href)), r.cards.map(c => c.href));
rec('REAL', 'stale checks are NOT shown as confirmed open (label says actuality not confirmed)', r.cards.every(c => /актуальность не подтверждена/.test(c.text)), r.cards[0]?.text.slice(-160));
rec('REAL', 'interpretation shown; CTA «В разработке» visible and not a link', /Тип имущества: Квартира/.test(r.understood) && /Регион: Москва/.test(r.understood) && await D.page.evaluate(() => { const c = document.getElementById('ai-catalog-cta'); return !c.hidden && /В разработке/.test(c.textContent) && !c.querySelector('a,[href]'); }));
{
  const counts = await D.page.evaluate(() => ({ cards: document.querySelectorAll('#ai-cards .ai-card').length, visible: [...document.querySelectorAll('#ai-cards .ai-card')].filter(c => !c.hidden).length, more: !document.getElementById('ai-more-wrap').hidden, text: document.getElementById('ai-more').textContent, title: document.getElementById('ai-results-title').textContent }));
  rec('REAL', 'first five cards visible; counter equals the real number of cards (max 10); «Показать ещё N лотов» shown', counts.visible === 5 && counts.cards > 5 && counts.cards <= 10 && counts.more && counts.text === `Показать ещё ${counts.cards - 5} ${counts.cards - 5 === 1 ? 'лот' : (counts.cards - 5 >= 2 && counts.cards - 5 <= 4) ? 'лота' : 'лотов'}` && counts.title === `Подходящих предложений: ${counts.cards}`, counts);
  await D.page.screenshot({ path: `${out}/live-core-moscow-first5.png`, fullPage: true });
  const postsBefore = D.posts.length, chBefore = D.challenges;
  await click(D, '#ai-more');
  const after = await D.page.evaluate(() => ({ visible: [...document.querySelectorAll('#ai-cards .ai-card')].filter(c => !c.hidden).length, text: document.getElementById('ai-more').textContent }));
  rec('REAL', '«Показать ещё»: all cards visible, NO new POST and NO new ALTCHA challenge request', after.visible === counts.cards && after.text === 'Свернуть' && D.posts.length === postsBefore && D.challenges === chBefore, { after, posts: D.posts.length });
  await D.page.screenshot({ path: `${out}/live-core-moscow-all10.png`, fullPage: true });
}
await D.page.screenshot({ path: `${out}/live-core-moscow-desktop.png`, fullPage: true });
const apartmentLinks = r.cards.map(c => c.href);

await sleep(40000);
r = await search(D, 'Найди автомобильные прицепы на торгах в Приволжском федеральном округе');
rec('REAL', 'прицепы ПФО: only trailers, only ПФО regions, exactly the real records', r.cards.length === 4 && r.cards.every(c => /Прицеп/.test(c.text) && /Оренбургская область/.test(region(c) || '')), { n: r.cards.length, regions: r.cards.map(region) });
rec('REAL', 'four lots of ONE publication are marked as one source (shared link), not as four independent sources', new Set(r.cards.map(c => c.href)).size === 1 && r.cards.every(c => /общую публикацию/.test(c.text) && /один источник/.test(c.text)) && new Set(r.cards.map(c => c.title)).size === 4, { links: [...new Set(r.cards.map(c => c.href))], titles: r.cards.map(c => c.title) });
rec('REAL', 'trailer titles name the property (from the stored description), keep the lot number, expose no VIN/plate/location', r.cards.length === 4 && r.cards.every(c => /^(?:Полуприцеп|Прицеп)[^]* — лот №\d+$/.test(c.title) && !/VIN|ГРЗ|[A-Z0-9]{17}|Бузулук/.test(c.title)) && r.cards.some(c => /СЗАП 9327 — лот №4$/.test(c.title)) && r.cards.some(c => /ЧМЗАП 9906 — лот №11$/.test(c.title)), r.cards.map(c => c.title));
await D.page.screenshot({ path: `${out}/live-core-trailers-desktop.png`, fullPage: true });

await sleep(40000);
r = await search(D, 'Найди легковые автомобили на торгах', { enter: true });
rec('REAL', 'легковые: no VIN or registration plate shown in any card', !/[A-HJ-NPR-Z0-9]{17}|[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}/.test(r.cards.map(c => c.title + ' ' + c.text).join(' ')), r.cards.map(c => c.title.slice(0, 70)));
rec('REAL', 'легковые (Enter): up to 10 passenger cars, no snowmobile/motorcycle/quad', r.cards.length >= 1 && r.cards.length <= 10 && r.cards.every(c => /Легковой автомобиль/.test(c.text)) && !/негоход|LYNX|РЫСЬ|мотоцикл|квадроцикл|скутер/i.test(r.cards.map(c => c.text).join(' ')), { n: r.cards.length, titles: r.cards.map(c => c.title.slice(0, 40)) });

await sleep(40000);
r = await search(D, 'Квартиры в Южном федеральном округе на публичном предложении');
rec('REAL', 'квартиры ЮФО на публичном предложении: only ЮФО regions, only «Публичное предложение», no auctions', r.cards.length >= 1 && r.cards.every(c => /Процедура: Публичное предложение/.test(c.text) && /Волгоградская|Ростовская|Краснодарский|Астраханская|Крым|Адыгея|Калмыкия|Севастополь/.test(region(c) || '')) && !/Процедура: Аукцион/.test(r.cards.map(c => c.text).join(' ')), { n: r.cards.length, regions: r.cards.map(region) });
rec('REAL', 'repeat searches on one page without reload; each POST carried a fresh ALTCHA token; all POST = 200', D.posts.length === 4 && new Set(D.posts.map(p => p.altcha)).size === 4 && D.responses.every(s => s === 200), { posts: D.posts.length, statuses: D.responses });
{
  // hand-off: the picked lot goes to the check form
  const firstHref = r.cards[0].href;   // last real search: apartments in ЮФО
  await click(D, '#ai-cards .ai-card >> nth=0 >> a[data-track=ai_check_card_click]');
  await D.page.waitForURL('**/proverka-lota/**'); await D.page.waitForTimeout(600);
  const dec = D.page.locator('[data-analytics-decline]'); if (await dec.count() && await dec.first().isVisible()) { await click(D, '[data-analytics-decline]'); }
  const pre = await D.page.evaluate(() => ({ url: document.getElementById('lot-url').value, type: document.getElementById('asset-type').value, note: !!document.querySelector('.prefill-note') }));
  rec('REAL', 'card «Получить карту проверки» opens the check form PRE-FILLED with that lot\'s first-source link and type (editable, nothing sent)', pre.url === firstHref && pre.type === 'Недвижимость' && pre.note && D.errors.length === 0, pre);
  await click(D, '#generate-lot-map'); await D.page.waitForFunction(() => !document.getElementById('lot-check-result').hidden);
  await click(D, '#send-telegram');
  rec('REAL', 'voluntary request only prepared: editable text contains the lot link, no automatic sending', await D.page.evaluate((u) => !document.getElementById('lot-handoff-preview').hidden && document.getElementById('lot-handoff-text').value.includes(u.split('/biddings/')[1]), firstHref));
  await D.page.screenshot({ path: `${out}/live-core-prefilled-check.png`, fullPage: false });
}
rec('REAL', 'no analytics requests before consent; no page errors', D.analytics.length === 0 && D.errors.length === 0, { analytics: D.analytics, errors: D.errors });
await D.context.close();

await sleep(40000);
const M = await open(412);
await click(M, '.ai-example:nth-of-type(1)');
rec('REAL', 'mobile (Android UA, touch): example tap fills the field', (await M.page.inputValue('#ai-query')).startsWith('Квартиры в Южном'));
await tick(M); await click(M, '#ai-submit');
await M.page.waitForFunction(() => !document.getElementById('ai-results').hidden && !/Думаю|Ищу|Формирую/.test(document.getElementById('ai-status').textContent), null, { timeout: 40000 });
const mc = await M.page.$$eval('#ai-cards .ai-card', cs => cs.map(c => c.textContent));
rec('REAL', 'mobile: results correct, no horizontal scroll, CTA «В разработке» visible', mc.length >= 1 && mc.length <= 10 && mc.every(t => /Процедура: Публичное предложение/.test(t)) && await M.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && !document.getElementById('ai-catalog-cta').hidden), { n: mc.length });
await M.page.screenshot({ path: `${out}/live-core-mobile.png`, fullPage: true });
await M.context.close(); await browser.close();
console.log(`\nSUMMARY pass=${pass} fail=${fail}`); process.exit(fail ? 1 : 0);
