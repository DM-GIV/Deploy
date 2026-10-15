import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('ai-poisk-lotov/index.html', 'utf8');
const script = fs.readFileSync('assets/ai-search.js', 'utf8');

test('AI search starts fail-closed and explains that input is not sent', () => {
  assert.match(page, /id="ai-query"[^>]*disabled/);
  assert.doesNotMatch(page, /id="ai-source"/);
  assert.doesNotMatch(page, /id="ai-limit"/);
  assert.match(page, /Текст запроса отправляется только при нажатии «Найти лоты»/);
  assert.doesNotMatch(page, /Поиск по .* в Яндексе/);
});

test('public description lists only the sources enabled in the registry and never a disabled one as active', () => {
  const registry = JSON.parse(fs.readFileSync('config/ai-sources.registry.json', 'utf8'));
  const enabled = registry.sources.filter(source => source.edge_enabled === true).map(source => source.id).sort();
  assert.deepEqual(enabled, ['centerr-bankrupt', 'etpu', 'utpl']);
  const note = page.match(/<p class="ai-beta-note">(.*?)<\/p>/s)[1];
  const description = page.match(/<meta name="description" content="([^"]*)"/)[1];
  for (const text of [note.split('ГИС Торги пока не подключены')[0], description]) {
    assert.doesNotMatch(text, /ГИС|torgi\.gov|ЕФРСБ|МЭТС/);
  }
  assert.match(note, /УТПЛ[\s\S]*УЭТП[\s\S]*Центр реализации/);
  assert.match(note, /ГИС Торги пока не подключены/);
  assert.match(description, /УТПЛ, УЭТП и Центр реализации/);
});

test('AI search checks status with GET before it permits a POST query', () => {
  assert.match(script, /let searchReady\s*=\s*false/);
  assert.match(script, /method:\s*'GET'/);
  assert.match(script, /if \(!searchReady\)/);
  assert.match(script, /method:\s*'POST'/);
  assert.match(script, /setSearchReady\(false\)/);
});

test('AI search explains coverage and provides real next-step CTAs', () => {
  assert.match(page, /class="ai-example"/);
  assert.match(page, /id="ai-results-coverage"/);
  assert.match(script, /coverage_note/);
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
