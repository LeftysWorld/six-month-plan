import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveShare, monthlyAmounts, suggestLoadFix, totalBy, valueBy, weekLoad, weekNeeds, weekToPlan, type PlacedTask } from '../src/ladder.ts';

test('every curve starts at nothing and ends at the whole', () => {
  for (const c of ['even', 'ramp', 'front'] as const) {
    assert.equal(curveShare(c, '2026-11-02', '2027-04-30', '2027-04-30'), 1);
    assert.ok(curveShare(c, '2026-11-02', '2027-04-30', '2026-11-01') <= 0.01);
  }
});

test('ramp is behind even early and front-load is ahead, halfway', () => {
  const at = '2027-01-30';
  const even = totalBy(150, 'even', '2026-11-02', '2027-04-30', at);
  const ramp = totalBy(150, 'ramp', '2026-11-02', '2027-04-30', at);
  const front = totalBy(150, 'front', '2026-11-02', '2027-04-30', at);
  assert.ok(ramp < even && even < front, `${ramp} < ${even} < ${front}`);
  assert.ok(Math.abs(even - 75) <= 1);
});

test('a number goal follows the curve too', () => {
  assert.equal(valueBy(210, 190, 'even', '2026-11-01', '2026-11-30', '2026-11-30'), 190);
  assert.equal(valueBy(210, 190, 'even', '2026-11-01', '2026-11-30', '2026-11-15'), 200);
});

test('monthly amounts add up to the whole and the cumulative ends there', () => {
  const months = monthlyAmounts(150, 'ramp', '2026-11-02', '2027-04-30');
  assert.deepEqual(months.map((m) => m.month), ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr']);
  assert.equal(months.reduce((s, m) => s + m.amount, 0), 150);
  assert.equal(months.at(-1)!.cumulative, 150);
  assert.ok(months[0]!.amount < months.at(-1)!.amount);
});

test('a week needs what is left spread over the weeks left', () => {
  // 16 to go, Monday Nov 9 to Sunday Nov 29: 3 weeks → 6 a week.
  assert.equal(weekNeeds(20, 4, '2026-11-09', '2026-11-29'), 6);
  assert.equal(weekNeeds(20, 25, '2026-11-09', '2026-11-29'), 0);
  assert.equal(weekNeeds(20, 0, '2026-11-23', '2026-11-29'), 20);
});

const MON = '2026-11-02';
const avail = [180, 150, 120, 120, 150, 180, 60];
const t = (key: string, date: string, minutes: number, movable = true, taskKey = key): PlacedTask => ({ key, taskKey, date, minutes, movable });

test('the week load adds minutes per day and flags the overload', () => {
  const load = weekLoad(MON, [t('a', '2026-11-05', 40), t('b', '2026-11-05', 45), t('gym', '2026-11-05', 60, false)], avail);
  assert.equal(load[3]!.planned, 145);
  assert.equal(load[3]!.over, 25);
  assert.equal(load[0]!.over, 0);
});

test('the fix moves the smallest task that clears the overload to the day with the most room', () => {
  const tasks = [t('edits', '2026-11-05', 40), t('apply-thu', '2026-11-05', 45, true, 'apply'), t('gym', '2026-11-05', 60, false), t('apply-sat', '2026-11-07', 45, true, 'apply')];
  const fix = suggestLoadFix(MON, tasks, avail);
  assert.deepEqual(fix && { key: fix.key, to: fix.to }, { key: 'edits', to: '2026-11-02' });
});

test('the fix never puts a task on a day that already has it, nor on a day that is gone', () => {
  const tasks = [t('apply-thu', '2026-11-05', 145, true, 'apply'), t('apply-mon', '2026-11-02', 10, true, 'apply')];
  const fix = suggestLoadFix(MON, tasks, avail, '2026-11-04');
  assert.ok(fix && fix.to !== '2026-11-02' && fix.to >= '2026-11-04');
});

test('nothing to move means no fix', () => {
  assert.equal(suggestLoadFix(MON, [t('gym', '2026-11-05', 200, false)], avail), null);
});

test('the week to plan is this week until Wednesday, then next week', () => {
  assert.equal(weekToPlan('2026-11-02'), '2026-11-02');
  assert.equal(weekToPlan('2026-11-04'), '2026-11-02');
  assert.equal(weekToPlan('2026-10-30'), '2026-11-02');
  assert.equal(weekToPlan('2026-11-08'), '2026-11-09');
});
