import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseClass, pushupPractice, pushupRole, pushupTarget, pushupVolume } from '../src/index.ts';

test('which push-up is which', () => {
  assert.equal(pushupRole('Push-Ups'), 'volume');
  assert.equal(pushupRole('Push-Up Max Test'), 'test');
  assert.equal(pushupRole('Pushups'), 'volume');
  assert.equal(pushupRole('Pike Push-Up'), null);
  assert.equal(pushupRole('Flat DB Bench Press'), null);
  assert.equal(exerciseClass({ name: 'Push-Up Max Test', weight_note: '' }), 'bodyweight');
  assert.equal(exerciseClass({ name: 'Push-Ups', weight_note: '' }), 'bodyweight');
});

test('Monday sets by phase, rounded down (the plan’s examples)', () => {
  assert.deepEqual(pushupVolume(35), { phase: 1, sets: 5, reps: 21, extra: null });
  assert.deepEqual(pushupVolume(65), { phase: 2, sets: 4, reps: 42, extra: null });
  assert.deepEqual(pushupVolume(85), { phase: 3, sets: 3, reps: 59, extra: 83 });
  assert.deepEqual(pushupVolume(59), { phase: 1, sets: 5, reps: 35, extra: null });
  assert.deepEqual(pushupVolume(80), { phase: 3, sets: 3, reps: 56, extra: 78 });
  assert.deepEqual(pushupVolume(40, true), { phase: null, sets: 3, reps: 20, extra: null });
  assert.equal(pushupPractice(35), 14);
});

test('Monday follows the last Saturday test, before the first test the estimate', () => {
  assert.equal(pushupTarget('volume', '2026-11-16', { tests: [], lastVolume: null }, 35, false).reps, 21);
  const h = { tests: [{ date: '2026-11-14', max: 40 }], lastVolume: null };
  const t = pushupTarget('volume', '2026-11-16', h, 35, false);
  assert.deepEqual([t.max, t.sets, t.reps, t.practice], [40, 5, 24, 16]);
  assert.match(t.text, /Max 40 → phase 1: 5 × 24/);
});

test("a missed Monday keeps the same numbers, even after a new max", () => {
  const h = { tests: [{ date: '2026-11-14', max: 40 }, { date: '2026-11-21', max: 44 }], lastVolume: { date: '2026-11-16', reps: [24, 24, 24, 20, 18] } };
  const t = pushupTarget('volume', '2026-11-23', h, 35, false);
  assert.deepEqual([t.sets, t.reps, t.repeat], [5, 24, true]);
  const ok = pushupTarget('volume', '2026-11-23', { ...h, lastVolume: { date: '2026-11-16', reps: [24, 24, 24, 24, 24] } }, 35, false);
  assert.deepEqual([ok.reps, ok.repeat], [26, false]);
});

test('the test day, a flat max, and the lighter week', () => {
  const h = { tests: [{ date: '2026-11-14', max: 40 }, { date: '2026-11-21', max: 40 }], lastVolume: null };
  const t = pushupTarget('test', '2026-11-28', h, 35, false);
  assert.equal(t.sets, 1);
  assert.match(t.text, /Last max: 40/);
  assert.ok(t.flat);
  assert.match(t.text, /skip the home practice/);
  assert.match(pushupTarget('test', '2026-12-19', h, 35, true).text, /no test today/);
  const light = pushupTarget('volume', '2026-12-14', h, 35, true);
  assert.deepEqual([light.sets, light.reps], [3, 20]);
});

test('home practice: 3 × 40%, skipped in a lighter week or after a flat max, and not a lifting day', async () => {
  const { isPushupPracticeOnly } = await import('../src/index.ts');
  assert.equal(pushupRole('Push-Up Practice'), 'practice');
  const t = pushupTarget('practice', '2026-11-18', { tests: [{ date: '2026-11-14', max: 40 }], lastVolume: null }, 35, false);
  assert.deepEqual([t.sets, t.reps], [3, 16]);
  assert.match(pushupTarget('practice', '2026-12-16', { tests: [], lastVolume: null }, 35, true).text, /no home practice/);
  assert.ok(isPushupPracticeOnly([{ name: 'Push-Up Practice' }]));
  assert.ok(!isPushupPracticeOnly([{ name: 'Push-Ups' }]));
});
