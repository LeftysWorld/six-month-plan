import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkWithNext, parseWorkoutPlan, planGroups, splitSupersets, suggestWeight, targetText } from '../src/workout.ts';

const friday = `WARM-UP (every session)
• Band pull-aparts or face pulls: 2×15
• Shoulder dislocates: 10

WORKOUT
• Wide-Grip Lat Pulldown: 4×10–12 @ 90 lb · rest 2 min
• Single-Arm DB Row: 3×8–12 per side @ 40 lb · rest 90 s
• Low-Incline DB Fly: 3×12–15 @ 20–25 lb · rest 60 s
• Single-Arm Cable Pulldown: 3×10–12 per side @ find the weight · rest 60 s
• Arm superset, 2 rounds: Cable Curl 12–15 + Overhead Cable Triceps Extension 12–15 · rest 90 s after each round
• Hammer Strength Glute/Ham Hip Extension (knee test): 3×10–12 @ bodyweight · rest 90 s
• Lat Pulldown: 4×8–12 @ 100 lb · rest 2–3 min (elbows to back pockets, full stretch)
• Sit-Up Bench Crunch (knee test): 3×12–15 · rest 45 s

HOW TO PROGRESS
• End every set with 1–2 reps in reserve.`;

test('reads the plan under WORKOUT, not the warm-up or the progression notes', () => {
  const p = parseWorkoutPlan(friday);
  assert.deepEqual(p.map((e) => e.name), [
    'Wide-Grip Lat Pulldown', 'Single-Arm DB Row', 'Low-Incline DB Fly', 'Single-Arm Cable Pulldown', 'Cable Curl', 'Overhead Cable Triceps Extension',
    'Hammer Strength Glute/Ham Hip Extension (knee test)', 'Lat Pulldown', 'Sit-Up Bench Crunch (knee test)',
  ]);
  const [pull, row, fly, cable, curl, , ham, lat, crunch] = p;
  assert.deepEqual([pull!.sets, pull!.reps_min, pull!.reps_max, pull!.weight, pull!.rest], [4, 10, 12, 90, '2 min']);
  assert.equal(row!.per_side, true);
  assert.deepEqual([fly!.weight, fly!.weight_note], [20, '20–25 lb']);
  assert.deepEqual([cable!.weight, cable!.weight_note], [null, 'find the weight']);
  assert.deepEqual([curl!.sets, curl!.reps_min, curl!.reps_max, curl!.superset], [2, 12, 15, 'Arm superset']);
  assert.equal(ham!.weight_note, 'bodyweight');
  assert.deepEqual([lat!.rest, lat!.note], ['2–3 min', 'elbows to back pockets, full stretch']);
  assert.deepEqual([crunch!.weight, crunch!.rest], [null, '45 s']);
  assert.equal(targetText(pull!), '4 × 10–12 @ 90 lb');
  assert.equal(targetText(ham!), '3 × 10–12 · bodyweight');
});

test('suggests the plan weight, then last time, then +5 after hitting the top of the range on every set', () => {
  const ex = parseWorkoutPlan('Bench: 3×8–12 @ 50 lb')[0]!;
  assert.deepEqual(suggestWeight(ex, null), { weight: 50, why: 'plan' });
  const s = (weight: number, reps: number) => ({ weight, reps, done: true });
  assert.deepEqual(suggestWeight(ex, [s(50, 12), s(50, 11), s(50, 9)]), { weight: 50, why: 'last' });
  assert.deepEqual(suggestWeight(ex, [s(50, 12), s(50, 12), s(50, 12)]), { weight: 55, why: 'up' });
});

// ---------- Supersets ----------

const combined = {
  name: 'Arm Superset: Cable Curl + Overhead Cable Triceps Extension',
  sets: 2,
  reps_min: 12,
  reps_max: 15,
  weight: null,
  weight_note: 'find it',
  rest: '90 sec after each round',
  note: 'One set of curls, then right away one set of extensions. Rest, repeat.',
};
const lat = { name: 'Single-Arm Cable Pulldown', sets: 3, reps_min: 10, reps_max: 12, weight: null, weight_note: 'find it', rest: '60 sec', note: '' };

test('a superset saved as one exercise becomes two linked exercises', () => {
  const out = splitSupersets([lat, combined]);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.slice(1).map((e) => [e.name, e.sets, e.reps_min, e.reps_max, e.weight_note, e.rest, e.superset]),
    [
      ['Cable Curl', 2, 12, 15, 'find it', '90 sec after each round', 'Arm superset'],
      ['Overhead Cable Triceps Extension', 2, 12, 15, 'find it', '90 sec after each round', 'Arm superset'],
    ],
  );
  assert.equal(out[1]!.note, combined.note);
  assert.equal(out[2]!.note, '');
  assert.deepEqual(planGroups(out), [
    { superset: null, members: [0] },
    { superset: 'Arm superset', members: [1, 2] },
  ]);
});

test('a plan with nothing to split comes back as is', () => {
  const plan = [lat];
  assert.equal(splitSupersets(plan), plan);
  const done = splitSupersets([combined]);
  assert.equal(splitSupersets(done), done);
});

test('an older import pair with "Superset with" notes gets linked', () => {
  const a = { ...lat, name: 'Cable Curl', note: 'Superset with Rope Pushdown' };
  const b = { ...lat, name: 'Rope Pushdown', note: 'Superset with Cable Curl' };
  const out = splitSupersets([a, b]);
  assert.deepEqual(out.map((e) => [e.superset, e.note]), [['Superset', ''], ['Superset', '']]);
});

test('linking and unlinking exercises in the editor', () => {
  const plan = [lat, { ...lat, name: 'B' }, { ...lat, name: 'C' }];
  const linked = linkWithNext(plan, 0, true);
  assert.deepEqual(planGroups(linked).map((g) => g.members), [[0, 1], [2]]);
  const three = linkWithNext(linked, 1, true);
  assert.deepEqual(planGroups(three).map((g) => g.members), [[0, 1, 2]]);
  const back = linkWithNext(three, 0, false);
  assert.deepEqual(planGroups(back).map((g) => g.members), [[0], [1, 2]]);
  assert.equal(back[0]!.superset, undefined);
  const none = linkWithNext(linked, 0, false);
  assert.deepEqual(none.map((e) => e.superset), [undefined, undefined, undefined]);
});
