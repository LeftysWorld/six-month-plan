import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseClass, pushupRole, pushupTarget, pushupTest, type PushupLog } from '../src/index.ts';

const log = (date: string, name: string, reps: number[], weight: number | null = null): PushupLog => ({ date, role: pushupRole(name)!, name, reps, weight });

test('which push-up is which part of the program', () => {
  assert.equal(pushupRole('Push-Up Max Sets'), 'test');
  assert.equal(pushupRole('Push-Up Training Sets'), 'training');
  assert.equal(pushupRole('Push-Up Density Pyramid'), 'pyramid');
  assert.equal(pushupRole('Paused Push-Ups'), 'strength');
  assert.equal(pushupRole('Close-Grip Push-Ups'), 'strength');
  assert.equal(pushupRole('Pike Push-Up'), null);
  assert.equal(pushupRole('Flat DB Bench Press'), null);
  assert.equal(exerciseClass({ name: 'Close-Grip Push-Ups', weight_note: '' }), 'bodyweight');
});

test('Monday: 5 all-out sets, set 1 is the test; the lighter week is the test set only', () => {
  const first = pushupTarget('test', 'Push-Up Max Sets', '2026-11-16', [], 35, false);
  assert.deepEqual([first.sets, first.test], [5, 35]);
  assert.match(first.text, /first one \(estimate 35\)/);
  const logs = [log('2026-11-16', 'Push-Up Max Sets', [35, 28, 24, 21, 18])];
  assert.equal(pushupTest(logs, '2026-11-23', 35), 35);
  const next = pushupTarget('test', 'Push-Up Max Sets', '2026-11-23', logs, 35, false);
  assert.match(next.text, /beat 35/);
  assert.match(next.text, /5-set total: 126/);
  assert.equal(pushupTarget('test', 'Push-Up Max Sets', '2026-12-14', logs, 35, true).sets, 1);
});

test('Thursday: half the Monday test, up to 10 sets; all 10 done adds a rep', () => {
  const mon = log('2026-11-16', 'Push-Up Max Sets', [35, 28, 24, 21, 18]);
  const t = pushupTarget('training', 'Push-Up Training Sets', '2026-11-19', [mon], 35, false);
  assert.deepEqual([t.sets, t.reps_min], [10, 17]);
  const did10 = log('2026-11-19', 'Push-Up Training Sets', Array(10).fill(17));
  const mon2 = log('2026-11-23', 'Push-Up Max Sets', [35, 29, 25, 22, 19]);
  const up = pushupTarget('training', 'Push-Up Training Sets', '2026-11-26', [mon, did10, mon2], 35, false);
  assert.deepEqual([up.reps_min, up.up], [18, true]);
  const did7 = log('2026-11-19', 'Push-Up Training Sets', [17, 17, 17, 17, 17, 17, 17]);
  assert.equal(pushupTarget('training', 'Push-Up Training Sets', '2026-11-26', [mon, did7, mon2], 35, false).reps_min, 17);
  // A bigger test moves the floor up even after a short Thursday.
  const mon3 = log('2026-11-23', 'Push-Up Max Sets', [40]);
  assert.equal(pushupTarget('training', 'Push-Up Training Sets', '2026-11-26', [mon, did7, mon3], 35, false).reps_min, 20);
  assert.equal(pushupTarget('training', 'Push-Up Training Sets', '2026-12-17', [mon], 35, true).sets, 5);
});

test('Tuesday and Friday: 8–12, then 15, then a plate back at 8–12; 2 sets in a lighter week', () => {
  const name = 'Paused Push-Ups';
  assert.deepEqual(((t) => [t.sets, t.reps_min, t.reps_max])(pushupTarget('strength', name, '2026-11-17', [], 35, false)), [3, 8, 12]);
  const at12 = [log('2026-11-17', name, [12, 12, 12])];
  assert.deepEqual(((t) => [t.reps_min, t.reps_max, t.up])(pushupTarget('strength', name, '2026-11-24', at12, 35, false)), [15, 15, true]);
  const at15 = [log('2026-12-01', name, [15, 15, 15])];
  const plate = pushupTarget('strength', name, '2026-12-08', at15, 35, false);
  assert.deepEqual([plate.reps_min, plate.reps_max, plate.weight], [8, 12, 10]);
  const mid15 = [log('2026-11-24', name, [15, 14, 13])];
  assert.equal(pushupTarget('strength', name, '2026-12-01', mid15, 35, false).reps_min, 15);
  // The other strength day has its own progression.
  assert.equal(pushupTarget('strength', 'Close-Grip Push-Ups', '2026-11-20', at12, 35, false).reps_min, 8);
  assert.equal(pushupTarget('strength', name, '2026-12-15', [], 35, true).sets, 2);
});

test('Saturday: the pyramid, beat last step; skipped in a lighter week', () => {
  const t = pushupTarget('pyramid', 'Push-Up Density Pyramid', '2026-11-21', [log('2026-11-14', 'Push-Up Density Pyramid', [8, 22])], 35, false);
  assert.equal(t.step, 8);
  assert.match(t.text, /step 8, final set 22\. Reach step 9/);
  assert.ok(pushupTarget('pyramid', 'Push-Up Density Pyramid', '2026-12-19', [], 35, true).skip);
});
