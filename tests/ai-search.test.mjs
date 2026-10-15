import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('ai-poisk-lotov/index.html', 'utf8');
const script = fs.readFileSync('assets/ai-search.js', 'utf8');

test('AI search starts fail-closed and explains that input is not sent', () => {
  assert.match(page, /id="ai-query"[^>]*disabled/);
  assert.doesNotMatch(page, /id="ai-source"/);
  assert.doesNotMatch(page, /id="ai-limit"/);
  assert.match(page, /Текст запроса не отправляется до его включения/);
  assert.doesNotMatch(page, /Поиск по .* в Яндексе/);
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
