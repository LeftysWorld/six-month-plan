import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TRAINING_RULES, equipmentKind, rulesSummary, stepFor, suggestWeight, trainingRules, workoutPrefs, type PlannedExercise } from '../src/index.ts';

test('saved rules sit over the defaults, field by field', () => {
  assert.deepEqual(trainingRules(null), DEFAULT_TRAINING_RULES);
  const r = trainingRules({ steps: { dumbbell: 2.5 } as never, max_jump_pct: 0.2 });
  assert.equal(r.steps.dumbbell, 2.5);
  assert.equal(r.steps.cable, 5);
  assert.equal(r.max_jump_pct, 0.2);
  assert.deepEqual(r.days, [1, 2, 3, 4, 5]);
  assert.deepEqual(workoutPrefs({ effort: 'off' }), { effort: 'off', workout_rating: true, rest_vibrate: true });
});

test('the weight step comes from the kind of equipment', () => {
  assert.equal(equipmentKind('Seated Rear-Delt Fly'), 'dumbbell');
  assert.equal(equipmentKind('Cable Triceps Pushdown'), 'cable');
  assert.equal(equipmentKind('Lat Pulldown'), 'machine');
  assert.equal(equipmentKind('Seated Cable Row'), 'machine');
  assert.equal(equipmentKind('Single-Arm Cable Pulldown'), 'cable');
  assert.equal(equipmentKind('Sit-Up Bench Crunch (knee test)'), 'bodyweight');
  const r = trainingRules({ steps: { dumbbell: 5, machine: 7.5, cable: 2.5 } });
  assert.equal(stepFor('Lat Pulldown', r), 7.5);
  assert.equal(stepFor('Cable Lateral Raise', r), 2.5);
  assert.equal(stepFor('Sit-Up Bench Crunch', r), 0);
  assert.match(rulesSummary(DEFAULT_TRAINING_RULES, 'lb'), /Knee: no lower-body training · dumbbells, one cable · \+5 lb steps/);
});

test('a jump bigger than the limit is never suggested: reps or a set first', () => {
  const raise: PlannedExercise = { name: 'Seated Lateral Raise', sets: 3, reps_min: 12, reps_max: 15, weight: 12.5, weight_note: '', rest: '', note: '' };
  const top = [1, 2, 3].map((set_no) => ({ exercise: raise.name, set_no, weight: 12.5, reps: 15, done: true }));
  assert.deepEqual(suggestWeight(raise, top, 5, null, 0.1), { weight: 12.5, why: 'bigjump' });
  assert.deepEqual(suggestWeight(raise, top, 5, null, 0.5), { weight: 17.5, why: 'up' });
  assert.deepEqual(suggestWeight(raise, top, 5), { weight: 17.5, why: 'up' });
});
