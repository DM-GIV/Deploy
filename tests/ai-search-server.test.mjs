import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAiSearchServer } from '../services/ai-search/server.mjs';

function gates(value) {
  for (const key of ['AI_LOT_SEARCH_ENABLED', 'AI_LOT_SECURITY_APPROVED', 'AI_LOT_LEGAL_APPROVED']) process.env[key] = value;
}

async function withServer(run) {
  const server = createAiSearchServer({ trustProxy: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('site-owned AI service is healthy but fail-closed by default', async () => {
  gates('false');
  await withServer(async base => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, feature_enabled: false });

    const status = await fetch(`${base}/api/ai-lot-search`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).enabled, false);

    const post = await fetch(`${base}/api/ai-lot-search`, {
      method: 'POST', headers: { Origin: 'https://torgatlas.ru', 'Content-Type': 'application/json', 'X-Real-IP': '203.0.113.5' },
      body: JSON.stringify({ query: 'найди имущество на торгах', source: 'all', limit: 5 })
    });
    assert.equal(post.status, 503);
    assert.equal((await post.json()).code, 'NOT_ENABLED');
  });
});

test('site-owned service rejects invalid JSON, oversized bodies and unrelated routes', async () => {
  gates('false');
  await withServer(async base => {
    const invalid = await fetch(`${base}/api/ai-lot-search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'INVALID_JSON');

    const oversized = await fetch(`${base}/api/ai-lot-search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'x'.repeat(1600) }) });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'BODY_TOO_LARGE');

    assert.equal((await fetch(`${base}/private`)).status, 404);
    assert.equal((await fetch(`${base}/api/ai-lot-search`, { method: 'DELETE' })).status, 405);
  });
});

test('deployment templates stay loopback-only, resource-limited and fail-closed', () => {
  const compose = fs.readFileSync('services/ai-search/compose.yml', 'utf8');
  const env = fs.readFileSync('services/ai-search/env.example', 'utf8');
  const nginx = fs.readFileSync('services/ai-search/nginx/torgatlas-ai.inc', 'utf8');
  const zone = fs.readFileSync('services/ai-search/nginx/30-torgatlas-ai-zone.conf', 'utf8');
  assert.match(compose, /127\.0\.0\.1:18082:8080/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /mem_limit: 192m/);
  assert.match(compose, /cpus: 0\.50/);
  assert.match(env, /AI_LOT_SEARCH_ENABLED=false/);
  assert.match(env, /AI_LOT_SECURITY_APPROVED=false/);
  assert.match(env, /AI_LOT_LEGAL_APPROVED=false/);
  assert.match(nginx, /location = \/api\/ai-lot-search/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:18082/);
  assert.match(nginx, /limit_req zone=torgatlas_ai_search/);
  assert.match(zone, /limit_req_zone \$binary_remote_addr/);
  assert.doesNotMatch(`${compose}\n${nginx}`, /auction-analytics|postgres|redis/i);
});
