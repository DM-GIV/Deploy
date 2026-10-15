/* Measures the horizontal layout (left edge, width, centering) of the six articles on the same CSS the visitor would see.
 * Modes: fresh = current assets; stale = a previously cached seo.css (/out/stale-seo.css) with the current HTML (the reported defect).
 * Usage: node scripts/article-layout-probe.mjs <local|baseUrl> <fresh|stale> [outDir] [prefix] */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import playwright from '/pw/playwright/driver/package/index.js';
const [arg = 'local', mode = 'fresh', out = '/out', prefix = 'probe'] = process.argv.slice(2);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
let server = null, base = arg;
if (arg === 'local') {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/') || p.startsWith('/ta/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
    const c = p.endsWith('/') ? `${p}index.html` : p; const f = path.resolve('/app', `.${c}`);
    if (!f.startsWith('/app') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const PAGES = [['lot', 'kak-proverit-lot-pered-torgami'], ['auto', 'kak-proverit-avtomobil-s-torgov'], ['land', 'kak-proverit-zemelnyi-uchastok-s-torgov'], ['participate', 'kak-uchastvovat-v-torgah-po-bankrotstvu'], ['public-offer', 'publichnoe-predlozhenie-bankrotstvo'], ['deposit', 'zadatok-na-torgah-po-bankrotstvu']];
const rows = [];
for (const [vp, width, height, mobile] of [['desktop', 1440, 900, false], ['mobile375', 375, 812, true]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, userAgent: mobile ? UA : undefined, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU' });
  if (mode === 'stale') await ctx.route('**/assets/seo.css*', r => r.fulfill({ contentType: 'text/css', body: fs.readFileSync('/out/stale-seo.css', 'utf8') }));
  const page = await ctx.newPage();
  for (const [key, slug] of PAGES) {
    await page.goto(`${base}/blog/${slug}/`, { waitUntil: 'load' }); await page.waitForTimeout(500);
    const d = await page.evaluate(() => {
      const L = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(window.innerWidth - r.right) }; };
      const body = document.querySelector('.guide-body, .post-body, .article-copy');
      const p = body && body.querySelector('p');
      return { h1: L('h1'), firstParagraph: p ? (() => { const r = p.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(window.innerWidth - r.right) }; })() : null,
        h2: L('main h2'), cta: L('.post-cta h2, .guide-main-cta h2, .contact h2'), hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        font: body ? getComputedStyle(body).fontSize : null };
    });
    rows.push({ vp, key, mode, ...d });
    await page.screenshot({ path: `${out}/${prefix}-${mode}-${key}-${vp}.png`, fullPage: true });
  }
  await ctx.close();
}
for (const r of rows) console.log(`${r.mode.padEnd(5)} ${r.vp.padEnd(9)} ${r.key.padEnd(13)} h1 L${r.h1?.left}/W${r.h1?.width}  para L${r.firstParagraph?.left}/W${r.firstParagraph?.width}/R${r.firstParagraph?.right}  cta L${r.cta?.left}  hscroll=${r.hscroll} font=${r.font}`);
await browser.close(); if (server) server.close();
