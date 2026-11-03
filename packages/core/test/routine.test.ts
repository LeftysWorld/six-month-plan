import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROUTINE, WAKE_CHOICES, timeOfDay, dailyRoutine, routineNow, routineRows } from '../src/index.ts';

test('the routine at 7:00 matches the schedule', () => {
  const rows = routineRows(dailyRoutine(null));
  assert.deepEqual(rows.map((r) => r.time), ['7:00 am', '7:30 am', '8:00–9:30 am', '9:45 am', '1:00 pm', '6:30 pm', '10:00 pm', '10:15 pm', '11:00 pm']);
  assert.equal(rows.at(-1)!.note, '8 hours of sleep, up at 7:00.');
});

test('moving the wake-up moves the whole day', () => {
  const at6 = routineRows(dailyRoutine({ wake: 6 * 60 }));
  assert.deepEqual([at6[0]!.time, at6[2]!.time, at6[4]!.time, at6.at(-1)!.time], ['6:00 am', '7:00–8:30 am', '12:00 pm', '10:00 pm']);
  assert.equal(at6.at(-1)!.note, '8 hours of sleep, up at 6:00.');
  const at430 = routineRows(dailyRoutine({ wake: 4 * 60 + 30 }));
  assert.deepEqual([at430[0]!.time, at430[2]!.time, at430.at(-1)!.time], ['4:30 am', '5:30–7:00 am', '8:30 pm']);
  // A block that crosses noon names both halves.
  assert.equal(routineRows(dailyRoutine({ wake: 10 * 60 + 30 }))[2]!.time, '11:30 am–1:00 pm');
  assert.equal(WAKE_CHOICES[0], 240);
  assert.equal(WAKE_CHOICES.at(-1), 540);
  assert.equal(dailyRoutine({ wake: -5 }).wake, DEFAULT_ROUTINE.wake, 'a bad wake-up falls back to 7:00');
});

test('where you are in the day: the block under way, the next item, what is past', () => {
  const rows = routineRows(dailyRoutine(null));
  const at = (h: number, m = 0) => routineNow(rows, h * 60 + m);
  assert.deepEqual([at(6).current, at(6).next], [null, 0], 'before waking: the wake-up is next, nothing past');
  assert.equal(at(6).past(0), false);
  assert.deepEqual([at(8, 30).current, at(8, 30).next], [2, 3], 'in the lift');
  assert.equal(at(8, 30).past(1), true);
  assert.equal(at(8, 30).past(2), false);
  assert.deepEqual([at(14).current, at(14).next], [null, 5], 'after shake #2, dinner is next');
  assert.equal(at(23, 30).next, null, 'after lights out: the day is done');
  assert.equal(timeOfDay(0), '12:00 am');
  assert.equal(timeOfDay(12 * 60 + 5), '12:05 pm');
});
