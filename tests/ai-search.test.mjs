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
  assert.match(page, /ai-search\.js\?v=\d+/);
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

test('page states the five-result cap and offers an inactive catalogue link marked «Скоро»', () => {
  assert.match(page, /<p class="ai-limit">До 5 результатов<\/p>/);
  assert.match(page, /Посмотреть больше лотов в каталоге ТоргАтлас/);
  const cta = page.match(/<p class="ai-catalog-cta"[\s\S]*?<\/p>/)[0];
  assert.match(cta, />Скоро</);
  assert.doesNotMatch(cta, /<a\b|href=/);
  assert.match(cta, /aria-disabled="true"/);
  assert.match(cta, /hidden/);
  assert.match(script, /catalogCta\.hidden = incomplete;/);
  assert.match(script, /data\.lots\.slice\(0, 5\)/);
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
  assert.doesNotMatch(page, /До 10 результатов|10 результатов/);
  assert.equal((page.match(/До 5 результатов/g) || []).length, 2);
});

test('page never claims a catalogue search statically; the mode label comes from the real engine mode', () => {
  assert.doesNotMatch(page, /Поиск по каталогу(?! ТоргАтлас)/);
  assert.match(page, /id="ai-eyebrow">Бета-версия</);
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
