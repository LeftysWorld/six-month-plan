import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedUrl, syncCalendars, syncFeed, type CalendarFeedRow, type CalendarStore } from '../api-src/calendar_sync.ts';
import { eventsOn, syncDue } from '../src/data/googleCalendar.ts';
import { emptyData } from '../src/data/model.ts';
import type { CalendarEvent, CalendarFeed } from '@six/core';

const NOW = Date.parse('2026-11-12T15:00:00Z');
const FEED: CalendarFeedRow = { id: 'f1', user_id: 'u1', name: 'Google Calendar', url: 'webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics' };

const ics = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const vevent = (uid: string, title: string, start: string, end: string) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART;TZID=America/New_York:${start}`, `DTEND;TZID=America/New_York:${end}`, 'END:VEVENT'].join('\r\n');

/** An in-memory calendar_events table. */
function memStore(feeds: CalendarFeedRow[] = [FEED]) {
  const rows = new Map<string, Record<string, unknown> & { id: string; key: string }>();
  const marks: Record<string, unknown>[] = [];
  let n = 0;
  const store: CalendarStore = {
    async feeds(userId) {
      return feeds.filter((f) => !userId || f.user_id === userId);
    },
    async existing(feedId) {
      return [...rows.values()].filter((r) => r.feed_id === feedId).map((r) => ({ id: r.id, key: r.key }));
    },
    async upsert(list) {
      for (const r of list) {
        const k = `${r.feed_id}|${r.key}`;
        const old = rows.get(k);
        rows.set(k, { ...(old ?? { id: `e${++n}` }), ...r } as Record<string, unknown> & { id: string; key: string });
      }
    },
    async remove(ids) {
      for (const [k, r] of rows) if (ids.includes(r.id)) rows.delete(k);
    },
    async markFeed(id, patch) {
      marks.push({ id, ...patch });
    },
  };
  return { store, rows, marks };
}

const serve = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

test('feed addresses: webcal becomes https; http and junk are refused', () => {
  assert.equal(feedUrl(FEED.url), 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics');
  assert.equal(feedUrl('http://example.com/a.ics'), null);
  assert.equal(feedUrl('not a url'), null);
});

test('events added, changed and removed in the calendar follow into the app', async () => {
  const { store, rows, marks } = memStore();
  const v1 = ics(vevent('a', 'Dentist', '20261113T090000', '20261113T100000'), vevent('b', 'Call Mom', '20261114T180000', '20261114T183000'));
  const r1 = await syncFeed(store, FEED, NOW, serve(v1));
  assert.equal(r1.ok, true);
  assert.equal(r1.added, 2);
  assert.equal(rows.size, 2);
  const dentist = [...rows.values()].find((r) => r.title === 'Dentist')!;
  assert.equal(dentist.starts_at, '2026-11-13T14:00:00.000Z');

  // Dentist moves to 11, Call Mom is deleted, Haircut is new.
  const v2 = ics(vevent('a', 'Dentist (moved)', '20261113T110000', '20261113T120000'), vevent('c', 'Haircut', '20261115T100000', '20261115T110000'));
  const r2 = await syncFeed(store, FEED, NOW, serve(v2));
  assert.equal(r2.ok, true);
  const titles = [...rows.values()].map((r) => r.title).sort();
  assert.deepEqual(titles, ['Dentist (moved)', 'Haircut']);
  assert.equal(r2.removed, 2); // the old 9 am Dentist and Call Mom (a moved event is replaced)
  assert.equal(marks.at(-1)!.last_error, null);
});

test('a reset or wrong address is saved on the feed and nothing is deleted', async () => {
  const { store, rows, marks } = memStore();
  await syncFeed(store, FEED, NOW, serve(ics(vevent('a', 'Dentist', '20261113T090000', '20261113T100000'))));
  const r = await syncFeed(store, FEED, NOW, serve('Not found', 404));
  assert.equal(r.ok, false);
  assert.match(r.error!, /copy the secret address again/);
  assert.equal(rows.size, 1, 'a failed read keeps the events it had');
  assert.match(String(marks.at(-1)!.last_error), /404/);
  const html = await syncFeed(store, FEED, NOW, serve('<html>sign in</html>'));
  assert.match(html.error!, /isn't a calendar feed/);
});

test('syncCalendars reads only the signed-in person’s calendars', async () => {
  const other = { ...FEED, id: 'f2', user_id: 'u2' };
  const { store } = memStore([FEED, other]);
  const out = await syncCalendars(store, 'u1', NOW, serve(ics()));
  assert.deepEqual(out.map((f) => f.id), ['f1']);
  assert.equal((await syncCalendars(store, null, NOW, serve(ics()))).length, 2);
});

test('Today: all-day first, then timed events by start in your time zone', () => {
  const data = emptyData();
  const feed: CalendarFeed = { id: 'f1', name: 'Google Calendar', url: '', color: '#4285f4', last_synced_at: null, last_error: null };
  const ev = (id: string, title: string, extra: Partial<CalendarEvent>): CalendarEvent => ({ id, feed_id: 'f1', key: id, title, location: '', all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, ...extra });
  data.calendarFeeds = [feed];
  data.calendarEvents = [
    ev('1', 'Lunch', { starts_at: '2026-11-12T17:00:00Z', ends_at: '2026-11-12T18:00:00Z' }),
    ev('2', 'Trip', { all_day: true, start_date: '2026-11-11', end_date: '2026-11-14' }),
    ev('3', 'Standup', { starts_at: '2026-11-12T14:00:00Z', ends_at: '2026-11-12T14:15:00Z' }),
    ev('4', 'Late call', { starts_at: '2026-11-13T04:30:00Z', ends_at: '2026-11-13T05:00:00Z' }), // 11:30pm Eastern on the 12th
    ev('5', 'Tomorrow', { starts_at: '2026-11-13T15:00:00Z', ends_at: '2026-11-13T16:00:00Z' }),
    ev('6', 'Ended trip', { all_day: true, start_date: '2026-11-10', end_date: '2026-11-12' }),
  ];
  const day = eventsOn(data, '2026-11-12', 'America/New_York');
  assert.deepEqual(day.map((d) => d.event.title), ['Trip', 'Standup', 'Lunch', 'Late call']);
  assert.deepEqual(day.map((d) => d.time), ['All day', '9:00am–9:15am', '12:00pm–1:00pm', 'from 11:30pm']);
  assert.equal(day[1]!.start, 9 * 60);
});

test('the app syncs when opened only if the last sync is over ten minutes old', () => {
  const f = (last: string | null): CalendarFeed => ({ id: 'f', name: 'x', url: '', color: '', last_synced_at: last, last_error: null });
  assert.equal(syncDue([], NOW), false);
  assert.equal(syncDue([f(null)], NOW), true);
  assert.equal(syncDue([f(new Date(NOW - 5 * 60000).toISOString())], NOW), false);
  assert.equal(syncDue([f(new Date(NOW - 11 * 60000).toISOString())], NOW), true);
});

test('the bundled calendar server function is up to date with its source', async () => {
  const committed = readFileSync(new URL('../api/calendar/[route].js', import.meta.url), 'utf8');
  assert.match(committed, /CRON_SECRET/);
  let fresh: string | null = null;
  try {
    const { bundleAgentApi } = await import('../scripts/build-agent-api.mjs');
    fresh = await bundleAgentApi(false, 'calendar');
  } catch {
    // esbuild isn't installed here: the content check above still ran
  }
  if (fresh) assert.equal(committed, fresh, 'run: node apps/web/scripts/build-agent-api.mjs');
});
