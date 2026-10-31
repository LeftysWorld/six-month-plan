import { useEffect, useState } from 'react';
import { getSupabase, schemaWarning } from './supabase.ts';

/**
 * What's actually running behind the app, for Settings: the services that send reminders, serve the
 * calendar feed and email your partner (asked of the app's own server, which can see them), and the
 * database. true: live · false: missing · null: couldn't tell (offline, demo, not signed in).
 */
export interface SystemStatus {
  loading: boolean;
  pushKey: boolean | null;
  reminders: boolean | null;
  calendar: boolean | null;
  digests: boolean | null;
  database: string | null;
}

let cached: Omit<SystemStatus, 'loading' | 'database'> | null = null;

export function useSystemStatus(signedIn: boolean): SystemStatus {
  const [state, setState] = useState<SystemStatus>(() => ({ loading: signedIn && !cached, pushKey: null, reminders: null, calendar: null, digests: null, ...(cached ?? {}), database: schemaWarning }));
  useEffect(() => {
    if (!signedIn || cached) return;
    let alive = true;
    void (async () => {
      try {
        const { data } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
        const token = data.session?.access_token;
        if (!token) throw new Error('not signed in');
        const res = await fetch('/api/workout-agent/status', { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) throw new Error(String(res.status));
        const b = (await res.json()) as { push_key: boolean; reminders: boolean | null; calendar: boolean | null; digests: boolean | null };
        cached = { pushKey: b.push_key, reminders: b.reminders, calendar: b.calendar, digests: b.digests };
        if (alive) setState({ loading: false, ...cached, database: schemaWarning });
      } catch {
        if (alive) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [signedIn]);
  return state;
}

/** Reminders can send only with the push key and the reminder service both live. */
export const remindersLive = (s: SystemStatus) => (s.pushKey === false || s.reminders === false ? false : s.pushKey && s.reminders ? true : null);

// ---------- Last export (a backup), kept per device ----------

const EXPORT_KEY = 'six.lastExport';
export function lastExport(): string | null {
  try {
    return localStorage.getItem(EXPORT_KEY);
  } catch {
    return null;
  }
}
export function markExported(day: string): void {
  try {
    localStorage.setItem(EXPORT_KEY, day);
  } catch {
    // storage blocked
  }
}
