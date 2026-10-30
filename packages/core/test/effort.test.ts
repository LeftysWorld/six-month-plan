import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEffort, effortHint, effortZone, suggestWeight, EFFORT_LEFT, EFFORT_WORDS, type PlannedExercise } from '../src/index.ts';

const ex: PlannedExercise = { name: 'Seated Rear-Delt Fly', sets: 3, reps_min: 12, reps_max: 15, weight: 15, weight_note: '', rest: '60 s', note: '' };
const top = [1, 2, 3].map((set_no) => ({ exercise: ex.name, set_no, weight: 15, reps: 15, done: true }));

test('the scale: words and reps left for every number', () => {
  for (let n = 1; n <= 10; n++) {
    assert.ok(EFFORT_WORDS[n]);
    assert.ok(EFFORT_LEFT[n]);
  }
  assert.equal(EFFORT_LEFT[8], '2 reps left');
  assert.equal(EFFORT_LEFT[10], 'No reps left');
  assert.deepEqual([1, 4, 5, 6, 7, 9, 10].map(effortZone), ['easy', 'easy', 'moderate', 'moderate', 'target', 'target', 'max']);
});

test('cleanEffort keeps whole numbers 1–10 only', () => {
  assert.equal(cleanEffort(8), 8);
  assert.equal(cleanEffort('7'), 7);
  assert.equal(cleanEffort(7.6), 8);
  assert.equal(cleanEffort(0), null);
  assert.equal(cleanEffort(11), null);
  assert.equal(cleanEffort(null), null);
  assert.equal(cleanEffort(undefined), null);
});

test('a 10 last time holds the weight even at the top of the range', () => {
  assert.deepEqual(suggestWeight(ex, top), { weight: 20, why: 'up' });
  assert.deepEqual(suggestWeight(ex, top, undefined, 8), { weight: 20, why: 'up' });
  assert.deepEqual(suggestWeight(ex, top, undefined, 10), { weight: 15, why: 'allout' });
});

test('hints follow the effort and whether every set hit the top', () => {
  const ctx = { allTop: false, weight: 15, unit: 'lb' };
  assert.match(effortHint(10, ctx), /Keep 15 lb/);
  assert.match(effortHint(9, ctx), /Keep 15 lb/);
  assert.match(effortHint(8, ctx), /one more rep/);
  assert.match(effortHint(8, { ...ctx, allTop: true }), /move up/);
  assert.match(effortHint(5, { ...ctx, allTop: true }), /move up/);
  assert.match(effortHint(3, ctx), /more reps/);
  assert.match(effortHint(10, { ...ctx, weight: null }), /Keep the same/);
});
