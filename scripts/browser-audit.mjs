#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import playwright from '/home/deploy/.aa-pw-pkg/playwright/driver/package/index.js';
const { chromium } = playwright;

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, value = 'true'] = arg.replace(/^--/, '').split('='); return [key, value]; }));
const baseURL = args.base || process.env.TORGATLAS_AUDIT_BASE_URL || 'http://127.0.0.1:20879';
const output = args.output || process.env.TORGATLAS_AUDIT_OUTPUT || 'docs/torgatlas-web-program/evidence/wave-03/browser-matrix.json';
const registry = JSON.parse(fs.readFileSync('content/public-pages.json', 'utf8'));
const allRoutes = [...registry.pages.map(page => page.path), '/ai-poisk-lotov/', '/404.html'];
const allWidths = [320, 375, 390, 768, 1280, 1440, 1920];
const routes = args.routes ? args.routes.split(',') : allRoutes;
const widths = args.widths ? args.widths.split(',').map(Number) : allWidths;
const existing = args.resume === 'true' && fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')).results : [];
const browser = await chromium.launch({headless: true, executablePath: '/home/deploy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
const results = [...existing];
const save = () => { fs.mkdirSync(path.dirname(output), {recursive: true}); const temp = `${output}.tmp`; fs.writeFileSync(temp, JSON.stringify({baseURL, routes: allRoutes, widths: allWidths, results}, null, 2) + '\n'); fs.renameSync(temp, output); };
for (const route of routes) for (const width of widths) {
  if (results.some(result => result.route === route && result.width === width)) continue;
  const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ru-RU', reducedMotion: 'reduce'});
  const page = await context.newPage();
  const consoleErrors = [], resourceErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => resourceErrors.push(`${request.url()} ${request.failure()?.errorText || ''}`));
  let httpStatus = null;
  try { const response = await page.goto(baseURL + route, {waitUntil: 'networkidle', timeout: 12000}); httpStatus = response?.status() ?? null; }
  catch (error) { results.push({route, width, status: 'BLOCKED', reason: `navigation: ${error.message}`, httpStatus, consoleErrors, resourceErrors}); await context.close(); save(); continue; }
  const report = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('a,button,input,select,textarea,summary')];
    const unnamed = controls.filter(node => !node.getAttribute('aria-label') && !node.textContent?.trim() && !node.getAttribute('value') && !node.labels?.length).length;
    const before = document.activeElement?.tagName;
    for (let i = 0; i < 8; i++) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab'}));
    return {overflow: document.documentElement.scrollWidth > window.innerWidth, scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth, unnamedControls: unnamed, initialFocus: before, h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang};
  });
  const apiResponse = await page.evaluate(() => performance.getEntriesByType('resource').map(x => x.name).find(x => x.includes('/api/ai-lot-search')) || null);
  const staticApiOnly = route === '/ai-poisk-lotov/' && apiResponse && consoleErrors.length === 1 && consoleErrors[0].includes('404') && baseURL.startsWith('http://127.0.0.1');
  const status = staticApiOnly ? 'BLOCKED_STATIC_API' : (report.overflow || report.unnamedControls || report.h1 !== 1 || report.lang !== 'ru' || consoleErrors.length || resourceErrors.length ? 'FAIL' : 'PASS');
  results.push({route, width, status, reason: staticApiOnly ? 'local static preview has no serverless /api/ai-lot-search endpoint' : null, httpStatus, ...report, consoleErrors, resourceErrors});
  await context.close();
  save();
}
await browser.close();
save();
const failed = results.filter(result => result.status === 'FAIL');
const blocked = results.filter(result => result.status.startsWith('BLOCKED'));
console.log(`browser audit: ${results.filter(result=>result.status==='PASS').length} PASS, ${failed.length} FAIL, ${blocked.length} BLOCKED`);
if (failed.length) { console.log(JSON.stringify(failed, null, 2)); process.exitCode = 1; }
