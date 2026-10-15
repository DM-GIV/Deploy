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
  assert.match(script, /JSON\.stringify\(\{ query \}\)/);
  assert.doesNotMatch(script, /yandex\.ru\/search/);
});
