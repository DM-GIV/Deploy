import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { isPrivateIp } from '../../lib/torgatlas-public-web-research.mjs';

// Dedicated TorgAtlas edge: (1) allowlist CONNECT gate for the AI-search container, which has no route out;
// (2) loopback TCP forwarder so nginx can reach the daemon on 127.0.0.1:18082. No other traffic is possible.
const EDGE_STATUSES = new Set(['VERIFIED_PUBLIC_ACCESS', 'LIVE_LOT_VERIFIED']);
// Exact hostnames only, from the reviewed registry: edge_enabled === true AND a verified status. No wildcards.
export function loadAllowedHosts(path = process.env.AI_SOURCES_REGISTRY || new URL('../../config/ai-sources.registry.json', import.meta.url)) {
  const registry = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Object.freeze(registry.sources.filter(s => s.edge_enabled === true && EDGE_STATUSES.has(s.status) && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s.host)).map(s => s.host));
}
export const ALLOWED_HOSTS = loadAllowedHosts();
export const LIMITS = Object.freeze({ maxTunnels: 8, connectTimeoutMs: 4_000, tunnelLifetimeMs: 20_000, idleMs: 8_000, headBytes: 2_048 });

export function parseConnectTarget(line, allowed = ALLOWED_HOSTS) {
  const match = /^CONNECT ([a-z0-9.-]{1,253}):(\d{1,5}) HTTP\/1\.[01]$/i.exec(String(line || '').trim());
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (match[2] !== '443' || !allowed.includes(host)) return null;
  return { host, port: 443 };
}

export async function resolveAllowed(host, lookupFn = dns.lookup) {
  const rows = await lookupFn(host, { all: true, verbatim: true });
  if (!Array.isArray(rows) || !rows.length || rows.some(row => isPrivateIp(row.address))) return null;
  return rows[0];
}

export function createGate({ lookupFn = dns.lookup, connectFn = net.connect, limits = LIMITS, allowedHosts = ALLOWED_HOSTS } = {}) {
  let active = 0;
  return net.createServer(client => {
    let head = '';
    client.setTimeout(limits.idleMs, () => client.destroy());
    client.on('error', () => client.destroy());
    const onData = async chunk => {
      head += chunk.toString('latin1');
      if (head.length > limits.headBytes) { client.end('HTTP/1.1 431 Too Large\r\n\r\n'); return; }
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      client.off('data', onData);
      client.pause();
      const target = parseConnectTarget(head.slice(0, head.indexOf('\r\n')), allowedHosts);
      if (!target) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      if (active >= limits.maxTunnels) { client.end('HTTP/1.1 429 Busy\r\n\r\n'); return; }
      active += 1;
      let released = false;
      const release = () => { if (!released) { released = true; active -= 1; } };
      client.on('close', release);
      try {
        const row = await resolveAllowed(target.host, lookupFn);
        if (!row) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
        const upstream = connectFn({ host: row.address, port: 443, timeout: limits.connectTimeoutMs });
        upstream.on('error', () => { if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); upstream.destroy(); });
        upstream.on('timeout', () => upstream.destroy());
        upstream.once('connect', () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          const rest = Buffer.from(head.slice(end + 4), 'latin1');
          if (rest.length) upstream.write(rest);
          client.pipe(upstream); upstream.pipe(client); client.resume();
          const timer = setTimeout(() => { client.destroy(); upstream.destroy(); }, limits.tunnelLifetimeMs);
          upstream.once('close', () => { clearTimeout(timer); client.destroy(); });
          client.once('close', () => { clearTimeout(timer); upstream.destroy(); });
        });
      } catch {
        if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
    };
    client.on('data', onData);
  });
}

export function createForwarder({ targetHost, targetPort, maxConnections = 8 }) {
  const server = net.createServer(client => {
    const upstream = net.connect({ host: targetHost, port: targetPort, timeout: 3_000 });
    client.setTimeout(70_000, () => client.destroy());
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    upstream.on('timeout', () => upstream.destroy());
    client.pipe(upstream); upstream.pipe(client);
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
  });
  server.maxConnections = maxConnections;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gate = createGate();
  gate.listen(3128, '0.0.0.0', () => process.stdout.write('torgatlas-edge gate on :3128\n'));
  const fwd = createForwarder({ targetHost: process.env.AI_UPSTREAM_HOST || 'ai-search', targetPort: Number(process.env.AI_UPSTREAM_PORT || 8080) });
  fwd.listen(8080, '0.0.0.0', () => process.stdout.write('torgatlas-edge forward on :8080\n'));
}
