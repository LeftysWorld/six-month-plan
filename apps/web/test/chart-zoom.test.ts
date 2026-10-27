import test from 'node:test';
import assert from 'node:assert/strict';
import { clampWindow, lastDaysWindow, panWindow, xTicks, zoomWindow, MIN_WINDOW_DAYS } from '../src/components/chartZoom.ts';

const full = { start: '2026-10-01', end: '2027-03-31' };

test('clampWindow keeps a window inside the range, sliding rather than shrinking', () => {
  assert.deepEqual(clampWindow({ start: '2027-03-20', end: '2027-04-10' }, full), { start: '2027-03-10', end: '2027-03-31' });
  assert.deepEqual(clampWindow({ start: '2026-09-20', end: '2026-10-10' }, full), { start: '2026-10-01', end: '2026-10-21' });
  // Never narrower than a week.
  const tiny = clampWindow({ start: '2026-11-01', end: '2026-11-02' }, full);
  assert.equal(tiny.start, '2026-11-01');
  assert.equal(tiny.end, `2026-11-0${1 + MIN_WINDOW_DAYS}`);
  // Never wider than the range.
  assert.deepEqual(clampWindow({ start: '2026-01-01', end: '2028-01-01' }, full), full);
});

test('zoomWindow zooms in around the anchor and back out to the full range', () => {
  const month = { start: '2026-11-01', end: '2026-12-01' };
  const z = zoomWindow(month, 2, 0.5, full);
  assert.equal(z.start, '2026-11-09');
  assert.equal(z.end, '2026-11-24');
  // The anchored day stays under the finger: zooming at the left edge keeps the start.
  assert.equal(zoomWindow(month, 2, 0, full).start, '2026-11-01');
  // Zooming far out lands on the whole range.
  assert.deepEqual(zoomWindow(month, 0.01, 0.5, full), full);
});

test('panWindow shifts by days and stops at the edges', () => {
  const w = { start: '2026-11-01', end: '2026-11-15' };
  assert.deepEqual(panWindow(w, 7, full), { start: '2026-11-08', end: '2026-11-22' });
  assert.deepEqual(panWindow(w, -60, full), { start: '2026-10-01', end: '2026-10-15' });
});

test('lastDaysWindow ends today when today is inside the range', () => {
  assert.deepEqual(lastDaysWindow(7, '2026-10-27', full), { start: '2026-10-21', end: '2026-10-27' });
  // Before the range starts, it is the range's first week.
  assert.deepEqual(lastDaysWindow(7, '2026-09-01', full), { start: '2026-10-01', end: '2026-10-07' });
});

test('xTicks get denser as the window narrows', () => {
  const week = xTicks({ start: '2026-10-19', end: '2026-10-25' });
  assert.equal(week.length, 7);
  assert.equal(week[0]!.label, '19');
  assert.equal(week[0]!.major, true); // a Monday
  const sixWeeks = xTicks({ start: '2026-10-01', end: '2026-11-12' });
  assert.ok(sixWeeks.length >= 8 && sixWeeks.length <= 24);
  const quarter = xTicks({ start: '2026-10-01', end: '2026-12-31' });
  assert.ok(quarter.every((t) => /\w{3} \d/.test(t.label)));
  const season = xTicks(full);
  assert.deepEqual(
    season.map((t) => t.label),
    ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
  );
});
