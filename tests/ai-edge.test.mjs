import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import { parseConnectTarget, resolveAllowed, createGate, createForwarder, loadAllowedHosts, ALLOWED_HOSTS } from '../services/ai-search/edge.mjs';

const HOSTS = ['torgi.gov.ru', 'fedresurs.ru', 'm-ets.ru', 'bankrupt.utpl.ru'];

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const talk = (port, payload) => new Promise(resolve => {
  const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
  let out = '';
  socket.on('data', d => { out += d.toString('latin1'); if (out.includes('\r\n\r\n')) socket.destroy(); });
  socket.on('close', () => resolve(out));
  setTimeout(() => socket.destroy(), 1500);
});

test('gate target parser accepts only the four public hosts on 443', () => {
  assert.deepEqual(parseConnectTarget('CONNECT torgi.gov.ru:443 HTTP/1.1', HOSTS), { host: 'torgi.gov.ru', port: 443 });
  for (const bad of ['CONNECT evil.example:443 HTTP/1.1', 'CONNECT torgi.gov.ru:80 HTTP/1.1', 'CONNECT 127.0.0.1:443 HTTP/1.1',
    'CONNECT torgi.gov.ru.evil.com:443 HTTP/1.1', 'GET / HTTP/1.1', 'CONNECT [::1]:443 HTTP/1.1', 'CONNECT 169.254.169.254:443 HTTP/1.1']) {
    assert.equal(parseConnectTarget(bad, HOSTS), null, bad);
  }
});

test('DNS answers with any private or link-local address are refused (rebinding defence)', async () => {
  assert.equal(await resolveAllowed('torgi.gov.ru', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }]), null);
  assert.equal(await resolveAllowed('torgi.gov.ru', async () => [{ address: '169.254.169.254', family: 4 }]), null);
  assert.equal(await resolveAllowed('torgi.gov.ru', async () => [{ address: '127.0.0.1', family: 4 }]), null);
  assert.equal(await resolveAllowed('torgi.gov.ru', async () => []), null);
  assert.equal((await resolveAllowed('torgi.gov.ru', async () => [{ address: '95.167.245.141', family: 4 }])).address, '95.167.245.141');
});

test('gate returns 403 for forbidden targets and never opens an upstream socket', async () => {
  let connects = 0;
  const gate = createGate({ allowedHosts: HOSTS, lookupFn: async () => [{ address: '10.1.1.1', family: 4 }], connectFn: () => { connects += 1; throw new Error('must not connect'); } });
  const port = await listen(gate);
  assert.match(await talk(port, 'CONNECT evil.example:443 HTTP/1.1\r\n\r\n'), /403/);
  assert.match(await talk(port, 'CONNECT torgi.gov.ru:443 HTTP/1.1\r\n\r\n'), /403/);
  assert.match(await talk(port, 'GET http://torgi.gov.ru/ HTTP/1.1\r\n\r\n'), /403/);
  assert.equal(connects, 0);
  gate.close();
});

test('gate tunnels to the pinned public IP and enforces the tunnel cap', async () => {
  const upstream = net.createServer(s => s.on('data', d => s.write(Buffer.concat([Buffer.from('echo:'), d]))));
  const upPort = await listen(upstream);
  let target;
  const gate = createGate({
    allowedHosts: HOSTS,
    lookupFn: async () => [{ address: '95.167.245.141', family: 4 }],
    connectFn: opts => { target = opts; return net.connect({ host: '127.0.0.1', port: upPort }); },
    limits: { maxTunnels: 1, connectTimeoutMs: 1000, tunnelLifetimeMs: 3000, idleMs: 3000, headBytes: 2048 }
  });
  const port = await listen(gate);
  const first = net.connect(port, '127.0.0.1');
  first.write('CONNECT torgi.gov.ru:443 HTTP/1.1\r\n\r\n');
  const reply = await new Promise(resolve => first.once('data', d => resolve(d.toString())));
  assert.match(reply, /200/);
  assert.equal(target.host, '95.167.245.141');
  assert.equal(target.port, 443);
  assert.match(await talk(port, 'CONNECT torgi.gov.ru:443 HTTP/1.1\r\n\r\n'), /429/);
  first.destroy(); gate.close(); upstream.close();
});

test('forwarder passes bytes to the single configured upstream only', async () => {
  const upstream = net.createServer(s => s.on('data', d => s.end(`up:${d}`)));
  const upPort = await listen(upstream);
  const fwd = createForwarder({ targetHost: '127.0.0.1', targetPort: upPort });
  const port = await listen(fwd);
  const out = await new Promise(resolve => { const c = net.connect(port, '127.0.0.1', () => c.write('hi')); let b=''; c.on('data', d => b+=d); c.on('close', () => resolve(b)); });
  assert.equal(out, 'up:hi');
  fwd.close(); upstream.close();
});

test('registry drives the edge allowlist: exact verified hosts only, no wildcards, candidates never enabled', () => {
  const registry = JSON.parse(fs.readFileSync('config/ai-sources.registry.json', 'utf8'));
  const statuses = new Set(registry.statuses);
  assert.deepEqual([...statuses].sort(), ['BLOCKED', 'CANDIDATE', 'LIVE_LOT_VERIFIED', 'RESTRICTED', 'VERIFIED_PUBLIC_ACCESS']);
  for (const source of registry.sources) {
    assert.ok(statuses.has(source.status), source.id);
    assert.match(source.host, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, source.id);
    assert.doesNotMatch(source.host, /\*/);
    if (['CANDIDATE', 'RESTRICTED', 'BLOCKED'].includes(source.status)) {
      assert.ok(!ALLOWED_HOSTS.includes(source.host), `${source.id} must not be reachable through the edge`);
    }
  }
  assert.equal(new Set(registry.sources.map(s => s.host)).size, registry.sources.length);
  assert.deepEqual([...ALLOWED_HOSTS].sort(), [...loadAllowedHosts()].sort());
  assert.ok(ALLOWED_HOSTS.every(host => registry.sources.find(s => s.host === host).edge_enabled === true));
  assert.ok(registry.sources.length >= 22);
});

test('discovered ETPs are stored as non-enabled candidates and bad hosts are refused', async () => {
  const { addCandidate } = await import('../scripts/registry-add-candidate.mjs');
  const registry = { sources: [{ host: 'm-ets.ru' }] };
  assert.equal(addCandidate(registry, 'New-ETP.ru', 'Новая ЭТП', ['rent']), true);
  assert.equal(addCandidate(registry, 'new-etp.ru', 'dup', []), false);
  const added = registry.sources[1];
  assert.equal(added.status, 'CANDIDATE'); assert.equal(added.edge_enabled, false);
  for (const bad of ['*.ru', 'ru', '127.0.0.1', 'a b.ru', 'x.ru/path']) assert.throws(() => addCandidate(registry, bad, 'x', []), /INVALID_HOST/, bad);
});

test('forwarder connect timeout does not cut slow (long search) responses', async () => {
  const upstream = net.createServer(s => s.on('data', () => setTimeout(() => s.end('slow-ok'), 400)));
  const upPort = await listen(upstream);
  const fwd = createForwarder({ targetHost: '127.0.0.1', targetPort: upPort, connectTimeoutMs: 100 });
  const port = await listen(fwd);
  const out = await new Promise(resolve => { const c = net.connect(port, '127.0.0.1', () => c.write('x')); let b=''; c.on('data', d => b+=d); c.on('close', () => resolve(b)); });
  assert.equal(out, 'slow-ok');
  fwd.close(); upstream.close();
});

test('every edge-enabled registry host can be linked by the UI (no silently dropped result cards)', () => {
  const ui = fs.readFileSync('assets/ai-search.js', 'utf8');
  const list = JSON.parse(/const allowedHosts = (\[[^\]]*\]);/.exec(ui)[1].replace(/'/g, '"'));
  const sources = JSON.parse(fs.readFileSync('config/ai-sources.registry.json', 'utf8')).sources;
  for (const host of ALLOWED_HOSTS) assert.ok(list.some(h => host === h || host.endsWith(`.${h}`)), `${host} missing in UI allowedHosts`);
  for (const source of sources.filter(s => ALLOWED_HOSTS.includes(s.host))) assert.match(ui, new RegExp(`['"]?${source.id}['"]?:\\s*'`), `${source.id} missing in UI sourceNames`);
});
