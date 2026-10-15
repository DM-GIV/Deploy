#!/usr/bin/env node
/**
 * Static homepage performance budget. No browser or network dependency.
 * Run from the repository root: node scripts/check-performance.mjs
 * NOTE: Passing does NOT establish a Lighthouse score or Core Web Vitals.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const bundleCss = read('assets/home-bundle.css');
const contactCss = read('assets/contact-icons.css');
const css = `${bundleCss}\n${contactCss}`;
const errors = [];
function ensure(condition, message) { if (!condition) errors.push(message); }
const stylesheets = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(m => m[1]);
const classes = new Set([...html.matchAll(/\bclass="([^"]*)"/g)].flatMap(x => x[1].split(/\s+/).filter(Boolean)));
const missing = [...classes].filter(x => !css.includes('.' + x));
const preloads = [...html.matchAll(/<link\s+rel="preload"\s+as="image"[^>]*>/g)].map(x => x[0]);
const images = [...css.matchAll(/\/assets\/hero-[0-9]+\.webp/g)].map(x => x[0]);
const mobile = images.find(x => x.includes('hero-1100'));
const desktop = images.find(x => x.includes('hero-1950'));
ensure(stylesheets.length === 2 && /^\/assets\/home-bundle\.css(?:\?v=[a-f0-9]{12})?$/.test(stylesheets[0]) && stylesheets[1] === '/assets/contact-icons.css','Homepage must load only the optimized bundle and lightweight contact icons CSS');
ensure(Buffer.byteLength(bundleCss, 'utf8') <= 18000,'Optimized bundle exceeded 18 KB budget');
ensure(Buffer.byteLength(contactCss, 'utf8') <= 1500,'Contact icons CSS exceeded 1.5 KB budget');
ensure(Buffer.byteLength(html, 'utf8') <= 34000,'Homepage HTML exceeded 34 KB budget');
ensure(missing.length === 0,'CSS selectors missing for HTML classes: ' + missing.join(', '));
ensure(images.length === 2 && !!mobile && !!desktop,'Expected two responsive local hero variants');
ensure(preloads.length === 2 && preloads.some(x => x.includes('max-width: 800px')) && preloads.some(x => x.includes('min-width: 801px')),'Responsive hero preloads are missing');
ensure(html.includes('/assets/funnel-events.js" defer'),'Do not block rendering with funnel JavaScript');
ensure(!html.includes('fonts.googleapis.com') && !html.includes('google-analytics.com'),'Unexpected third-party font or analytics dependency');
const report = {
  homepage_html_bytes: Buffer.byteLength(html,'utf8'),
  homepage_css_bytes: Buffer.byteLength(bundleCss,'utf8'),
  contact_css_bytes: Buffer.byteLength(contactCss,'utf8'),
  stylesheets,
  css_class_count: classes.size,
  missing_css_classes: missing,
  hero_preload_count: preloads.length,
  passed: errors.length === 0,
  errors
};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
if (errors.length) process.exitCode = 1;
