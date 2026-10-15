#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicResearchMiniSearch } from '../lib/torgatlas-public-web-research.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'content/live-lots/config.json');
const SNAPSHOT_PATH = resolve(ROOT, 'content/live-lots/current.json');
export const ROTATION_QUERIES = [
  'Найди транспорт на торгах',
  'Найди оборудование на торгах',
  'Найди недвижимость на публичном предложении',
  'Найди земельные участки на торгах'
];

export function moscowParts(at) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(at);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function serialDay(isoDay) {
  const [year, month, day] = isoDay.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function slotFor(at, activationDate = '2026-10-15') {
  const parts = moscowParts(at);
  const localDay = `${parts.year}-${parts.month}-${parts.day}`;
  const dayOffset = serialDay(localDay) - serialDay(activationDate);
  return {
    local_day: localDay,
    day_offset: dayOffset,
    slot: dayOffset < 0 ? null : Math.floor(dayOffset / 3),
    due_day: dayOffset >= 0 && dayOffset % 3 === 0,
    due_time: `${parts.hour}:${parts.minute}` >= '05:00'
  };
}

function stableScore(slot, lot) {
  return createHash('sha256').update(`${slot}|${lot.source}|${lot.source_lot_id}`).digest('hex');
}

export function selectVerifiedLots(lots, at, slot, required = 8) {
  const nowMs = at.getTime();
  const unique = new Map();
  for (const lot of lots) {
    const deadlineMs = Date.parse(lot.application_deadline || '');
    if (lot.accepting_applications !== 'CONFIRMED_BY_SOURCE_STATUS_AND_DATE') continue;
    if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs || !/^https:\/\//.test(lot.url || '')) continue;
    unique.set(`${lot.source}:${lot.source_lot_id}`, lot);
  }
  const ordered = [...unique.values()].sort((left, right) => {
    const category = String(left.category).localeCompare(String(right.category), 'ru');
    return category || stableScore(slot, left).localeCompare(stableScore(slot, right));
  });
  if (ordered.length < required) return [];
  const byCategory = new Map();
  for (const lot of ordered) {
    const key = lot.category || 'Имущество';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(lot);
  }
  const selected = [];
  while (selected.length < required && [...byCategory.values()].some(rows => rows.length)) {
    for (const rows of byCategory.values()) {
      if (rows.length && selected.length < required) selected.push(rows.shift());
    }
  }
  return selected;
}

export async function buildSnapshot({ at = new Date(), search = publicResearchMiniSearch, required = 8, activationDate = '2026-10-15' } = {}) {
  const period = slotFor(at, activationDate);
  const observed = [];
  const attempts = [];
  for (const [index, query] of ROTATION_QUERIES.entries()) {
    const result = await search(query, { cacheEnabled: false, rateKey: `rotation-${period.slot}-${index}`, limit: 10 });
    attempts.push({ query, status: result.status, coverage: result.coverage, count: result.lots.length, cost: result.cost });
    observed.push(...result.lots);
  }
  const lots = selectVerifiedLots(observed, at, period.slot, required);
  if (lots.length !== required) return { status: 'HOLD', reason: 'fewer_than_eight_live_verified_lots', observed_unique: new Set(observed.map(lot => `${lot.source}:${lot.source_lot_id}`)).size, attempts };
  return {
    schema: 'torgatlas-live-lot-snapshot-v1',
    status: 'READY', slot: period.slot, local_day: period.local_day,
    generated_at: at.toISOString(), checked_at: at.toISOString(),
    notice: 'Случайная подборка публичных торгов. Эти лоты не являются результатами сделок ТоргАтлас. Актуальные условия проверяйте по первоисточникам.',
    attempts, lots
  };
}

export async function schedulerDecision(config, at, previous = null) {
  if (!config.enabled) return { status: 'SKIP', reason: 'scheduler_disabled' };
  const period = slotFor(at, config.activation_date);
  if (!period.due_day || !period.due_time) return { status: 'SKIP', reason: 'outside_calendar_slot', ...period };
  if (previous?.slot === period.slot) return { status: 'SKIP', reason: 'slot_already_published', slot: period.slot };
  return { status: 'RUN', slot: period.slot, local_day: period.local_day };
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const atArg = process.argv.find(value => value.startsWith('--at='));
  const at = atArg ? new Date(atArg.slice(5)) : new Date();
  let previous = null;
  try { previous = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')); } catch {}
  const decision = await schedulerDecision(config, at, previous);
  if (decision.status !== 'RUN') { process.stdout.write(`${JSON.stringify(decision)}\n`); return; }
  const snapshot = await buildSnapshot({ at, required: config.required_lots, activationDate: config.activation_date });
  if (snapshot.status !== 'READY') { process.stdout.write(`${JSON.stringify(snapshot)}\n`); process.exitCode = 2; return; }
  const temp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
  await rename(temp, SNAPSHOT_PATH);
  process.stdout.write(`${JSON.stringify({ status: 'PUBLISHED_SNAPSHOT', slot: snapshot.slot, lots: snapshot.lots.length })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
