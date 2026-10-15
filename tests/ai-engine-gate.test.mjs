import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {
  allowedPublicUrl, configureSourceRegistry, safePublicGet, utplCatalogUrl, publicResearchMiniSearch, SOURCE_REGISTRY, OVERALL_DEADLINE_MS
} from '../lib/torgatlas-public-web-research.mjs';

const base = [
  { id: 'utpl', host: 'bankrupt.utpl.ru', status: 'LIVE_LOT_VERIFIED', edge_enabled: true, template_family: 'all-torgi' },
  { id: 'etpu', host: 'bankrupt.etpu.ru', status: 'VERIFIED_PUBLIC_ACCESS', edge_enabled: true, template_family: 'all-torgi' },
  { id: 'cand', host: 'candidate.example.ru', status: 'CANDIDATE', edge_enabled: true, template_family: 'all-torgi' },
  { id: 'off', host: 'disabled.example.ru', status: 'LIVE_LOT_VERIFIED', edge_enabled: false },
  { id: 'wild', host: '*.ru', status: 'LIVE_LOT_VERIFIED', edge_enabled: true },
  { id: 'rest', host: 'restricted.example.ru', status: 'RESTRICTED', edge_enabled: true }
];
configureSourceRegistry({ sources: base });

test('only edge-enabled verified exact hosts are allowed; candidates, restricted, disabled and wildcards are not', () => {
  const ok = 'https://bankrupt.utpl.ru/public/auctions-all/';
  assert.equal(allowedPublicUrl(ok), ok);
  assert.equal(allowedPublicUrl('https://bankrupt.etpu.ru/public/public-offers-all/'), 'https://bankrupt.etpu.ru/public/public-offers-all/');
  for (const host of ['candidate.example.ru', 'disabled.example.ru', 'restricted.example.ru', 'evil.ru', 'bankrupt.utpl.ru.evil.ru', 'x.bankrupt.utpl.ru']) {
    assert.equal(allowedPublicUrl(`https://${host}/public/auctions-all/`), null, host);
  }
  assert.throws(() => utplCatalogUrl('auction', 'candidate.example.ru'), /SOURCE_NOT_ALLOWED/);
});

test('URL guard rejects http, ports, credentials, fragments, other paths and queries', () => {
  for (const bad of ['http://bankrupt.utpl.ru/public/auctions-all/', 'https://bankrupt.utpl.ru:8443/public/auctions-all/',
    'https://u:p@bankrupt.utpl.ru/public/auctions-all/', 'https://bankrupt.utpl.ru/public/auctions-all/#x', 'https://bankrupt.utpl.ru/admin/',
    'https://bankrupt.utpl.ru/public/auctions-all/?q=1', 'https://127.0.0.1/public/auctions-all/', 'https://169.254.169.254/latest/meta-data/']) {
    assert.equal(allowedPublicUrl(bad), null, bad);
  }
});

test('a malformed registry fails closed (no hosts) and CA pin mismatch disables the host', () => {
  configureSourceRegistry({ sources: 'bad' });
  assert.equal(allowedPublicUrl('https://bankrupt.utpl.ru/public/auctions-all/'), null);
  configureSourceRegistry({ sources: [{ id: 'g', host: 'torgi.gov.ru', status: 'VERIFIED_PUBLIC_ACCESS', edge_enabled: true,
    tls_ca: [{ path: 'config/trust/russian-trusted-root-ca.pem', sha256: '0'.repeat(64) }] }] });
  assert.equal(allowedPublicUrl('https://torgi.gov.ru/new/api/public/lotcards/abc'), null);
  configureSourceRegistry({ sources: [{ id: 'g', host: 'torgi.gov.ru', status: 'VERIFIED_PUBLIC_ACCESS', edge_enabled: true,
    tls_ca: JSON.parse(fs.readFileSync('config/ai-sources.registry.json', 'utf8')).sources.find(s => s.id === 'gis-torgi').tls_ca }] });
  assert.ok(allowedPublicUrl('https://torgi.gov.ru/new/api/public/lotcards/abc'), 'pinned CA files match registry pins');
  configureSourceRegistry({ sources: base });
});

test('gate mode: CONNECT carries the hostname, no local DNS, no fallback to HTTPS_PROXY, invalid gate URLs refused', async () => {
  const seen = [];
  const gate = http.createServer();
  gate.on('connect', (req, socket) => { seen.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  await new Promise(r => gate.listen(0, '127.0.0.1', r));
  const port = gate.address().port;
  const prev = { g: process.env.AI_LOT_EGRESS_GATE, p: process.env.HTTPS_PROXY };
  let dnsCalls = 0;
  try {
    // The gate must be a single-label service name; "localhost" is accepted for the test, IPs/FQDNs/creds are not.
    process.env.HTTPS_PROXY = 'http://attacker.example:3128';
    process.env.AI_LOT_EGRESS_GATE = `http://localhost:${port}`;
    await assert.rejects(safePublicGet('https://bankrupt.utpl.ru/public/auctions-all/', { expectedType: 'html', lookupFn: async () => { dnsCalls += 1; return []; } }), /PROXY_CONNECT_DENIED/);
    assert.deepEqual(seen, ['bankrupt.utpl.ru:443']);
    assert.equal(dnsCalls, 0, 'engine performs no local DNS in gate mode');
    for (const badGate of ['http://127.0.0.1:3128', 'http://edge.example.com:3128', 'http://user:pw@edge:3128', 'https://edge:3128', 'http://10.0.0.5:3128']) {
      process.env.AI_LOT_EGRESS_GATE = badGate;
      await assert.rejects(safePublicGet('https://bankrupt.utpl.ru/public/auctions-all/', { expectedType: 'html' }), /PROXY_CONFIG_INVALID/, badGate);
    }
    process.env.AI_LOT_EGRESS_GATE = `http://localhost:${port}`;
    await assert.rejects(safePublicGet('https://candidate.example.ru/public/auctions-all/', { expectedType: 'html' }), /SOURCE_NOT_ALLOWED/);
    assert.equal(seen.length, 1, 'candidate host never reaches the gate');
  } finally {
    for (const [k, v] of [['AI_LOT_EGRESS_GATE', prev.g], ['HTTPS_PROXY', prev.p]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    gate.close();
  }
});

test('failed gate (connection refused) is a clean error, not a hang or a direct connection', async () => {
  const prev = process.env.AI_LOT_EGRESS_GATE;
  process.env.AI_LOT_EGRESS_GATE = 'http://localhost:1';
  try {
    await assert.rejects(safePublicGet('https://bankrupt.utpl.ru/public/auctions-all/', { expectedType: 'html', timeoutMs: 1500 }), /SOURCE_NETWORK_ERROR|TIMEOUT/);
  } finally { if (prev === undefined) delete process.env.AI_LOT_EGRESS_GATE; else process.env.AI_LOT_EGRESS_GATE = prev; }
});

test('overall deadline returns a definite TIMEOUT result before the nginx limit', async () => {
  assert.ok(OVERALL_DEADLINE_MS < 25_000);
  const result = await publicResearchMiniSearch('квартира в Москве торги банкротство', {
    deadlineMs: 150, cacheEnabled: false, requestHtml: () => new Promise(() => {}), requestJson: () => new Promise(() => {}), rateKey: 'deadline-test'
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.reason, 'TIME_BUDGET_EXHAUSTED');
  assert.deepEqual(result.lots, []);
});

test('registry listing exposes ids and statuses only', () => {
  configureSourceRegistry({ sources: base });
  assert.ok(SOURCE_REGISTRY.every(row => Object.keys(row).sort().join() === 'id,status'));
});

test('robots Crawl-delay is honoured: per-host pacing, over-limit requests are skipped not sent', async () => {
  const stamps = [];
  const gate = http.createServer();
  gate.on('connect', (req, socket) => { stamps.push([req.url, Date.now()]); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  await new Promise(r => gate.listen(0, '127.0.0.1', r));
  const prev = process.env.AI_LOT_EGRESS_GATE;
  process.env.AI_LOT_EGRESS_GATE = `http://localhost:${gate.address().port}`;
  configureSourceRegistry({ sources: [
    { id: 'utpl', host: 'bankrupt.utpl.ru', status: 'LIVE_LOT_VERIFIED', edge_enabled: true, template_family: 'all-torgi', min_interval_ms: 3000 },
    { id: 'gis-torgi', host: 'torgi.gov.ru', status: 'VERIFIED_PUBLIC_ACCESS', edge_enabled: true, min_interval_ms: 60000 },
    { id: 'etpu', host: 'bankrupt.etpu.ru', status: 'VERIFIED_PUBLIC_ACCESS', edge_enabled: true, template_family: 'all-torgi' }] });
  try {
    const u = 'https://bankrupt.utpl.ru/public/auctions-all/';
    await assert.rejects(safePublicGet(u, { expectedType: 'html' }), /PROXY_CONNECT_DENIED/);
    await assert.rejects(safePublicGet(u, { expectedType: 'html' }), /PROXY_CONNECT_DENIED/);
    assert.ok(stamps[1][1] - stamps[0][1] >= 2900, `second UTPL request waited ${stamps[1][1] - stamps[0][1]} ms`);
    const other = Date.now();
    await assert.rejects(safePublicGet('https://bankrupt.etpu.ru/public/auctions-all/', { expectedType: 'html' }), /PROXY_CONNECT_DENIED/);
    assert.ok(Date.now() - other < 1500, 'a different host is not delayed by UTPL pacing');
    const gis = 'https://torgi.gov.ru/new/api/public/lotcards/abc';
    await assert.rejects(safePublicGet(gis, { expectedType: 'json' }), /PROXY_CONNECT_DENIED|TLS|SOURCE/);
    const before = stamps.length;
    await assert.rejects(safePublicGet(gis, { expectedType: 'json' }), /SOURCE_PACING_BUSY/);
    assert.equal(stamps.length, before, 'GIS request inside the 60 s window is never sent');
  } finally {
    if (prev === undefined) delete process.env.AI_LOT_EGRESS_GATE; else process.env.AI_LOT_EGRESS_GATE = prev;
    configureSourceRegistry({ sources: base }); gate.close();
  }
});
