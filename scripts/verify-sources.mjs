// Read-only source verifier. One bounded GET of "/" per registry host: public IP check, strict TLS, no redirects followed,
// no cookies, no auth. Output is JSON on stdout. Usage: node scripts/verify-sources.mjs <registry.json> [hostPath ...]
import fs from 'node:fs';
import dns from 'node:dns/promises';
import https from 'node:https';
import { isPrivateIp } from '../lib/torgatlas-public-web-research.mjs';

const registry = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const hosts = new Set(registry.sources.map(s => s.host));
const caByHost = new Map(registry.sources.filter(s => s.tls_ca).map(s => [s.host, s.tls_ca.map(c => fs.readFileSync(new URL('../' + c.path, import.meta.url), 'utf8'))]));
const probes = process.argv.slice(3).map(arg => { const i = arg.indexOf('/'); return { host: arg.slice(0, i), path: arg.slice(i) }; });
const targets = probes.length ? probes : registry.sources.map(s => ({ host: s.host, path: '/' }));

async function probe({ host, path }) {
  const row = { host, path, dns: null, ips: [], tls: null, http_status: null, content_type: null, location: null, bytes: 0, captcha_hint: false, title: null, error: null };
  if (!hosts.has(host) || !/^\/[A-Za-z0-9._~\/-]{0,120}$/.test(path)) { row.error = 'NOT_IN_REGISTRY'; return row; }
  try {
    const rows = await dns.lookup(host, { all: true, verbatim: true });
    row.ips = rows.map(r => r.address);
    row.dns = rows.some(r => isPrivateIp(r.address)) ? 'PRIVATE_DENIED' : 'PUBLIC';
    if (row.dns !== 'PUBLIC') return row;
    const pick = rows[0];
    await new Promise(resolve => {
      const req = https.request({ hostname: host, servername: host, path, method: 'GET', timeout: 8000,
        ...(caByHost.has(host) ? { ca: caByHost.get(host) } : {}),
        headers: { Accept: 'text/html,application/json', 'User-Agent': 'TorgAtlas-Public-Research/1.0 (source verification)' },
        lookup: (_h, o, cb) => (o && o.all) ? cb(null, [{ address: pick.address, family: pick.family }]) : cb(null, pick.address, pick.family) }, res => {
        row.http_status = res.statusCode; row.content_type = res.headers['content-type'] || null; row.location = res.headers.location || null;
        row.tls = res.socket.authorized ? 'VALID' : 'INVALID:' + res.socket.authorizationError;
        const chunks = [];
        res.on('data', c => { row.bytes += c.length; if (row.bytes <= 200_000) chunks.push(c); else res.destroy(); });
        const finish = () => { const t = Buffer.concat(chunks).toString('utf8'); if (process.env.SAVE_DIR) fs.writeFileSync(`${process.env.SAVE_DIR}/${host}${path.replace(/[^A-Za-z0-9.-]/g,'_')}.html`, t); row.captcha_hint = /captcha|капч|recaptcha|ddos-guard|qrator|cloudflare/i.test(t); row.title = (/<title[^>]*>([^<]{0,120})/i.exec(t) || [])[1]?.trim() || null; resolve(); };
        res.on('end', finish); res.on('close', finish);
      });
      req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
      req.on('error', e => { row.error = String(e.code || e.message).slice(0, 80); resolve(); });
      req.end();
    });
  } catch (e) { row.error = String(e.code || e.message).slice(0, 80); }
  return row;
}
const out = [];
for (const t of targets) { out.push(await probe(t)); await new Promise(r => setTimeout(r, 700)); }
console.log(JSON.stringify(out, null, 1));
