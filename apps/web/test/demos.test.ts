import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsSetDemo, savedDemo } from '../src/data/demos.ts';
import type { Action } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const base = (patch: Partial<Action>): Action => ({ id: 'a', title: 'Workout', kind: 'workout', planned_minutes: 45, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null, ...patch });

test('a demo is saved on every task that has the exercise by that name, and read back from any of them', () => {
  const d = emptyData();
  const ex = (name: string) => ({ name, sets: 3, reps_min: 8, reps_max: 12, weight: null, weight_note: '', rest: '', note: '' });
  d.actions = [
    base({ id: 'push', workout_plan: [ex('Flat DB Bench Press'), ex('Face pulls')] }),
    base({ id: 'push2', workout_plan: [ex('flat db bench press ')] }),
    base({ id: 'legs', workout_plan: [ex('RDL')] }),
    base({ id: 'stretch', kind: 'stretch', stretch_plan: { day: 'push', intensity: '', focus: '', holds: [{ name: 'Sphinx to Cobra', dose: '3 × 45 s', how: '', part: 'daily' }] } }),
  ];
  const ops = opsSetDemo(d, 'Flat DB Bench Press', 'strength', { kind: 'library', id: 'Dumbbell_Bench_Press' });
  assert.deepEqual(ops.map((o) => (o.kind === 'update' ? o.id : '')), ['push', 'push2']);
  const after = run(d, ops);
  assert.deepEqual(after.actions[1]!.workout_plan![0]!.demo, { kind: 'library', id: 'Dumbbell_Bench_Press' });
  assert.equal(after.actions[0]!.workout_plan![1]!.demo, undefined, 'other exercises untouched');
  assert.deepEqual(savedDemo(after, 'flat db bench press', 'strength'), { kind: 'library', id: 'Dumbbell_Bench_Press' });
  assert.equal(savedDemo(after, 'Flat DB Bench Press', 'stretch'), null);

  const s = run(after, opsSetDemo(after, 'Sphinx to Cobra', 'stretch', { kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' }));
  assert.deepEqual(savedDemo(s, 'Sphinx to Cobra', 'stretch'), { kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' });
  // Reset goes back to the library match.
  const reset = run(s, opsSetDemo(s, 'Sphinx to Cobra', 'stretch', null));
  assert.equal(savedDemo(reset, 'Sphinx to Cobra', 'stretch'), null);
});
