import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandIcs, zonedToUtc } from '../src/index.ts';

const feed = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:America/New_York', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const from = Date.UTC(2026, 10, 1);
const to = Date.UTC(2026, 11, 31);

test('time zones: wall time in New York to UTC, both sides of the DST change', () => {
  assert.equal(new Date(zonedToUtc({ y: 2026, m: 11, d: 12, h: 9, mi: 0, s: 0 }, 'America/New_York')).toISOString(), '2026-11-12T14:00:00.000Z');
  assert.equal(new Date(zonedToUtc({ y: 2026, m: 10, d: 30, h: 9, mi: 0, s: 0 }, 'America/New_York')).toISOString(), '2026-10-30T13:00:00.000Z');
});

test('a one-off timed event, an all-day event, escaped text, folded lines, and an alarm inside', () => {
  const out = expandIcs(
    feed(
      ev('UID:a1', 'DTSTART;TZID=America/New_York:20261112T090000', 'DTEND;TZID=America/New_York:20261112T100000', 'SUMMARY:Call with Sam\\, re: offer', 'LOCATION:Zoom', 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'SUMMARY:alarm', 'END:VALARM'),
      ev('UID:a2', 'DTSTART;VALUE=DATE:20261126', 'DTEND;VALUE=DATE:20261127', 'SUMMARY:Thanksgiv', ' ing'),
    ),
    from,
    to,
  );
  assert.equal(out.length, 2);
  assert.deepEqual([out[0]!.title, out[0]!.location, out[0]!.starts_at, out[0]!.ends_at], ['Call with Sam, re: offer', 'Zoom', '2026-11-12T14:00:00.000Z', '2026-11-12T15:00:00.000Z']);
  assert.deepEqual([out[1]!.title, out[1]!.all_day, out[1]!.start_date, out[1]!.end_date], ['Thanksgiving', true, '2026-11-26', '2026-11-27']);
});

test('weekly on Mon/Wed with a deleted date and one instance moved', () => {
  const out = expandIcs(
    feed(
      ev('UID:w1', 'DTSTART;TZID=America/New_York:20261102T180000', 'DTEND;TZID=America/New_York:20261102T190000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6', 'EXDATE;TZID=America/New_York:20261104T180000', 'SUMMARY:Class'),
      ev('UID:w1', 'RECURRENCE-ID;TZID=America/New_York:20261109T180000', 'DTSTART;TZID=America/New_York:20261110T200000', 'DTEND;TZID=America/New_York:20261110T210000', 'SUMMARY:Class (moved)'),
    ),
    from,
    to,
  );
  assert.deepEqual(
    out.map((e) => [e.starts_at, e.title]),
    [
      ['2026-11-02T23:00:00.000Z', 'Class'],
      ['2026-11-11T01:00:00.000Z', 'Class (moved)'],
      ['2026-11-11T23:00:00.000Z', 'Class'],
      ['2026-11-16T23:00:00.000Z', 'Class'],
      ['2026-11-18T23:00:00.000Z', 'Class'],
    ],
  );
  // The moved one keeps the key of the date it replaced.
  assert.match(out[1]!.key, /^w1\|2026-11-09T23:00:00/);
});

test('monthly on the second Tuesday, until a date; a cancelled instance and a cancelled event drop out', () => {
  const out = expandIcs(
    feed(
      ev('UID:m1', 'DTSTART;TZID=America/New_York:20261013T120000', 'DURATION:PT30M', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270201T000000Z', 'SUMMARY:Board'),
      ev('UID:m1', 'RECURRENCE-ID;TZID=America/New_York:20261208T120000', 'DTSTART;TZID=America/New_York:20261208T120000', 'STATUS:CANCELLED', 'SUMMARY:Board'),
      ev('UID:c1', 'DTSTART:20261115T150000Z', 'DTEND:20261115T160000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone'),
    ),
    from,
    to,
  );
  assert.deepEqual(out.map((e) => e.starts_at), ['2026-11-10T17:00:00.000Z']);
  assert.equal(out[0]!.ends_at, '2026-11-10T17:30:00.000Z');
});

test('daily with an interval, and a yearly birthday', () => {
  const out = expandIcs(
    feed(
      ev('UID:d1', 'DTSTART:20261128T120000Z', 'DTEND:20261128T121500Z', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3', 'SUMMARY:Meds'),
      ev('UID:y1', 'DTSTART;VALUE=DATE:19870305', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday'),
    ),
    from,
    Date.UTC(2027, 3, 1),
  );
  assert.deepEqual(out.filter((e) => e.uid === 'd1').map((e) => e.starts_at!.slice(0, 10)), ['2026-11-28', '2026-11-30', '2026-12-02']);
  assert.deepEqual(out.filter((e) => e.uid === 'y1').map((e) => e.start_date), ['2027-03-05']);
});
