import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evenSteps, forecastFinish } from '../src/steps.ts';
import type { Milestone } from '../src/types.ts';

const ms = (id: string, due: string, done: string | null = null): Milestone => ({ id, goal_id: 'g', title: id, due_date: due, completed_at: done ? `${done}T12:00:00Z` : null });

test('the forecast waits for a week and a first finish, then follows the pace', () => {
  const four = [ms('a', '2026-11-08'), ms('b', '2026-11-15'), ms('c', '2026-11-22'), ms('d', '2026-11-29')];
  assert.equal(forecastFinish(four, '2026-11-01', '2026-11-04').reason, 'too_early');
  assert.equal(forecastFinish(four, '2026-11-01', '2026-11-10').reason, 'none_done');
  assert.equal(forecastFinish([], '2026-11-01', '2026-11-10').reason, 'no_milestones');
  // 2 done in 14 days → 1 a week, 2 left → 14 more days.
  const two = [ms('a', '2026-11-08', '2026-11-07'), ms('b', '2026-11-15', '2026-11-14'), ms('c', '2026-11-22'), ms('d', '2026-11-29')];
  assert.deepEqual(forecastFinish(two, '2026-11-01', '2026-11-15'), { date: '2026-11-29', reason: 'pace' });
  const all = two.map((m) => ({ ...m, completed_at: m.completed_at ?? '2026-11-20T10:00:00Z' }));
  assert.deepEqual(forecastFinish(all, '2026-11-01', '2026-11-21'), { date: '2026-11-20', reason: 'done' });
});

test('the forecast follows the last 4 weeks when there is enough in them', () => {
  const list = [ms('a', '2026-11-10', '2026-11-10'), ms('b', '', '2026-12-20'), ms('c', '', '2026-12-27'), ms('d', '', '2027-01-03'), ms('e', '2027-01-20'), ms('f', '2027-01-30'), ms('g', '2027-02-10')];
  assert.equal(forecastFinish(list, '2026-11-01', '2027-01-05').date, '2027-02-02');
});

test('a forecast years out says "not at this pace" instead of a date', () => {
  const list = [ms('a', '2026-11-10', '2026-11-08'), ...Array.from({ length: 200 }, (_, i) => ms(`x${i}`, '2027-04-01'))];
  assert.deepEqual(forecastFinish(list, '2026-11-01', '2027-02-01'), { date: null, reason: 'too_slow' });
});

test('even steps end on the end date', () => {
  const steps = evenSteps('Module', 7, '2026-11-01', '2026-11-29');
  assert.equal(steps.length, 7);
  assert.equal(steps[0]!.title, 'Module 1');
  assert.equal(steps.at(-1)!.due_date, '2026-11-29');
  assert.equal(evenSteps('', 2, '2026-11-01', '2026-11-03')[0]!.title, 'Step 1');
});
