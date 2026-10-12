import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = fs.readFileSync(new URL('../assets/lead-submit.js', import.meta.url), 'utf8');

test('disabled direct-lead configuration never loads captcha or inserts form', async () => {
  const handlers = Object.create(null);
  const fetches = [];
  const scripts = [];
  const sandbox = {
    window: { addEventListener: (type, fn) => { handlers[type] = fn; } },
    document: { head: { appendChild: node => scripts.push(node) } },
    fetch: async url => { fetches.push(url); return { ok: true, json: async () => ({enabled:false}) }; },
    Promise, Object, Error
  };
  vm.runInNewContext(file, sandbox);
  assert.equal(typeof handlers['lead:draft-ready'], 'function');
  handlers['lead:draft-ready']({detail:{kind:'lot'}});
  handlers['lead:draft-ready']({detail:{kind:'search'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetches, ['/api/lead-config']);
  assert.deepEqual(scripts, []);
});

test('SmartCaptcha contract, UUID receipt check, manual fallback and no Turnstile', () => {
  assert.match(file, /smartcaptcha\.cloud\.yandex\.ru\/captcha\.js/);
  assert.match(file, /smartCaptcha\.render/);
  assert.match(file, /smartCaptcha\.subscribe/);
  assert.match(file, /token-expired/);
  assert.match(file, /network-error/);
  assert.match(file, /randomUUID/);
  assert.match(file, /id:requestId/);
  assert.match(file, /captchaToken:token/);
  assert.match(file, /body\.accepted !== true/);
  assert.match(file, /body\.id !== requestId/);
  assert.match(file, /body\.receipt !== requestId/);
  assert.match(file, /\/privacy\//);
  assert.match(file, /lead_direct_unconfirmed/);
  assert.doesNotMatch(file.toLowerCase(), /turnstile|cloudflare/);
});
