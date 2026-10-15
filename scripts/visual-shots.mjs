/* Full-page screenshots for visual acceptance (before/after). Usage: node scripts/visual-shots.mjs <baseUrl|local> <outDir> <prefix> */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import playwright from '/pw/playwright/driver/package/index.js';
const [arg = 'https://torgatlas.ru', out = '/out', prefix = 'shot'] = process.argv.slice(2);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
let server = null, base = arg;
if (arg === 'local') {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/') || p.startsWith('/ta/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"enabled":true,"max_results":10,"mode":"CORE_SEARCH","captcha":{"required":true}}'); }
    const c = p.endsWith('/') ? `${p}index.html` : p; const f = path.resolve('/app', `.${c}`);
    if (!f.startsWith('/app') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const pages = [['article-participation', '/blog/kak-uchastvovat-v-torgah-po-bankrotstvu/'], ['article-deposit', '/blog/zadatok-na-torgah-po-bankrotstvu/'], ['blog', '/blog/'], ['ai-search', '/ai-poisk-lotov/'], ['home', '/']];
for (const [vp, width, height, mobile] of [['desktop', 1440, 900, false], ['mobile375', 375, 812, true]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, userAgent: mobile ? UA : undefined, isMobile: mobile, hasTouch: mobile, locale: 'ru-RU' });
  const page = await ctx.newPage();
  for (const [name, p] of pages) {
    await page.goto(`${base}${p}`, { waitUntil: 'load' }); await page.waitForTimeout(900);
    const decline = page.locator('[data-analytics-decline]'); if (await decline.count() && await decline.first().isVisible()) { await decline.first().click(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${out}/${prefix}-${name}-${vp}.png`, fullPage: true });
    if (name === 'home' && mobile) await page.screenshot({ path: `${out}/${prefix}-mobile-menu-${vp}.png`, clip: { x: 0, y: 0, width, height: 320 } });
  }
  await ctx.close();
}
await browser.close(); if (server) server.close(); console.log('shots done');
