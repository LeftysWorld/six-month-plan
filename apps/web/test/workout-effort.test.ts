import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsDeleteExtra, opsSaveExerciseLogs } from '../src/data/ops.ts';
import type { Session } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const session: Session = { id: 's1', action_id: 'a1', week_start: '2026-10-26', slot: 0, date: '2026-10-30', title: 'Workout', priority: false, planned_minutes: 45, planned_count: null, status: 'planned', actual_minutes: null, actual_count: null, note: '', obstacles: [], origin: 'schedule', source: '', moved_from: null, logged_at: null } as Session;
const base: AppData = { ...emptyData(), sessions: [session] };

test('saves only exercises with something entered, replaces on save, and undoes', () => {
  const first = opsSaveExerciseLogs(base, 's1', [
    { exercise: 'Seated Rear-Delt Fly', effort: 8, pain: false, pain_where: '', note: '' },
    { exercise: 'Cable Lateral Raise', effort: null, pain: false, pain_where: '', note: '  ' },
    { exercise: 'Sit-Up Bench Crunch (knee test)', effort: 9, pain: true, pain_where: 'Knee', note: ' pulled on the knee ' },
  ]);
  const a = run(base, first.ops);
  assert.equal(a.workoutExercises.length, 2);
  const crunch = a.workoutExercises.find((w) => w.exercise.startsWith('Sit-Up'))!;
  assert.deepEqual([crunch.effort, crunch.pain, crunch.pain_where, crunch.note], [9, true, 'Knee', 'pulled on the knee']);

  const second = opsSaveExerciseLogs(a, 's1', [{ exercise: 'Seated Rear-Delt Fly', effort: 7, pain: false, pain_where: 'Knee', note: '' }]);
  const b = run(a, second.ops);
  assert.equal(b.workoutExercises.length, 1);
  assert.equal(b.workoutExercises[0]!.effort, 7);
  assert.equal(b.workoutExercises[0]!.pain_where, '', 'no place without pain');

  const back = run(b, second.undo);
  assert.equal(back.workoutExercises.length, 2);
  assert.deepEqual(opsSaveExerciseLogs(base, 's1', [{ exercise: 'X', effort: null, pain: false, pain_where: '', note: '' }]), { ops: [], undo: [] });
});

test('deleting an extra session takes its exercise ratings with it, and undo brings them back', () => {
  const a = run(base, opsSaveExerciseLogs(base, 's1', [{ exercise: 'Seated Rear-Delt Fly', effort: 8, pain: false, pain_where: '', note: '' }]).ops);
  const del = opsDeleteExtra(a, a.sessions[0]!);
  const gone = run(a, del.ops);
  assert.equal(gone.workoutExercises.length, 0);
  assert.equal(run(gone, del.undo).workoutExercises.length, 1);
});
