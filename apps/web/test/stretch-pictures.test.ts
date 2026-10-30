import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkKind } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { pictureFor, STRETCH_PICTURES } from '../src/data/plans/stretchPictures.ts';
import { STRETCH_DAYS } from '../src/data/plans/splitsBackbend.ts';
import { stretchPicturesUpdate } from '../src/data/updates.ts';
import type { Action } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);

test('DuckDuckGo image links show as pictures', () => {
  for (const p of STRETCH_PICTURES) assert.equal(linkKind(p.url), 'image', p.label);
});

test('every Friday hold has its picture; measurements and other holds do not', () => {
  const friday = STRETCH_DAYS.find((d) => d.day === 5)!;
  for (const h of friday.plan.holds) assert.ok(pictureFor(h.name), h.name);
  for (const n of ['Front split (left): front hip to floor', 'Side-Lying Leg Raise', 'Seated Pike Leg Lifts', 'Supported Fish Pose (with blocks)']) assert.equal(pictureFor(n), null, n);
  assert.deepEqual(pictureFor('Front Split, Left Leg Forward'), pictureFor('Front Split, Right Leg Forward'));
});

test('the update adds pictures once, keeps the rest of the plan', () => {
  const plans = STRETCH_DAYS.map((d) => d.plan);
  const data: AppData = { ...emptyData(), actions: plans.map((p, i): Action => ({ id: `s${i}`, title: STRETCH_DAYS[i]!.title, kind: 'stretch', planned_minutes: 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: true, archived_at: null, stretch_plan: p })) };
  const before = stretchPicturesUpdate.preview(data, '2026-10-30');
  assert.equal(before.done, false);
  const after = run(data, stretchPicturesUpdate.ops(data, '2026-10-30', {}));
  assert.equal(stretchPicturesUpdate.preview(after, '2026-10-30').done, true);
  const fri = after.actions.find((a) => a.title === STRETCH_DAYS.find((d) => d.day === 5)!.title)!;
  const bridge = fri.stretch_plan!.holds.find((h) => h.name === 'Bridge Holds')!;
  assert.equal(bridge.demo?.kind, 'video');
  assert.equal(fri.stretch_plan!.holds.length, STRETCH_DAYS.find((d) => d.day === 5)!.plan.holds.length);
});
