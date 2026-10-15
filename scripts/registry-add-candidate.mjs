// Adds a discovered ETP to the registry as CANDIDATE (never edge-enabled). Usage: node scripts/registry-add-candidate.mjs <registry.json> <host> <name> <category,category>
import fs from 'node:fs';
export function addCandidate(registry, host, name, categories) {
  const h = String(host || '').toLowerCase();
  if (!/^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/.test(h) || h.includes('*')) throw new Error('INVALID_HOST');
  if (registry.sources.some(s => s.host === h)) return false;
  registry.sources.push({ id: h.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), host: h, name: String(name).slice(0, 120), categories, status: 'CANDIDATE', edge_enabled: false, notes: 'Discovered; unverified. Needs DNS/IP/TLS/catalog/card review before any edge enablement.', template_family: null });
  return true;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [file, host, name, cats] = process.argv.slice(2);
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  const added = addCandidate(registry, host, name, String(cats || '').split(',').filter(Boolean));
  if (added) fs.writeFileSync(file, JSON.stringify(registry, null, 1));
  console.log(added ? 'added' : 'exists');
}
