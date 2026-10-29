import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Goal, MeasurementType } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { measureOnToday } from '../src/data/connect.ts';
import { previewSplitsPack } from '../src/data/planPack.ts';
import { applyUpdate, flexMeasuresUpdate } from '../src/data/updates.ts';

const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);
const goal = (id: string, title: string): Goal => ({ id, title, type: 'practice', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, group_id: 'body' });
const type = (id: string, name: string, goal_id: string, cadence_days = 28, on_today: boolean | null = false): MeasurementType => ({ id, name, unit: 'in', cadence_days, goal_id, archived_at: null, on_today });

/** The measurements as they were: the old gap number, monthly left/right/side, the seated fold, a backbend number. */
function before(): AppData {
  const d = emptyData();
  d.goals = [goal('front', 'Front splits, both sides'), goal('side', 'Side (center) split'), goal('fold', 'Chest to shins, seated and standing'), goal('back', 'Full backbend')];
  d.measurementTypes = [
    type('gap', 'Splits gap', 'front', 1, null),
    type('fl', 'Front split (left): front hip to floor', 'front'),
    type('fr', 'Front split (right): front hip to floor', 'front'),
    type('sd', 'Side split: crotch to floor', 'side'),
    type('seated', 'Seated fold: chest to knees', 'fold'),
    type('standing', 'Standing fold: chest to knees', 'fold'),
    type('bridge', 'Bridge: hands to heels', 'back'),
  ];
  d.measurements = [{ id: 'r1', type_id: 'gap', value: 12, measured_on: '2026-10-27', source: 'manual', note: '' }];
  return d;
}

test('front left and right and the center split go on Today daily; the gap, seated fold and backbend go', () => {
  const d = before();
  const p = flexMeasuresUpdate.preview(d, '2026-10-29');
  assert.equal(p.done, false);
  const { ops, undo } = applyUpdate(flexMeasuresUpdate, d, '2026-10-29', {});
  const after = run(d, ops);
  const live = after.measurementTypes.filter((t) => !t.archived_at);
  assert.deepEqual(live.map((t) => t.name).sort(), ['Center split', 'Front split (left): front hip to floor', 'Front split (right): front hip to floor', 'Standing fold: chest to knees']);
  assert.deepEqual(after.measurementTypes.filter((t) => measureOnToday(after, t.id)).map((t) => t.name).sort(), ['Center split', 'Front split (left): front hip to floor', 'Front split (right): front hip to floor']);
  // History kept, nothing deleted.
  assert.equal(after.measurements.length, 1);
  assert.equal(after.measurementTypes.length, 7);
  assert.equal(flexMeasuresUpdate.preview(after, '2026-10-29').done, true);
  const norm = (x: AppData) => JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map((r) => JSON.stringify(r)).sort() : v])));
  assert.equal(norm(run(after, undo)), norm(d));
});

test('the plan update never adds back what was removed, or a second center split', () => {
  const d = before();
  const after = run(d, applyUpdate(flexMeasuresUpdate, d, '2026-10-29', {}).ops);
  for (const data of [d, after]) {
    const p = previewSplitsPack(data, '2026-10-29');
    assert.ok(!p.updates.some((u) => /measurement/i.test(u)), p.updates.join(' | '));
  }
});
