import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync('assets/contact-copy.js', 'utf8');

function harness(attributes) {
  let listener;
  let prevented = false;
  const copied = [];
  const status = { textContent: '' };
  const node = {
    getAttribute(name) { return attributes[name] || null; },
    closest(selector) {
      if (selector.includes('[data-copy]')) return this;
      if (selector.includes('.contact-panel')) return { querySelector: () => status };
      return null;
    }
  };
  const sandbox = {
    document: { addEventListener(_name, callback) { listener = callback; } },
    navigator: { clipboard: { writeText(value) { copied.push(value); return Promise.resolve(); } } },
    window: {}
  };
  vm.runInNewContext(code, sandbox);
  return {
    copied, status,
    async click() {
      listener({ target: node, preventDefault() { prevented = true; } });
      await new Promise(resolve => setImmediate(resolve));
      return prevented;
    }
  };
}

test('MAX copy action prevents navigation and announces success', async () => {
  const page = harness({ 'data-copy': '+79800512327', 'data-channel': 'max' });
  assert.equal(await page.click(), true);
  assert.deepEqual(page.copied, ['+79800512327']);
  assert.match(page.status.textContent, /MAX/);
});

test('tel and mailto best-effort copy never prevents native navigation', async () => {
  const page = harness({ 'data-copy-before-nav': 'dmitry.g.iv@yandex.ru', 'data-channel': 'email' });
  assert.equal(await page.click(), false);
  assert.deepEqual(page.copied, ['dmitry.g.iv@yandex.ru']);
});
