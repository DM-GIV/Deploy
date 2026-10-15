/* Repaints the one-line offer at the bottom of the 1200x630 social card (assets/og-card.png) in headless Chromium.
 * Usage: node scripts/make-social-card.mjs <source.png> <out.png> "<offer line>" */
import fs from 'node:fs';
import playwright from '/pw/playwright/driver/package/index.js';

const [src, out, line] = process.argv.slice(2);
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const b64 = fs.readFileSync(src).toString('base64');
const data = await page.evaluate(async ({ b64, line }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = 1200; c.height = 630;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  // erase the old line: per row, blend the clean background found left (x=100) and right (x=700) of the text
  const y0 = 530, y1 = 575, xa = 100, xb = 700;
  const L = x.getImageData(xa, y0, 1, y1 - y0).data, R = x.getImageData(xb, y0, 1, y1 - y0).data;
  const patch = x.createImageData(xb - xa, y1 - y0);
  for (let r = 0; r < y1 - y0; r++) for (let k = 0; k < xb - xa; k++) {
    const t = k / (xb - xa), o = (r * (xb - xa) + k) * 4;
    for (let ch = 0; ch < 3; ch++) patch.data[o + ch] = Math.round(L[r * 4 + ch] * (1 - t) + R[r * 4 + ch] * t);
    patch.data[o + 3] = 255;
  }
  x.putImageData(patch, xa, y0);
  x.fillStyle = '#d9e6f2'; x.font = '22px "Open Sans","Noto Sans","DejaVu Sans",sans-serif'; x.textBaseline = 'alphabetic';
  x.fillText(line, 118, 558);
  return c.toDataURL('image/png').split(',')[1];
}, { b64, line });
fs.writeFileSync(out, Buffer.from(data, 'base64'));
await browser.close();
