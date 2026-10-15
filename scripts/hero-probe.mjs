/* Home hero geometry at several widths: headline lines, subtitle, CTA position, first-screen fit. Usage: node scripts/hero-probe.mjs <local|baseUrl> [outDir] [prefix] */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import playwright from '/pw/playwright/driver/package/index.js';
const [arg = 'local', out = '/out', prefix = 'hero'] = process.argv.slice(2);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
let server = null, base = arg;
if (arg === 'local') {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/') || p.startsWith('/ta/')) { res.writeHead(404); return res.end('{}'); }
    const c = p.endsWith('/') ? `${p}index.html` : p; const f = path.resolve('/app', `.${c}`);
    if (!f.startsWith('/app') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
for (const [width, height] of [[320, 700], [375, 812], [412, 892], [768, 1024], [1440, 900]]) {
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height }, userAgent: mobile ? UA : undefined, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU' });
  const page = await ctx.newPage(); await page.goto(`${base}/`, { waitUntil: 'load' }); await page.waitForTimeout(700);
  const d = await page.evaluate(() => {
    const h1 = document.querySelector('.hero h1'); const cs = getComputedStyle(h1); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.1;
    const text = document.querySelector('.hero-text'); const cta = document.querySelector('.hero-buttons a'); const hero = document.querySelector('.hero').getBoundingClientRect();
    const t = text.getBoundingClientRect(), c = cta.getBoundingClientRect(), r = h1.getBoundingClientRect();
    return { h1Text: h1.textContent.trim().replace(/\s+/g, ' '), h1Lines: Math.round(r.height / lh), h1Font: cs.fontSize, subLines: Math.round(t.height / (parseFloat(getComputedStyle(text).lineHeight) || parseFloat(getComputedStyle(text).fontSize) * 1.5)), heroHeight: Math.round(hero.height), ctaTop: Math.round(c.top), ctaBottom: Math.round(c.bottom), vh: window.innerHeight, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  });
  console.log(`${String(width).padStart(4)}px  h1 ${d.h1Lines} lines @${d.h1Font}  subtitle ${d.subLines} lines  hero ${d.heroHeight}px  CTA top ${d.ctaTop}/${d.vh} bottom ${d.ctaBottom}  ctaOnFirstScreen=${d.ctaBottom <= d.vh}  hscroll=${d.hscroll}`);
  await page.screenshot({ path: `${out}/${prefix}-${width}.png` });
  await ctx.close();
}
await browser.close(); if (server) server.close();
