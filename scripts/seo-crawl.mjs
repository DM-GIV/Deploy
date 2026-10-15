/* Plain-HTTP SEO crawl (no browser): sitemap -> every URL -> status, canonical, robots, h1, title/description uniqueness, JSON-LD validity,
 * internal links, no link to the future catalogue. Works against a live base URL or, with `local`, a static server over the repo.
 * Usage: node scripts/seo-crawl.mjs <baseUrl|local> */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const arg = process.argv[2] || 'https://torgatlas.ru';
const root = path.resolve(import.meta.dirname, '..');
const mime = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
let server = null; let base = arg;
if (arg === 'local') {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const candidate = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = path.resolve(root, `.${candidate}`);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>'); }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
let pass = 0, fail = 0;
const check = (id, ok, evidence = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', id, String(evidence).slice(0, 240)); };
const get = async url => { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, text: await r.text(), headers: r.headers }; };

const sm = await get(`${base}/sitemap.xml`);
const locs = [...sm.text.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
check('sitemap.xml 200 with URLs', sm.status === 200 && locs.length >= 10, `${locs.length} urls`);
check('sitemap has no duplicates', new Set(locs).size === locs.length);
check('sitemap never lists the future catalogue', !/app\.torgatlas|torgatos/.test(sm.text));
const titles = new Map(), descriptions = new Map(); const internal = new Set();
const origin = 'https://torgatlas.ru';
for (const loc of locs) {
  const url = loc.replace(origin, base);
  const page = await get(url);
  const h = page.text;
  const canonical = (h.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  const robots = (h.match(/<meta name="robots" content="([^"]+)"/) || [])[1] || '';
  const title = (h.match(/<title>([^<]*)<\/title>/) || [])[1];
  const description = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  check(`${loc}: 200, canonical self, indexable`, page.status === 200 && canonical === loc && !/noindex/.test(robots), `${page.status} ${canonical} ${robots}`);
  check(`${loc}: exactly one H1, title and description present`, (h.match(/<h1[\s>]/g) || []).length === 1 && Boolean(title) && Boolean(description));
  titles.set(title, [...(titles.get(title) || []), loc]); descriptions.set(description, [...(descriptions.get(description) || []), loc]);
  let ldOk = true;
  for (const m of h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) { try { JSON.parse(m[1]); } catch { ldOk = false; } }
  check(`${loc}: JSON-LD parses`, ldOk);
  check(`${loc}: no link to the future catalogue, no «torgatos»`, !/href="[^"]*(?:app\.torgatlas|torgatos)/.test(h) && !/torgatos/.test(h));
  for (const m of h.matchAll(/<a [^>]*href="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) internal.add(m[1]);
}
check('titles are unique', [...titles.values()].every(v => v.length === 1), [...titles.values()].filter(v => v.length > 1).map(v => v.join(' ')).join(' | '));
check('descriptions are unique', [...descriptions.values()].every(v => v.length === 1));
let broken = [];
for (const p of internal) { const r = await get(`${base}${p}`); if (r.status >= 400 && !p.startsWith('/api/')) broken.push(`${p}:${r.status}`); }
check(`internal links resolve (${internal.size} distinct targets)`, broken.length === 0, broken.join(' '));
// Noindex pages must not be in the sitemap; the drafts stay noindex.
for (const p of ['/blog/gosudarstvennye-i-municipalnye-torgi/', '/blog/o-chem-budem-pisat-v-torgatlas/']) {
  const r = await get(`${base}${p}`);
  check(`${p} (draft) is noindex and absent from the sitemap`, !locs.includes(origin + p) && (r.status === 404 || /noindex/.test(r.text)), r.status);
}
// The articles: raw HTML (no JS) already contains the text of every collapsed section.
for (const slug of ['kak-uchastvovat-v-torgah-po-bankrotstvu', 'publichnoe-predlozhenie-bankrotstvo', 'zadatok-na-torgah-po-bankrotstvu']) {
  const r = await get(`${base}/blog/${slug}/`);
  const secs = [...r.text.matchAll(/<details class="art-sec"[^>]*>(.*?)<\/details>/gs)];
  check(`${slug}: ${secs.length} sections with their text in the raw GET`, r.status === 200 && secs.length >= 4 && secs.every(s => s[1].replace(/<[^>]+>/g, '').trim().split(/\s+/).length > 25));
}
const robots = await get(`${base}/robots.txt`); check('robots.txt references the sitemap', /Sitemap: https:\/\/torgatlas\.ru\/sitemap\.xml/.test(robots.text));
console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
if (server) server.close();
process.exit(fail ? 1 : 0);
