import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as getConfig } from '../api/lead-config.mjs';
import { POST as submit } from '../api/lead.mjs';

const names = [
  'DIRECT_LEADS_ENABLED', 'DIRECT_LEADS_LEGAL_APPROVED',
  'LEAD_DELIVERY_URL', 'LEAD_DELIVERY_SECRET', 'LEAD_RECIPIENT_ID',
  'LEAD_ALLOWED_ORIGIN', 'LEAD_TURNSTILE_SITE_KEY', 'LEAD_TURNSTILE_SECRET'
];
const prior = Object.fromEntries(names.map(key => [key, process.env[key]]));
const realFetch = globalThis.fetch;
const origin = 'https://deploy-pi-blond-52.vercel.app';
const valid = {
  DIRECT_LEADS_ENABLED:'true',
  DIRECT_LEADS_LEGAL_APPROVED:'true',
  LEAD_DELIVERY_URL:'https://receiver.example.org/inbox',
  LEAD_DELIVERY_SECRET:'private-token-in-tests',
  LEAD_RECIPIENT_ID:'verified-owner',
  LEAD_ALLOWED_ORIGIN:origin,
  LEAD_TURNSTILE_SITE_KEY:'0x4AAAAAA_test_key_123456',
  LEAD_TURNSTILE_SECRET:'private-turnstile-key-in-tests'
};
const payload = {
  kind:'lot', contact:'user@example.com',
  message:'Здравствуйте. Хочу проверить документы по опубликованному лоту и условия участия.',
  privacyVersion:'2026-10-11', consent:true, website:'', turnstileToken:'test-challenge-token'
};
function reset() {
  for (const key of names) delete process.env[key];
  globalThis.fetch = realFetch;
}
function enable() { reset(); Object.assign(process.env, valid); }
function req(body = payload, hdr = {}) {
  return new Request(origin + '/api/lead', {
    method:'POST', headers:{ origin, 'content-type':'application/json', ...hdr },
    body:JSON.stringify(body)
  });
}
test.after(() => {
  reset();
  for (const key of names) {
    if (prior[key] !== undefined) process.env[key] = prior[key];
  }
});
test('feature defaults off; no contact information is read or forwarded', async () => {
  reset();
  globalThis.fetch = () => { throw new Error('NO NETWORK ALLOWED'); };
  const cfg = await (await getConfig()).json();
  assert.deepEqual(cfg, {enabled:false});
  const response = await submit(req());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code,'NOT_CONFIGURED');
});
test('feature gate needs explicit legal approval and every required setting', async () => {
  enable();
  assert.equal((await (await getConfig()).json()).enabled,true);
  delete process.env.LEAD_TURNSTILE_SECRET;
  assert.equal((await (await getConfig()).json()).enabled,false);
  process.env.LEAD_TURNSTILE_SECRET=valid.LEAD_TURNSTILE_SECRET;
  delete process.env.DIRECT_LEADS_LEGAL_APPROVED;
  assert.equal((await submit(req())).status,503);
});
test('same origin, content type, input length and consent must pass before captcha', async () => {
  enable();
  globalThis.fetch = () => { throw new Error('No network expected'); };
  assert.equal((await submit(req(payload,{origin:'https://stranger.example.org'}))).status,403);
  assert.equal((await submit(req(payload,{'content-type':'text/plain'}))).status,415);
  assert.equal((await submit(req({...payload,consent:false}))).status,422);
  assert.equal((await submit(req({...payload,website:'honeypot-filled'}))).status,422);
  assert.equal((await submit(req({...payload,message:'short'}))).status,422);
  assert.equal((await submit(req({...payload,message:'A'.repeat(13000)}))).status,413);
});
test('invalid or wrong-host captcha never reaches recipient', async () => {
  enable();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({success:true,hostname:'wrong.example.org'});
  };
  const response=await submit(req());
  assert.equal(response.status,403);
  assert.equal(calls,1);
});
test('only explicit upstream acceptance produces a success receipt', async () => {
  enable();
  let received;
  globalThis.fetch = async (url,opts) => {
    if (String(url).includes('siteverify')) return Response.json({success:true,hostname:new URL(origin).hostname});
    received = JSON.parse(opts.body);
    assert.equal(opts.headers.Authorization,'Bearer '+valid.LEAD_DELIVERY_SECRET);
    return Response.json({accepted:true,id:received.id});
  };
  const response = await submit(req());
  const result = await response.json();
  assert.equal(response.status,200);
  assert.equal(result.code,'ACCEPTED');
  assert.equal(result.receipt,received.id);
  assert.equal(received.contact,payload.contact);
  assert.equal(received.message,payload.message);
  assert.equal(received.recipient,valid.LEAD_RECIPIENT_ID);
});
test('unconfirmed recipient must fail without claiming delivery', async () => {
  enable();
  globalThis.fetch = async url =>
    String(url).includes('siteverify')
      ? Response.json({success:true,hostname:new URL(origin).hostname})
      : Response.json({accepted:false});
  const response = await submit(req());
  assert.equal(response.status,502);
  assert.equal((await response.json()).code,'DELIVERY_UNCONFIRMED');
});
