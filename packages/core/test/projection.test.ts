import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectNumberGoal } from '../src/projection.ts';

const r = (measured_on: string, value: number) => ({ id: measured_on, type_id: 't', value, measured_on, source: 'task', note: '' }) as never;

test('projects the target date from the recent rate', () => {
  const goal = { target_value: 155, target_date: '2027-04-26' };
  // 1 lb a week down over four weeks
  const readings = [r('2026-11-02', 194), r('2026-11-09', 193), r('2026-11-16', 192), r('2026-11-23', 191), r('2026-11-30', 190)];
  const p = projectNumberGoal(goal, readings, '2026-11-30');
  assert.equal(p.ratePerWeek, -1);
  assert.equal(p.eta, '2027-08-02'); // 35 lb at 1/week = 245 days
  assert.ok(p.daysOff! > 0);
});

test('no eta when the trend points the wrong way or there is too little data', () => {
  const goal = { target_value: 155, target_date: '2027-04-26' };
  assert.equal(projectNumberGoal(goal, [r('2026-11-30', 190)], '2026-11-30').eta, null);
  const up = projectNumberGoal(goal, [r('2026-11-02', 190), r('2026-11-30', 192)], '2026-11-30');
  assert.equal(up.eta, null);
  assert.ok(up.ratePerWeek! > 0);
});

test('the eta counts from the last reading, not from today', () => {
  const goal = { target_value: 155, target_date: '2027-04-26' };
  const readings = [r('2026-11-02', 194), r('2026-11-09', 193), r('2026-11-16', 192), r('2026-11-20', 191)];
  const fresh = projectNumberGoal(goal, readings, '2026-11-20');
  const stale = projectNumberGoal(goal, readings, '2026-11-25');
  assert.equal(fresh.eta, stale.eta);
});
