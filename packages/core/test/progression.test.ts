import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deloadPlan, exerciseClass, isStalled, nextTarget, phaseSwitchDue, repCap, type ExerciseSession, type PlannedExercise } from '../src/index.ts';

const ex = (name: string, sets: number, lo: number, hi: number, weight: number | null, extra: Partial<PlannedExercise> = {}): PlannedExercise => ({ name, sets, reps_min: lo, reps_max: hi, weight, weight_note: '', rest: '', note: '', ...extra });
const sess = (date: string, weight: number | null, reps: number[], deload = false): ExerciseSession => ({ date, deload, sets: reps.map((r) => ({ weight, reps: r, done: true })) });

test('Rule 1: every exercise in the plan gets its class', () => {
  const cls = (n: string, note = '') => exerciseClass({ name: n, weight_note: note });
  for (const n of ['Flat DB Bench Press', 'Machine Chest Press', 'Seated Cable Row', 'Chest-Supported DB Row', 'Single-Arm Cable Pulldown']) assert.equal(cls(n), 'compound', n);
  for (const n of ['Seated DB Curl', 'Seated Incline DB Curl', 'Seated Hammer Curl', 'Cable Curl', 'Cable Triceps Pushdown', 'Seated Overhead Triceps Extension', 'Overhead Cable Triceps Extension', 'Seated Lateral Raise', 'Cable Lateral Raise', 'Seated Rear-Delt Fly', 'Chest-Supported Rear-Delt Row', 'Low-Incline DB Fly', 'Straight-Arm Cable Pulldown', 'Cable External Rotation']) assert.equal(cls(n), 'isolation', n);
  for (const n of ['Assisted Pull-Up', 'Assisted Dip']) assert.equal(cls(n), 'assisted', n);
  for (const n of ['Sit-Up Bench Crunch (knee test)', 'Hammer Strength Back Extension', 'Hammer Strength Glute/Ham Hip Extension (knee test)']) assert.equal(cls(n, 'bodyweight'), 'bodyweight', n);
  assert.equal(exerciseClass({ name: 'Odd thing', weight_note: '', class: 'compound' }), 'compound', 'the plan can set it');
});

test('compound: reps, then +5 lb back to the bottom of the range', () => {
  const bench = ex('Flat DB Bench Press', 3, 8, 12, 55);
  assert.equal(nextTarget({ ex: bench, history: [] }).why, 'plan');
  const hold = nextTarget({ ex: bench, history: [sess('2026-11-02', 55, [12, 11, 10])] });
  assert.deepEqual([hold.why, hold.weight, hold.sets], ['hold', 55, 3]);
  const up = nextTarget({ ex: bench, history: [sess('2026-11-02', 55, [12, 12, 12])] });
  assert.deepEqual([up.why, up.weight, up.sets], ['load_up', 60, 3]);
  assert.match(up.text, /up to 60, aim for 8\+/);
  assert.equal(up.effort, '1–2 reps left on every set.');
});

test('isolation: reps, then one more set (max 4), then 2.5 lb back to the original sets', () => {
  const curl = ex('Seated DB Curl', 3, 10, 12, 25);
  const s1 = nextTarget({ ex: curl, history: [sess('2026-11-03', 25, [12, 12, 12])] });
  assert.deepEqual([s1.why, s1.weight, s1.sets], ['add_set', 25, 4]);
  // Still building the 4th set: keep 4 sets.
  const s2 = nextTarget({ ex: curl, history: [sess('2026-11-03', 25, [12, 12, 12]), sess('2026-11-10', 25, [12, 12, 12, 10])] });
  assert.deepEqual([s2.why, s2.weight, s2.sets], ['hold', 25, 4]);
  const s3 = nextTarget({ ex: curl, history: [sess('2026-11-10', 25, [12, 12, 12, 10]), sess('2026-11-17', 25, [12, 12, 12, 12])] });
  assert.deepEqual([s3.why, s3.weight, s3.sets], ['load_up', 27.5, 3]);
  // Already at 4 planned sets: straight to load.
  const four = nextTarget({ ex: ex('Cable Triceps Pushdown', 4, 12, 15, 50), history: [sess('2026-11-03', 50, [15, 15, 15, 15])] });
  assert.deepEqual([four.why, four.weight], ['load_up', 52.5]);
  assert.match(four.effort, /0–1 on the last set/);
});

test('isolation with no small enough step: tempo instead of a +50% jump', () => {
  const raise = ex('Seated Rear-Delt Fly', 3, 12, 15, 10);
  const r = nextTarget({ ex: raise, history: [sess('2026-11-06', 10, [15, 15, 15, 15])], steps: { compound: 5, isolation: 5, assist: 5, max_isolation_jump: 0.25 } });
  assert.deepEqual([r.why, r.weight, r.tempo], ['tempo', 10, true]);
  assert.match(r.text, /3 s down, 1 s pause/);
});

test('lateral raises: capped at 12 reps, failure between 8 and 12', () => {
  const cap = repCap('Seated Lateral Raise', [{ match: 'lateral raise', max: 12 }]);
  assert.equal(cap, 12);
  assert.equal(repCap('Seated DB Curl', [{ match: 'lateral raise', max: 12 }]), null);
  const t = nextTarget({ ex: ex('Seated Lateral Raise', 4, 12, 15, 10), history: [sess('2026-11-03', 10, [12, 12, 12])], cap: 12 });
  assert.equal(t.reps_max, 12);
  assert.equal(t.reps_min, 12, 'the range never starts above the cap');
  assert.match(t.effort, /between 8 and 12/);
});

test('assisted: every set at the top, 5 lb less assist; lower assist is the working set', () => {
  const pull = ex('Assisted Pull-Up', 4, 6, 8, null, { weight_note: '~90 lb assist' });
  const t = nextTarget({ ex: pull, history: [sess('2026-11-02', 90, [8, 8, 8, 8])] });
  assert.deepEqual([t.cls, t.why, t.weight], ['assisted', 'assist_down', 85]);
  assert.equal(nextTarget({ ex: pull, history: [sess('2026-11-02', 90, [8, 8, 7, 6])] }).why, 'hold');
  // Assist lowered set by set (93.5, 93.5, 87.5, 81.25), all at 10: every set starts at 81.25.
  const stepped: ExerciseSession = { date: '2026-11-02', sets: [93.5, 93.5, 87.5, 81.25].map((w) => ({ weight: w, reps: 10, done: true })) };
  const s = nextTarget({ ex: pull, history: [stepped] });
  assert.deepEqual([s.why, s.weight], ['assist_down', 81.25]);
  // Another day's pull-ups never carry over: each day keeps its own assist.
  const own = nextTarget({ ex: pull, history: [sess('2026-11-02', 90, [8, 8, 7, 6])], elsewhere: sess('2026-11-05', 80, [10, 10, 10]) });
  assert.equal(own.weight, 90);
});

test('bodyweight: every set at the top, add a plate', () => {
  const t = nextTarget({ ex: ex('Sit-Up Bench Crunch (knee test)', 3, 12, 15, null, { weight_note: 'bodyweight' }), history: [sess('2026-11-03', null, [15, 15, 15])] });
  assert.equal(t.why, 'load_up');
  assert.match(t.text, /5 lb plate/);
});

test('shared: a load increase on one day carries to the same lift on another', () => {
  const satBench = ex('Flat DB Bench Press', 2, 8, 12, 55);
  const t = nextTarget({ ex: satBench, history: [sess('2026-10-31', 50, [12, 12])], elsewhere: sess('2026-11-09', 60, [8, 8, 8]) });
  assert.deepEqual([t.why, t.weight], ['carry', 60]);
});

test('failed jump: set 1 below the range goes back to the old load (isolation: a set instead)', () => {
  const press = ex('Machine Chest Press', 3, 10, 12, 60);
  const t = nextTarget({ ex: press, history: [sess('2026-11-02', 60, [12, 12, 12]), sess('2026-11-09', 65, [8, 8, 7])] });
  assert.deepEqual([t.why, t.weight], ['failed_jump', 60]);
  const curl = nextTarget({ ex: ex('Seated DB Curl', 3, 10, 12, 25), history: [sess('2026-11-03', 25, [12, 12, 12, 12]), sess('2026-11-10', 27.5, [8, 9, 8])] });
  assert.deepEqual([curl.why, curl.weight, curl.sets], ['failed_jump', 25, 4]);
});

test('deload week: half the sets, same load, 3–4 reps left', () => {
  const t = nextTarget({ ex: ex('Seated Cable Row', 4, 6, 10, 110), history: [sess('2026-12-07', 115, [10, 10, 10, 10])], deload: true });
  assert.deepEqual([t.why, t.weight, t.sets], ['deload', 115, 2]);
  assert.match(t.effort, /3–4 reps left/);
  // A deload session doesn't count as the last one to progress from.
  const after = nextTarget({ ex: ex('Seated Cable Row', 4, 6, 10, 110), history: [sess('2026-12-07', 115, [10, 10, 10, 10]), sess('2026-12-14', 115, [6, 6], true)] });
  assert.equal(after.why, 'load_up');
});

test('stall: no more reps or load for two sessions in a row', () => {
  const flat = [sess('2026-11-02', 55, [10, 9, 9]), sess('2026-11-09', 55, [10, 9, 8]), sess('2026-11-16', 55, [10, 9, 9])];
  assert.equal(isStalled(flat, 'compound'), true);
  assert.equal(isStalled([...flat.slice(0, 2), sess('2026-11-16', 55, [11, 10, 9])], 'compound'), false);
  assert.equal(isStalled([sess('2026-11-02', 90, [8, 8]), sess('2026-11-09', 90, [8, 8]), sess('2026-11-16', 85, [7, 7])], 'assisted'), false, 'less assist is progress');
  assert.equal(isStalled(flat.slice(0, 2), 'compound'), false, 'needs three sessions');
});

test('deload weeks: the 8th week, sooner when 3+ lifts stall; a skipped week pushes it a week', () => {
  const none = () => 0;
  const p = deloadPlan('2026-10-26', '2026-12-14', none);
  assert.deepEqual(p.weeks, ['2026-12-14']);
  assert.equal(p.now, true);
  assert.match(p.reason!, /8 weeks since you started/);
  assert.equal(deloadPlan('2026-10-26', '2026-12-07', none).dueBy, '2026-12-14');
  const stalls = (m: string) => (m === '2026-11-30' ? 3 : 0);
  const early = deloadPlan('2026-10-26', '2026-11-30', stalls);
  assert.deepEqual([early.now, early.reason], [true, '3 lifts stalled going into this week']);
  assert.equal(deloadPlan('2026-10-26', '2026-12-07', stalls).dueBy, '2027-01-25', 'the next one counts from the early deload');
  const skipped = deloadPlan('2026-10-26', '2026-12-21', none, ['2026-12-14']);
  assert.deepEqual(skipped.weeks, ['2026-12-21']);
});

test('phase: ask to switch to build at a 7-day average of 175, unless snoozed', () => {
  const cut = { phase: 'cut' as const, target: 175 };
  assert.equal(phaseSwitchDue(cut, 176.2, '2027-02-01'), false);
  assert.equal(phaseSwitchDue(cut, 174.9, '2027-02-01'), true);
  assert.equal(phaseSwitchDue({ ...cut, snoozed_until: '2027-02-07' }, 174.9, '2027-02-01'), false);
  assert.equal(phaseSwitchDue({ ...cut, phase: 'build' }, 170, '2027-02-01'), false);
});

test('a plan weight you changed since the last session wins; an old longer plan does not add a set', () => {
  const press = ex('Machine Chest Press', 3, 10, 12, 60);
  const t = nextTarget({ ex: press, history: [sess('2026-10-29', 50, [12, 12, 12])], planWeightThen: 50 });
  assert.deepEqual([t.why, t.weight], ['plan', 60]);
  assert.match(t.text, /from 50/);
  // Same plan weight as then: the rules decide.
  assert.equal(nextTarget({ ex: press, history: [sess('2026-11-05', 60, [12, 12, 12])], planWeightThen: 60 }).weight, 65);
  // 4 sets last time under an older 4-set plan, now 3: hold at 3 sets, not 4.
  const ext = nextTarget({ ex: ex('Seated Overhead Triceps Extension', 3, 10, 15, 35), history: [sess('2026-10-30', 35, [15, 15, 15, 12])] });
  assert.deepEqual([ext.why, ext.sets], ['hold', 3]);
  // An added set (the session before was 3 at the top) is kept while building it.
  const curl = nextTarget({ ex: ex('Seated DB Curl', 3, 10, 12, 25), history: [sess('2026-11-03', 25, [12, 12, 12]), sess('2026-11-10', 25, [12, 12, 12, 10])] });
  assert.deepEqual([curl.why, curl.sets], ['hold', 4]);
  assert.equal(nextTarget({ ex: ex('Hammer Strength Back Extension', 4, 10, 15, null, { weight_note: 'bodyweight' }), history: [sess('2026-10-29', null, [12, 12, 12, 10])] }).text, 'Get every set to 15.');
});
