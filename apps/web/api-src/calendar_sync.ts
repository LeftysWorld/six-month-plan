// Reading calendars into the app, one way: fetch each feed's private iCal address, expand its
// events (recurring ones into dates) and make calendar_events match. New events are added, changed
// ones updated, removed ones deleted. Nothing is ever written to the calendar itself.

import { expandIcs, type CalendarInstance } from '../../../packages/core/src/ics.ts';

export interface CalendarFeedRow {
  id: string;
  user_id: string;
  name: string;
  url: string;
}

/** The few database calls the sync needs (the server implements them with the service-role client). */
export interface CalendarStore {
  feeds(userId: string | null): Promise<CalendarFeedRow[]>;
  /** Events of a feed that start on or after `fromIso` (timed) or `fromDate` (all-day). */
  existing(feedId: string, fromIso: string, fromDate: string): Promise<{ id: string; key: string }[]>;
  upsert(rows: Record<string, unknown>[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  markFeed(id: string, patch: { last_synced_at?: string; last_error: string | null }): Promise<void>;
}

/** Days before today and after today the sync keeps in step with the calendar. */
export const WINDOW = { pastDays: 3, futureDays: 120 };
const MAX_BYTES = 8 * 1024 * 1024;

/** A pasted address as one the server can fetch: webcal:// becomes https://; only https is allowed. */
export function feedUrl(raw: string): string | null {
  const s = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface FeedResult {
  id: string;
  name: string;
  ok: boolean;
  events: number;
  added: number;
  removed: number;
  error?: string;
}

async function fetchFeed(url: string, fetchImpl: typeof fetch): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' }, redirect: 'follow' });
    if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error(`The calendar said no (${res.status}). The address may have been reset in Google Calendar: copy the secret address again.`);
    if (!res.ok) throw new Error(`The calendar didn't answer (${res.status}). It'll try again next time.`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('That calendar is too big to read.');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That address isn't a calendar feed. In Google Calendar use “Secret address in iCal format” (it ends in .ics).");
    return text;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error("The calendar took too long to answer. It'll try again next time.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const row = (feed: CalendarFeedRow, e: CalendarInstance, now: string) => ({
  user_id: feed.user_id,
  feed_id: feed.id,
  key: e.key,
  title: e.title.slice(0, 500),
  location: e.location.slice(0, 500),
  all_day: e.all_day,
  starts_at: e.starts_at,
  ends_at: e.ends_at,
  start_date: e.start_date,
  end_date: e.end_date,
  updated_at: now,
});

/** Bring one feed's events in step with the calendar. Failures are saved on the feed, not thrown. */
export async function syncFeed(store: CalendarStore, feed: CalendarFeedRow, nowMs: number, fetchImpl: typeof fetch = fetch): Promise<FeedResult> {
  const base = { id: feed.id, name: feed.name, events: 0, added: 0, removed: 0 };
  const now = new Date(nowMs).toISOString();
  try {
    const url = feedUrl(feed.url);
    if (!url) throw new Error('That address must start with https:// (or webcal://).');
    const text = await fetchFeed(url, fetchImpl);
    const fromMs = nowMs - WINDOW.pastDays * 86400000;
    const toMs = nowMs + WINDOW.futureDays * 86400000;
    const events = expandIcs(text, fromMs, toMs);
    const fromIso = new Date(fromMs).toISOString();
    const before = await store.existing(feed.id, fromIso, fromIso.slice(0, 10));
    const keep = new Set(events.map((e) => e.key));
    const gone = before.filter((b) => !keep.has(b.key)).map((b) => b.id);
    const had = new Set(before.map((b) => b.key));
    for (let i = 0; i < events.length; i += 500) await store.upsert(events.slice(i, i + 500).map((e) => row(feed, e, now)));
    for (let i = 0; i < gone.length; i += 200) await store.remove(gone.slice(i, i + 200));
    await store.markFeed(feed.id, { last_synced_at: now, last_error: null });
    return { ...base, ok: true, events: events.length, added: events.filter((e) => !had.has(e.key)).length, removed: gone.length };
  } catch (e) {
    const error = (e as Error).message || 'The calendar could not be read.';
    await store.markFeed(feed.id, { last_error: error }).catch(() => undefined);
    return { ...base, ok: false, error };
  }
}

/** Sync every feed of one person (userId) or of everyone (null, the daily run). */
export async function syncCalendars(store: CalendarStore, userId: string | null, nowMs: number, fetchImpl: typeof fetch = fetch): Promise<FeedResult[]> {
  const feeds = await store.feeds(userId);
  const out: FeedResult[] = [];
  for (const f of feeds) out.push(await syncFeed(store, f, nowMs, fetchImpl));
  return out;
}
