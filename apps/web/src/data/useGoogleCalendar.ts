// Asking the server (/api/calendar/sync) to read your calendars, and keeping them fresh while the
// app is open. What's picked for a day lives in googleCalendar.ts.

import { useEffect } from 'react';
import { getSupabase } from './supabase.ts';
import { syncDue } from './googleCalendar.ts';
import type { AppData } from './model.ts';

export interface FeedResult {
  id: string;
  ok: boolean;
  events?: number;
  error?: string;
}

/** Ask the server to read every calendar of the signed-in person now. */
export async function syncCalendarsNow(): Promise<{ ok: boolean; feeds: FeedResult[]; message?: string }> {
  const sb = getSupabase();
  const { data: s } = (await sb?.auth.getSession()) ?? { data: { session: null } };
  const token = s.session?.access_token;
  if (!token) return { ok: false, feeds: [], message: "You're not signed in." };
  const res = await fetch('/api/calendar/sync', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; feeds?: FeedResult[]; message?: string; error?: string };
  if (!res.ok) return { ok: false, feeds: [], message: body.message ?? body.error ?? `The server answered ${res.status}.` };
  return { ok: !!body.ok, feeds: body.feeds ?? [] };
}

let inFlight: Promise<unknown> | null = null;

/**
 * Keeps the calendars fresh while the app is open: syncs when the app opens and whenever it comes
 * back into view, if the last sync is more than ten minutes old, then reloads the data.
 */
export function useCalendarSync(data: AppData, signedIn: boolean, reload: () => Promise<void>): void {
  const feeds = data.calendarFeeds ?? [];
  useEffect(() => {
    if (!signedIn || !feeds.length) return;
    const run = () => {
      if (inFlight || document.visibilityState !== 'visible' || !syncDue(feeds, Date.now())) return;
      inFlight = syncCalendarsNow()
        .then((r) => (r.feeds.length ? reload() : undefined))
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
        });
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [signedIn, feeds, reload]);
}

