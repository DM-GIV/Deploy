import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('ai-poisk-lotov/index.html', 'utf8');
const script = fs.readFileSync('assets/ai-search.js', 'utf8');

test('AI search starts fail-closed and explains that input is not sent', () => {
  assert.match(page, /id="ai-query"[^>]*disabled/);
  assert.match(page, /id="ai-source" disabled/);
  assert.match(page, /id="ai-limit" disabled/);
  assert.match(page, /Текст запроса не отправляется до его включения/);
  assert.match(page, /предварительные публикации только после отдельного включения/);
});

test('AI search checks status with GET before it permits a POST query', () => {
  assert.match(script, /let searchReady=false/);
  assert.match(script, /method:'GET'/);
  assert.match(script, /if\(!searchReady\)\{notice\('Автоматический поиск не включён/);
  assert.match(script, /method:'POST'/);
  assert.match(script, /setSearchReady\(false\)/);
});
