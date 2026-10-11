#!/usr/bin/env node
/**
 * Prepare static SEO files for a custom domain without changing Vercel hosting.
 *
 * Preview:
 *   node scripts/switch-domain.mjs --to https://example.ru
 * Apply after the domain has been chosen and Vercel has been configured:
 *   node scripts/switch-domain.mjs --to https://example.ru --apply
 * Repeat migrations:
 *   node scripts/switch-domain.mjs --from https://example.ru --to https://new-example.ru --apply
 *
 * NOTE: This script does not register domains, change DNS, issue certificates,
 * configure redirects, or update search consoles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
}
function usage() {
  process.stderr.write('Usage: node scripts/switch-domain.mjs --to https://domain.tld [--from https://old-domain.tld] [--apply]\n');
  process.exitCode = 2;
}
function origin(input, label) {
  if (!input) throw new Error(label + ': missing URL');
  const u = new URL(input);
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password ||
      u.search || u.hash || u.pathname !== '/' || u.port) {
    throw new Error(label + ': expected an HTTPS domain only, without paths, credentials or parameters');
  }
  return u.origin;
}
if (!arg('--to') || (args.includes('--from') && !arg('--from'))) {
  usage();
} else {
  try {
    const from = origin(arg('--from') || 'https://deploy-pi-blond-52.vercel.app', '--from');
    const to = origin(arg('--to'), '--to');
    if (from === to) throw new Error('Source and destination domains are identical');
    const paths = [
      'index.html',
      'proverka-lota/index.html',
      'poisk-imushchestva/index.html',
      'soprovozhdenie-torgov/index.html',
      'pokupka-imushchestva/index.html',
      'primery-lotov/index.html',
      'formaty-raboty/index.html',
      'blog/kak-proverit-lot-pered-torgami/index.html',
      'blog/index.html',
      'blog/kak-proverit-avtomobil-s-torgov/index.html',
      'blog/kak-proverit-zemelnyi-uchastok-s-torgov/index.html',
      'privacy/index.html',
      'robots.txt',
      'sitemap.xml'
    ];
    const updates = paths.map(name => {
      const file = path.join(root, name);
      const original = fs.readFileSync(file, 'utf8');
      const matches = original.split(from).length - 1;
      if (!matches) throw new Error('No source domain found in '+name+'; inspect before applying');
      const next = original.replaceAll(from, to);
      if (name.endsWith('.html') && (!next.includes('rel="canonical"') || !next.includes('og:url'))) {
        throw new Error('HTML SEO metadata missing in '+name);
      }
      return { name, file, original, next, matches };
    });
    process.stdout.write('Domain migration preview: '+from+' -> '+to+'\n');
    for (const item of updates) process.stdout.write('  '+item.name+': '+item.matches+' occurrence(s)\n');
    if (!args.includes('--apply')) {
      process.stdout.write('DRY RUN ONLY. No files changed. Use --apply only after choosing and configuring the domain.\n');
    } else {
      for (const item of updates) fs.writeFileSync(item.file, item.next, 'utf8');
      process.stdout.write('Files updated. Now commit, deploy, verify canonical/Sitemap/robots, and configure old-to-new redirects and search consoles.\n');
    }
  } catch (err) {
    process.stderr.write('ERROR: '+err.message+'\n');
    process.exitCode = 1;
  }
}
