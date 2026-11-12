// Google Calendar (or any calendar with a private iCal address), read one way into the app.
// The server (/api/calendar/sync, apps/web/api-src/calendar.ts) reads each calendar's address and
// keeps calendar_events in step: added, changed and removed events follow. The app never writes to
// the calendar. This file picks a day's events and decides when to sync; useGoogleCalendar.ts asks the server.

import type { CalendarEvent, CalendarFeed } from '@six/core';
import type { AppData } from './model.ts';

/** Don't ask the server again within this long of the last sync (the daily cron is the backstop). */
export const SYNC_EVERY_MS = 10 * 60 * 1000;

export const FEED_COLORS = ['#4285f4', '#0b8043', '#8e24aa', '#f4511e', '#e67c73', '#039be5'];

/** The most recent sync across the calendars, or null when one has never synced. */
export function lastSynced(feeds: CalendarFeed[]): number | null {
  if (!feeds.length) return null;
  let oldest = Infinity;
  for (const f of feeds) {
    if (!f.last_synced_at) return null;
    oldest = Math.min(oldest, Date.parse(f.last_synced_at));
  }
  return oldest;
}

/** True when the app should ask the server to sync now. */
export function syncDue(feeds: CalendarFeed[], nowMs: number): boolean {
  if (!feeds.length) return false;
  const last = lastSynced(feeds);
  return last == null || nowMs - last > SYNC_EVERY_MS;
}

export interface DayEvent {
  event: CalendarEvent;
  feed: CalendarFeed | null;
  /** Minutes from midnight in the person's time zone (0 for all-day or events that began earlier). */
  start: number;
  end: number;
  /** "9:00–10:30", "All day", "until 11:00". */
  time: string;
}

function zonedParts(ms: number, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** The calendar events on a day, all-day first, then by start time. */
export function eventsOn(data: AppData, day: string, timeZone: string): DayEvent[] {
  const feeds = new Map((data.calendarFeeds ?? []).map((f) => [f.id, f]));
  const out: DayEvent[] = [];
  for (const e of data.calendarEvents ?? []) {
    const feed = feeds.get(e.feed_id) ?? null;
    if (e.all_day) {
      if (e.start_date && e.end_date && e.start_date <= day && day < e.end_date) out.push({ event: e, feed, start: 0, end: 0, time: 'All day' });
      continue;
    }
    if (!e.starts_at || !e.ends_at) continue;
    const s = zonedParts(Date.parse(e.starts_at), timeZone);
    const en = zonedParts(Date.parse(e.ends_at), timeZone);
    if (s.date > day || en.date < day || (en.date === day && en.minutes === 0 && s.date < day)) continue;
    const start = s.date === day ? s.minutes : 0;
    const end = en.date === day ? en.minutes : 24 * 60;
    const time = s.date < day && en.date > day ? 'All day' : s.date < day ? `until ${clock(end)}` : en.date > day ? `from ${clock(start)}` : start === end ? clock(start) : `${clock(start)}–${clock(end)}`;
    out.push({ event: e, feed, start, end, time });
  }
  const allDay = (d: DayEvent) => (d.time === 'All day' ? 0 : 1);
  return out.sort((a, b) => allDay(a) - allDay(b) || a.start - b.start || a.end - b.end || a.event.title.localeCompare(b.event.title));
}
