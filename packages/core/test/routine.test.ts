import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WAKE, STARTER_ROUTINE, WAKE_CHOICES, afterWaking, cleanRoutine, clockMinutes, clockValue, timeOfDay, dailyRoutine, routineNow, routineRows, type RoutineItem } from '../src/index.ts';

/** A full day as someone saved it: nine items, two of them only on lifting days. */
const ITEMS: RoutineItem[] = [
  { at: 0, what: "Wake up, glass of water" },
  { at: 30, what: "GHOST Legend pre-workout", note: "Take it 20–30 min before you lift.", on: "lift" },
  { at: 60, minutes: 90, what: "Lift, then stretch", on: "lift" },
  { at: 165, what: "Whey shake #1 + creatine (5\u00a0g)", note: "Mix the creatine right into the shake. It works the same at any time of day. Taking it daily is what matters.", rest_note: "Rest day, same shake and creatine: taking it daily is what matters." },
  { at: 360, what: "Whey shake #2", note: "This replaces lunch. No caffeine after this point." },
  { at: 690, what: "Dinner", note: "Finish eating at least 3 hours before bed." },
  { at: 900, what: "Magnesium bisglycinate", note: "It helps you relax and sleep." },
  { at: 915, what: "Deep Sleep Complex", note: "Take it 30–45 min before bed." },
  { at: 960, what: "Lights out", note: "8 hours of sleep, up at {wake}." },
];
const saved = (wake = 420) => dailyRoutine({ wake, items: ITEMS });

test('the routine at 7:00 matches the schedule', () => {
  const rows = routineRows(saved());
  assert.deepEqual(rows.map((r) => r.time), ['7:00 am', '7:30 am', '8:00–9:30 am', '9:45 am', '1:00 pm', '6:30 pm', '10:00 pm', '10:15 pm', '11:00 pm']);
  assert.equal(rows.at(-1)!.note, '8 hours of sleep, up at 7:00.');
});

test('moving the wake-up moves the whole day', () => {
  const at6 = routineRows(saved(6 * 60));
  assert.deepEqual([at6[0]!.time, at6[2]!.time, at6[4]!.time, at6.at(-1)!.time], ['6:00 am', '7:00–8:30 am', '12:00 pm', '10:00 pm']);
  assert.equal(at6.at(-1)!.note, '8 hours of sleep, up at 6:00.');
  const at430 = routineRows(saved(4 * 60 + 30));
  assert.deepEqual([at430[0]!.time, at430[2]!.time, at430.at(-1)!.time], ['4:30 am', '5:30–7:00 am', '8:30 pm']);
  // A block that crosses noon names both halves.
  assert.equal(routineRows(saved(10 * 60 + 30))[2]!.time, '11:30 am–1:00 pm');
  assert.equal(WAKE_CHOICES[0], 240);
  assert.equal(WAKE_CHOICES.at(-1), 540);
  assert.equal(dailyRoutine({ wake: -5 }).wake, DEFAULT_WAKE, 'a bad wake-up falls back to 7:00');
});

test('where you are in the day: the block under way, the next item, what is past', () => {
  const rows = routineRows(saved());
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

test('a rest day drops the pre-workout and the lift; the rest keeps its times', () => {
  const rest = routineRows(saved(), false);
  assert.deepEqual(rest.map((r) => r.item.what), ['Wake up, glass of water', 'Whey shake #1 + creatine (5\u00a0g)', 'Whey shake #2', 'Dinner', 'Magnesium bisglycinate', 'Deep Sleep Complex', 'Lights out']);
  assert.equal(rest[1]!.time, '9:45 am');
  assert.match(rest[1]!.note, /^Rest day/);
  assert.equal(routineRows(saved(), true).length, 9);
  // A saved routine from before rest days (no "on") shows every item every day.
  const old = dailyRoutine({ wake: 420, items: [{ at: 0, what: 'Wake' }, { at: 60, what: 'Lift' }] });
  assert.equal(routineRows(old, false).length, 2);
});

test('no routine saved is an empty day: the app ships no items of its own', () => {
  assert.deepEqual(dailyRoutine(null), { wake: 420, items: [] });
  assert.deepEqual(dailyRoutine({ wake: 6 * 60 }), { wake: 360, items: [] }, 'a wake-up alone brings no items with it');
  assert.deepEqual(routineRows(dailyRoutine(null)), []);
  const none = routineNow([], 9 * 60);
  assert.deepEqual([none.current, none.next], [null, null]);
  // Setting one up starts from the two ends of the day, nothing else.
  assert.deepEqual(routineRows(STARTER_ROUTINE).map((r) => `${r.time} ${r.item.what}`), ['7:00 am Wake up', '11:00 pm Lights out']);
});

test('editing by the clock: a time becomes minutes after waking, and a time before the wake-up is that night', () => {
  assert.equal(afterWaking(420, 7 * 60 + 30), 30);
  assert.equal(afterWaking(420, 23 * 60), 960);
  assert.equal(afterWaking(420, 30), 1050, '12:30 am is the end of a day that started at 7:00');
  assert.equal(afterWaking(420, 420), 0);
  assert.deepEqual([clockValue(450), clockValue(420 + 1050), clockMinutes('07:30'), clockMinutes('23:05:00'), clockMinutes(''), clockMinutes('25:00')], ['07:30', '00:30', 450, 1385, null, null]);
});

test('saving an edited day: blanks dropped, text trimmed, in time order, extras kept', () => {
  const saved = cleanRoutine(390, [
    { at: 960, what: ' Lights out ', note: '' },
    { at: 30, what: 'Walk', note: ' 20 minutes ', on: 'lift' },
    { at: 120, what: '   ' },
    { at: 0, what: 'Wake up', minutes: 0 },
    { at: 60, minutes: 45, what: 'Class', rest_note: 'Stretch at home instead.' },
  ]);
  assert.deepEqual(saved, {
    wake: 390,
    items: [
      { at: 0, what: 'Wake up' },
      { at: 30, what: 'Walk', note: '20 minutes', on: 'lift' },
      { at: 60, minutes: 45, what: 'Class', rest_note: 'Stretch at home instead.' },
      { at: 960, what: 'Lights out' },
    ],
  });
  // A saved routine reads back as it was written, and a full day round-trips unchanged.
  assert.deepEqual(dailyRoutine(saved), saved);
  assert.deepEqual(cleanRoutine(420, ITEMS).items, ITEMS);
  assert.deepEqual(cleanRoutine(420, []), { wake: 420, items: [] }, 'removing everything clears the day');
});

