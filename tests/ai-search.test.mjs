import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('ai-poisk-lotov/index.html', 'utf8');
const script = fs.readFileSync('assets/ai-search.js', 'utf8');

test('AI search form is usable immediately: nothing is disabled in the published HTML', () => {
  assert.doesNotMatch(page, /<textarea[^>]*\bdisabled\b/);
  assert.doesNotMatch(page, /<button[^>]*id="ai-submit"[^>]*\bdisabled\b/);
  assert.match(page, /<form id="ai-lot-form" novalidate>/);
  assert.doesNotMatch(page, /id="ai-source"/);
  assert.doesNotMatch(page, /id="ai-limit"/);
  assert.match(page, /<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
  assert.match(page, /__aiSearchReady/);
  assert.match(page, /ai-search\.js\?v=[a-f0-9]{12}/);
});

test('public page names no marketplaces, source counts or disabled sources; uses the owner-approved wording', () => {
  const visible = page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  const description = page.match(/<meta name="description" content="([^"]*)"/)[1];
  for (const text of [visible, description]) {
    assert.doesNotMatch(text, /УТПЛ|УЭТП|Центр реализации|ГИС|torgi\.gov|ЕФРСБ|МЭТС|Росэлторг|Объединённая торговая|не подключен|отключен|пока не/i);
    assert.doesNotMatch(text, /(три|3|\d+)\s+(площадк|источник)/i);
  }
  assert.match(page, /ТоргАтлас использует открытые сведения, опубликованные на электронных торговых площадках, для поиска и отображения предложений об имуществе\. Результаты сопровождаются ссылками на первоисточники\. Актуальность и условия участия необходимо проверить перед покупкой\./);
  assert.doesNotMatch(script, /coverage_note\s*\|\||data\.coverage_note\b[^;]*textContent|textContent\s*=\s*data\.coverage_note/);
  const registry = JSON.parse(fs.readFileSync('config/ai-sources.registry.json', 'utf8'));
  assert.deepEqual(registry.sources.filter(source => source.edge_enabled === true).map(source => source.id).sort(), ['centerr-bankrupt', 'etpu', 'utpl']);
});

test('AI search never gates typing or sending on the availability GET', () => {
  assert.doesNotMatch(script, /searchReady/);
  assert.doesNotMatch(script, /setSearchReady/);
  assert.doesNotMatch(script, /q\.disabled\s*=\s*(true|!)/);
  assert.match(script, /q\.disabled = false/);
  assert.match(script, /method:\s*'GET'[\s\S]*catch \{ \/\* Ignored on purpose/);
  assert.match(script, /method:\s*'POST'/);
  assert.match(script, /if \(activeController\) return;/);
  assert.match(script, /event\.key === 'Enter'/);
});

test('AI search explains coverage and provides real next-step CTAs', () => {
  assert.match(page, /class="ai-example"/);
  assert.match(page, /id="ai-results-coverage"/);
  assert.match(script, /DEFAULT_COVERAGE/);
  assert.match(script, /Получить карту проверки/);
  assert.match(script, /Возможность подать заявку не подтверждена/);
});

test('AI search uses one natural-language query, truthful stages and cancellation', () => {
  assert.match(page, /id="ai-cancel"/);
  assert.match(script, /Думаю…/);
  assert.match(script, /Ищу предложения и проверяю первоисточники/);
  assert.match(script, /Формирую результаты/);
  assert.match(script, /JSON\.stringify\(\{ query, altcha: proof \}\)/);
  assert.doesNotMatch(script, /yandex\.ru\/search/);
});

test('«Я человек» check sits before the search button, the field never depends on it, and a missing token blocks only the send', () => {
  assert.ok(page.indexOf('id="ai-captcha"') > 0 && page.indexOf('id="ai-captcha"') < page.indexOf('id="ai-submit"'));
  assert.doesNotMatch(page, /<textarea[^>]*disabled/);
  assert.match(script, /if \(!captchaToken\)/);
  assert.match(script, /challengeurl', CAPTCHA_URL/);
  assert.match(script, /CAPTCHA_URL = '\/api\/ai-lot-search\?altcha=1'/);
  assert.match(script, /credentials', 'omit'/);
  // the token is single use: the widget is reset after every request, whatever its outcome
  assert.match(script, /resetCaptcha\(\);[^\n]*one proof of work = one request/);
  // the check can never change the text the visitor typed
  assert.doesNotMatch(script, /q\.value\s*=\s*''/);
  assert.match(script, /q\.disabled = false;/);
});

test('page states the ten-result cap and offers an inactive catalogue link marked «В разработке»', () => {
  assert.match(page, /покажет до 10 подходящих лотов/);
  assert.doesNotMatch(page, /До 5 результатов|покажет до 5/);
  assert.match(page, /Посмотреть больше лотов в каталоге ТоргАтлас/);
  const cta = page.match(/<p class="ai-catalog-cta"[\s\S]*?<\/p>/)[0];
  assert.match(cta, />В разработке</);
  assert.match(cta, /app\.torgatlas\.ru/);
  assert.doesNotMatch(cta, /<a\b|href=/);
  assert.match(cta, /aria-disabled="true"/);
  assert.match(cta, /hidden/);
  assert.match(script, /catalogCta\.hidden = incomplete;/);
  assert.match(script, /data\.lots\.slice\(0, MAX_CARDS\)/);
  assert.match(script, /const INITIAL_VISIBLE = 5;/);
  assert.match(script, /const MAX_CARDS = 10;/);
});

test('result cards show price meaning, procedure, status, deadline, last-check date and a validated primary-source link', () => {
  for (const needle of ["lot.price_meaning", "Процедура:", "Приём заявок до:", "Последняя проверка данных", "ai-card-status", "Открыть карточку лота"]) assert.ok(script.includes(needle), needle);
  assert.match(script, /url\.protocol !== 'https:' \|\| url\.username \|\| url\.password \|\| url\.port/);
  assert.match(script, /el\('h3', lot\.title\.slice/); // text nodes only, never innerHTML
  assert.doesNotMatch(script, /innerHTML/);
});

test('clarification and interpretation are rendered as text, and the typed query is kept', () => {
  assert.match(script, /NEEDS_CLARIFICATION/);
  assert.match(script, /Как понят запрос/);
  assert.match(script, /Не учтено в поиске/);
  assert.match(page, /id="ai-understood"/);
});

test('no stale result-count claim remains on the page', () => {
  assert.doesNotMatch(page, /До 5 результатов|до 5 (?:лотов|предложений|результатов)/);
  assert.equal((page.match(/до 10 подходящих лотов/g) || []).length, 1);
});

test('page never claims a catalogue search statically; the mode label comes from the real engine mode', () => {
  assert.doesNotMatch(page, /Поиск по каталогу(?! ТоргАтлас)/);
  assert.match(page, /id="ai-eyebrow">AI-поиск лотов</);
  assert.match(script, /data\.mode === 'CORE_SEARCH'/);
  assert.match(script, /data\.mode === 'PUBLIC_WEB_RESEARCH_MINI'/);
  assert.match(script, /UNAVAILABLE_CORE_REQUIRED/);
  assert.match(script, /Упрощённый режим/);
  assert.doesNotMatch(page, /подберёт до 5 наиболее подходящих/);
});

test('catalogue cards show the honest status label and the shared-publication note', () => {
  assert.match(script, /lot\.status_label/);
  assert.match(script, /same_publication_count/);
  assert.match(script, /один источник, а не несколько независимых/);
});

test('UI announces a Core outage from the live status', () => {
  assert.match(script, /data\.mode === 'CORE_UNAVAILABLE'/);
  assert.match(script, /Мы не подменяем его неточным поиском/);
});

test('«Показать ещё N лотов»: extra cards already sit in the DOM, the button makes no request and needs no new CAPTCHA', () => {
  const handler = script.match(/moreButton\.addEventListener\('click'[\s\S]*?\n  \}\);/)[0];
  assert.doesNotMatch(handler, /fetch\(|XMLHttpRequest|captcha|resetCaptcha/i);
  assert.match(script, /if \(count >= INITIAL_VISIBLE\) card\.hidden = true;/);
  assert.match(script, /Показать ещё \$\{extra\}/);
  assert.match(script, /aria-expanded/);
  assert.match(page, /id="ai-more"[^>]*aria-controls="ai-cards"/);
  assert.match(script, /moreWrap\.hidden = true;/);                                  // 0-5 cards: no button
});

test('card CTA hands the picked lot to the check form through a same-origin session hint, never through analytics or the URL', () => {
  assert.match(script, /sessionStorage\.setItem\('ta_prefill_lot'/);
  assert.match(script, /verify\.dataset\.track = 'ai_check_card_click'/);
  assert.doesNotMatch(script, /track\([^)]*(?:url|query|lot\.)/);                  // events carry names only
  const prefill = fs.readFileSync('assets/lot-prefill.js', 'utf8');
  assert.match(prefill, /u\.protocol !== 'https:'/);
  assert.match(prefill, /\.value = url/);
  assert.doesNotMatch(prefill, /innerHTML|location\.(?:href|assign|replace)|fetch\(/);
});

test('the AI page is compact: one beta line, short «Важно знать», no technical or legal wall', () => {
  assert.equal((page.match(/Бета/g) || []).length, 1);
  assert.match(page, /<p class="ai-beta-line"><strong>Бета:<\/strong> каталог пополняется, актуальность лотов проверяйте в первоисточнике\.<\/p>/);
  assert.doesNotMatch(page, /Как проверяется результат|ai-beta-note|ai-layout/);
  const know = page.match(/<aside class="ai-know"[\s\S]*?<\/aside>/)[0];
  assert.ok((know.replace(/<[^>]+>/g, '').match(/[.!?]/g) || []).length <= 3);
  assert.match(know, /href="\/privacy\/"/);
  assert.doesNotMatch(page, /PostgreSQL|SQL|контейнер|Core|токен|CORE_SEARCH|API/i);
  assert.ok(page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).length < 520);
});

test('the AI page is indexable and its SEO text is in the static HTML', () => {
  assert.match(page, /<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.doesNotMatch(page, /noindex/);
  assert.match(page, /<section class="ai-seo">[\s\S]*Как сформулировать запрос[\s\S]*Нашли лот — что дальше/);
  assert.ok(page.indexOf('id="ai-lot-form"') < page.indexOf('class="ai-seo"'));      // the form is not pushed down by the text
  assert.match(page, /<link rel="canonical" href="https:\/\/torgatlas\.ru\/ai-poisk-lotov\/">/);
});
