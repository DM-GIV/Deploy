/* Real HTTP-cache check of the reported defect. One browser profile, one origin, assets served with the production header
 * (public, max-age=86400, must-revalidate). Step 1: the profile visits the PREVIOUS release (unversioned /assets/seo.css, cached 24 h).
 * Step 2: the same profile opens the NEW release on the same origin. Step 3: a cold profile opens it. Usage: node css-cache-probe.mjs <oldTree> <outDir> */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import playwright from '/pw/playwright/driver/package/index.js';
const [oldTree, out = '/out'] = process.argv.slice(2);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const serve = (root, port) => new Promise(r => { const s = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/api/') || p.startsWith('/ta/')) { res.writeHead(404); return res.end('{}'); }
  const f = path.resolve(root, '.' + (p.endsWith('/') ? p + 'index.html' : p));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream', 'cache-control': p.startsWith('/assets/') ? 'public, max-age=86400, must-revalidate' : 'no-cache' });
  fs.createReadStream(f).pipe(res); }); s.listen(port, '127.0.0.1', () => r(s)); });
const PORT = 38457, URLS = ['kak-proverit-lot-pered-torgami', 'kak-uchastvovat-v-torgah-po-bankrotstvu', 'publichnoe-predlozhenie-bankrotstvo', 'zadatok-na-torgah-po-bankrotstvu'];
const measure = page => page.evaluate(() => { const r = e => e && e.getBoundingClientRect(); const p = document.querySelector('.article-copy p, .article-copy li'); const h = document.querySelector('h1'); const pr = r(p);
  return { cssHref: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')).find(x => /seo\.css/.test(x)), h1L: Math.round(r(h).left), pL: Math.round(pr.left), pR: Math.round(innerWidth - pr.right), hscroll: document.documentElement.scrollWidth > innerWidth }; });
let fail = 0;
const ok = (name, c, ev) => { if (!c) fail++; console.log(c ? 'PASS' : 'FAIL', name, JSON.stringify(ev)); };
const browser = playwright.chromium;
const opts = { executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'], viewport: { width: 1440, height: 900 } };
let s = await serve(oldTree, PORT);
const warm = await browser.launchPersistentContext('/tmp/profile-warm', opts); const wp = await warm.newPage();
await wp.goto(`http://127.0.0.1:${PORT}/blog/${URLS[0]}/`); await wp.waitForLoadState('load');
ok('step1: previous release cached unversioned seo.css', (await measure(wp)).cssHref === '/assets/seo.css', await measure(wp));
await wp.close(); await new Promise(r => s.close(r));
s = await serve(path.resolve('/app'), PORT);
for (const slug of URLS) {
  const page = await warm.newPage(); const reqs = [];
  page.on('requestfinished', async r => { if (/seo\.css/.test(r.url())) reqs.push({ url: r.url().replace(/^.*\/assets\//, ''), fromCache: await r.response().then(x => x.fromServiceWorker() ? 'sw' : null).catch(() => null) }); });
  await page.goto(`http://127.0.0.1:${PORT}/blog/${slug}/`); await page.waitForLoadState('load');
  const m = await measure(page);
  ok(`step2 cached-profile ${slug}: new HTML asks for fingerprinted CSS, text in the 760px column`, /^\/assets\/seo\.css\?v=[a-f0-9]{12}$/.test(m.cssHref) && m.pL >= 300 && m.pR === m.pL && !m.hscroll, { ...m, reqs });
  await page.screenshot({ path: `${out}/cache-warm-${slug}.png` }); await page.close();
}
await warm.close();
const cold = await browser.launchPersistentContext('/tmp/profile-cold', opts);
for (const slug of URLS) { const page = await cold.newPage(); await page.goto(`http://127.0.0.1:${PORT}/blog/${slug}/`); await page.waitForLoadState('load'); const m = await measure(page);
  ok(`step3 cold ${slug}`, m.pL >= 300 && m.pR === m.pL && !m.hscroll, m); await page.close(); }
await cold.close(); s.close();
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
