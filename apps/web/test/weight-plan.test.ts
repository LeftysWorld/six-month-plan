import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Goal, Measurement } from '@six/core';
import { checkLevelTarget, levelStanding, noteParts, orderLevels, untilText, type WeightLevel } from '../src/data/weightPlan.ts';
import { weighInNow } from '../src/data/weightGoal.ts';

// The weight goal from the redesign: 194.2 on Oct 26 down to 155 by Apr 26, a straight path.
const start = { date: '2026-10-26', value: 194.2 };
const path = [start, { date: '2027-04-26', value: 155 }];
const pathAt = (d: string) => {
  const days = (Date.parse(`${d}T00:00:00Z`) - Date.parse('2026-10-26T00:00:00Z')) / 86400000;
  return 194.2 - (39.2 * days) / 182;
};
const level = (id: WeightLevel['id'], label: string, end: string, value: number | null): WeightLevel => ({ id, label, end, value, note: '', step: null });
const levels = [
  level('week', 'This week', '2026-11-01', 192.9),
  level('month', 'This month', '2026-11-22', 188),
  level('quarter', '3 months', '2027-01-24', 175),
  level('season', 'Season', '2027-04-26', 155),
];
const opts = { trend: 193.1, today: '2026-11-01', direction: -1, pathAt, steadyHigh: 1.9 };
const fmt = (v: number) => String(Math.round(v * 10) / 10);

test('levels read in date order, whatever order they come in', () => {
  const mixed = [levels[2]!, levels[0]!, levels[3]!, levels[1]!];
  assert.deepEqual(orderLevels(mixed).map((l) => l.id), ['week', 'month', 'quarter', 'season']);
});

test('a level is judged from the 7-day average and against the path', () => {
  const month = levelStanding(levels[1]!, opts)!;
  assert.equal(month.toGo, 5.1);
  assert.equal(month.needs, 1.7);
  assert.equal(month.path, 188.4);
  assert.ok(Math.abs(month.offPath) <= 1, 'on the path');
  assert.equal(month.steep, false);
  assert.equal(levelStanding(level('month', 'This month', '2026-11-22', null), opts), null);
});

test('a target out of order is refused, with the bounds', () => {
  const tooHigh = checkLevelTarget(levels, 2, '190', { start: 194.2, direction: -1, trend: 193.1, today: '2026-11-01', unit: 'lb', steadyHigh: 1.9, fmt });
  assert.equal(tooHigh.ok, false);
  assert.match(tooHigh.text, /under 188 \(this month\) and over 155 \(season\)/);
  const fits = checkLevelTarget(levels, 2, '176', { start: 194.2, direction: -1, trend: 193.1, today: '2026-11-01', unit: 'lb', steadyHigh: 1.9, fmt });
  assert.equal(fits.ok, true);
  assert.match(fits.text, /^Fits: 12 lb after this month/);
  const week = checkLevelTarget(levels, 0, '195', { start: 194.2, direction: -1, trend: 193.1, today: '2026-11-01', unit: 'lb', steadyHigh: 1.9, fmt });
  assert.match(week.text, /under 194.2 \(your start\)/);
  assert.equal(checkLevelTarget(levels, 1, '', { start: 194.2, direction: -1, trend: 193.1, today: '2026-11-01', unit: 'lb', steadyHigh: 1.9, fmt }).ok, false);
});

test('a week goal note splits into what you’ll do', () => {
  assert.deepEqual(noteParts('All five workouts; weight and a photo every morning; no alcohol, keto every day'), ['All five workouts', 'Weight and a photo every morning', 'No alcohol, keto every day']);
});

test('time to a level reads in days, then weeks', () => {
  assert.equal(untilText('2026-11-01', '2026-11-01', (d) => d), 'ends today');
  assert.equal(untilText('2026-11-01', '2026-11-05', (d) => d), 'in 4 days');
  assert.equal(untilText('2026-11-01', '2026-11-22', (d) => d), 'in 3 weeks');
});

test('a weight goal stands on its 7-day average, not one morning', () => {
  const values = [194.2, 192.7, 192.7, 194.6, 194.0, 192.4, 190.8];
  const readings = values.map((v, i) => ({ id: `m${i}`, measurement_type_id: 'w', value: v, measured_on: `2026-${i < 6 ? '10' : '11'}-${String(i < 6 ? 26 + i : 1).padStart(2, '0')}` })) as unknown as Measurement[];
  const goal = { target_value: 155, unit: 'lb' } as unknown as Goal;
  const now = weighInNow(goal, start, path, readings, '2026-11-01')!;
  assert.equal(Number(now.latest.value), 190.8);
  assert.equal(now.trend, 193.1);
  assert.equal(now.status.zone, 'on_track', 'the average is 0.2 above the path: on track, not 2.1 ahead');
});
