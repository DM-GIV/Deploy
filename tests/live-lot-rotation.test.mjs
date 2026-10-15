import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulerDecision, selectVerifiedLots, slotFor } from '../scripts/live-lot-rotation.mjs';

test('three-day Moscow calendar slots do not reset at a month boundary', () => {
  const jan31 = slotFor(new Date('2026-01-31T02:00:00Z'), '2026-01-28');
  const feb1 = slotFor(new Date('2026-02-01T02:00:00Z'), '2026-01-28');
  const feb3 = slotFor(new Date('2026-02-03T02:00:00Z'), '2026-01-28');
  assert.equal(jan31.slot, 1);
  assert.equal(feb1.slot, 1);
  assert.equal(feb3.slot, 2);
  assert.equal(feb3.due_day, true);
});

test('scheduler is disabled by default and is idempotent per slot', async () => {
  const at = new Date('2026-10-18T02:10:00Z');
  assert.deepEqual(await schedulerDecision({ enabled: false }, at), { status: 'SKIP', reason: 'scheduler_disabled' });
  const config = { enabled: true, activation_date: '2026-10-15' };
  assert.equal((await schedulerDecision(config, at)).status, 'RUN');
  assert.deepEqual(await schedulerDecision(config, at, { slot: 1 }), { status: 'SKIP', reason: 'slot_already_published', slot: 1 });
});

test('selection rejects expired, unknown and duplicate lots instead of filling eight', () => {
  const at = new Date('2026-10-15T00:00:00Z');
  const good = Array.from({ length: 8 }, (_, index) => ({
    source: 'test', source_lot_id: String(index), category: index % 2 ? 'Транспорт' : 'Оборудование',
    url: `https://example.test/${index}`, application_deadline: '2026-11-01T10:00:00+03:00',
    accepting_applications: 'CONFIRMED_BY_SOURCE_STATUS_AND_DATE'
  }));
  assert.equal(selectVerifiedLots([...good, good[0]], at, 0).length, 8);
  assert.equal(selectVerifiedLots([...good.slice(0, 7), { ...good[7], accepting_applications: 'UNKNOWN' }], at, 0).length, 0);
  assert.equal(selectVerifiedLots([...good.slice(0, 7), { ...good[7], application_deadline: '2026-01-01T00:00:00+03:00' }], at, 0).length, 0);
});
