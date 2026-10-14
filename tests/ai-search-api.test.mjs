import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/ai-lot-search.mjs';

function response() {
  return { headers:{}, code:0, body:null, setHeader(k,v){this.headers[k]=v;}, status(code){this.code=code;return this;}, json(body){this.body=body;return body;} };
}
function gates(value) {
  for (const key of ['AI_LOT_SEARCH_ENABLED','AI_LOT_SECURITY_APPROVED','AI_LOT_LEGAL_APPROVED']) process.env[key]=value;
}

test('API remains disabled unless every release gate is true', async () => {
  gates('false'); const res=response();
  await handler({method:'POST',headers:{},body:{}},res);
  assert.equal(res.code,503); assert.equal(res.body.code,'NOT_ENABLED');
});

test('API preserves content type and body size protections', async () => {
  gates('true');
  const badType=response(); await handler({method:'POST',headers:{origin:'https://torgatlas.ru','content-type':'text/plain'},body:{}},badType);
  assert.equal(badType.code,415);
  const large=response(); await handler({method:'POST',headers:{origin:'https://torgatlas.ru','content-type':'application/json'},body:{query:'x'.repeat(1500)}},large);
  assert.equal(large.code,413);
  gates('false');
});

test('unsupported source returns transparent empty result without outbound research', async () => {
  gates('true'); const res=response();
  await handler({method:'POST',headers:{origin:'https://torgatlas.ru','content-type':'application/json'},body:{query:'найди имущество на торгах',source:'bankruptcy',limit:5},socket:{remoteAddress:'127.0.0.1'}},res);
  assert.equal(res.code,200); assert.deepEqual(res.body.lots,[]); assert.equal(res.body.reason,'NO_VERIFIED_SOURCE_ADAPTER');
  gates('false');
});
