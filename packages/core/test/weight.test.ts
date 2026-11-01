import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWeightType, logsReading, rollingAverage, steadyRange, weighInStatus, weightMilestones, weightWeeks, type Measurement, type PathPoint } from '../src/index.ts';

// Elliot's first week on "Down to 155 lb": path from 192.7 on Oct 28 to 155 on Apr 26.
const R = (d: string, v: number): Measurement => ({ id: d, type_id: 'w', measured_on: d, value: v, note: '' }) as Measurement;
const readings = [R('2026-10-28', 192.7), R('2026-10-29', 194.6), R('2026-10-30', 194.0), R('2026-10-31', 192.4), R('2026-11-01', 190.8)];
const start: PathPoint = { date: '2026-10-28', value: 192.7 };
const path: PathPoint[] = [{ date: '2027-04-26', value: 155 }];

test('weight tasks log a reading like a number task', () => {
  assert.equal(logsReading('weight'), true);
  assert.equal(logsReading('measure'), true);
  assert.equal(logsReading('photo'), false);
  assert.equal(isWeightType({ name: 'Weight', unit: 'lb' }), true);
  assert.equal(isWeightType({ name: 'Body weight', unit: 'kg' }), true);
  assert.equal(isWeightType({ name: 'Waist', unit: 'in' }), false);
});

test('the weigh-in is judged against the path, with a band before it reads as over', () => {
  // Path today (Nov 1) is about 191.9: 190.8 is 1.1 ahead.
  const s = weighInStatus(190.8, 191.86, -1, 'lb');
  assert.equal(s.zone, 'ahead');
  assert.equal(s.text, '1.1 lb ahead of the path');
  assert.equal(weighInStatus(192.4, 192.07, -1, 'lb').zone, 'on_track');
  const over = weighInStatus(194.6, 192.49, -1, 'lb');
  assert.equal(over.zone, 'over');
  assert.equal(over.text, '2.1 lb over the path today');
});

test('rolling average over seven days', () => {
  assert.equal(rollingAverage(readings, '2026-11-01'), 192.9);
  assert.equal(rollingAverage(readings, '2026-10-20'), null);
});

test('weeks end on Sunday with the last weigh-in against the path', () => {
  const weeks = weightWeeks(start, path, readings, '2026-11-01', '2026-11-15', -1);
  assert.equal(weeks.length, 3);
  const w = weeks[0]!;
  assert.deepEqual([w.start, w.end, w.last, w.average, w.count, w.pathEnd, w.aheadBy, w.change], ['2026-10-26', '2026-11-01', 190.8, 192.9, 5, 191.9, 1.1, -1.9]);
  assert.equal(weeks[1]!.last, null);
  assert.equal(weeks[1]!.pathEnd, 190.4);
});

test('milestones on the 5s, with the date at your pace and on the path', () => {
  const ms = weightMilestones(start, path, 155, readings, readings.at(-1)!, -2.364 / 7, 'lb');
  assert.deepEqual(ms.map((m) => m.value), [185, 175, 165, 155]);
  assert.deepEqual(ms.map((m) => m.atPace), ['2026-11-19', '2026-12-18', '2027-01-17', '2027-02-16']);
  assert.deepEqual(ms.map((m) => m.onPath), ['2026-12-04', '2027-01-21', '2027-03-10', '2027-04-26']);
  assert.equal(ms[0]!.toGo, 5.8);
});

test('steady pace is half to one percent of your weight a week', () => {
  assert.deepEqual(steadyRange(190.8), { low: 1, high: 1.9 });
});

test('the app’s stops, and the path and pace dates for any weight', async () => {
  const { weightStopValues, onPathDate, atPaceDate } = await import('../src/index.ts');
  assert.deepEqual(weightStopValues(194.2, 155, 'lb'), [185, 175, 165]);
  assert.deepEqual(weightStopValues(194.2, 155, 'lb', 5), [190, 185, 180, 175, 170, 165, 160]);
  assert.deepEqual(weightStopValues(88, 75, 'kg'), [85, 80]);
  assert.deepEqual(weightStopValues(150, 170, 'lb'), [155, 165]);
  assert.equal(onPathDate(start, path, 185), '2026-12-04');
  assert.equal(atPaceDate(readings.at(-1)!, 185, -2.364 / 7), '2026-11-19');
});
