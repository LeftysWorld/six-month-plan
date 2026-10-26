import { addDays, weekStart, type ISODate } from './dates.ts';
import { sessionCredit } from './schedule.ts';
import type { Session } from './types.ts';

/**
 * Habit stats from one habit's sessions: the current and best streak, how often it got done over
 * the last 30 days, and a day-by-day grid. A skipped day doesn't break a streak (you chose to skip
 * it); a day that passed with nothing logged does. Today never breaks a streak until it's over.
 * Times-a-week habits keep their streak in weeks: a week counts when every planned one got done.
 */

export type HabitDayState = 'done' | 'part' | 'skipped' | 'missed' | 'planned' | 'none';

export interface HabitStats {
  /** Current streak, in days (or weeks for a times-a-week habit). */
  streak: number;
  best: number;
  unit: 'day' | 'week';
  /** Share done over the last 30 days, 0..1 (null with nothing due yet). */
  rate: number | null;
  doneDays: number;
  dueDays: number;
}

const DONE = new Set(['done', 'partial', 'minimum']);

function stateOf(s: Session, today: ISODate): HabitDayState {
  if (s.status === 'done' || s.status === 'minimum') return 'done';
  if (s.status === 'partial') return 'part';
  if (s.status === 'skipped') return 'skipped';
  return s.date && s.date < today ? 'missed' : 'planned';
}

/** Each day's state from `from` to `to` (a day with no session is 'none'). */
export function habitDays(sessions: Session[], from: ISODate, to: ISODate, today: ISODate): { date: ISODate; state: HabitDayState }[] {
  const byDate = new Map<ISODate, Session>();
  for (const s of sessions) if (s.date && s.status !== 'moved') byDate.set(s.date, s);
  const out: { date: ISODate; state: HabitDayState }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = byDate.get(d);
    out.push({ date: d, state: s ? stateOf(s, today) : 'none' });
  }
  return out;
}

export function habitStats(sessions: Session[], today: ISODate): HabitStats {
  const live = sessions.filter((s) => s.status !== 'moved');
  const weekly = live.some((s) => !s.date && s.origin === 'scheduled');
  // Last 30 days, today included only once it's logged.
  const from = addDays(today, -29);
  let done = 0;
  let due = 0;
  for (const s of live) {
    const day = s.date ?? null;
    if (day ? day < from || day > today : s.week_start < weekStart(from) || s.week_start > today) continue;
    if (s.status === 'skipped') continue;
    const counts = s.status !== 'planned' || (day ? day < today : false);
    if (!counts) continue;
    due += 1;
    done += sessionCredit(s);
  }
  const rate = due ? Math.min(1, done / due) : null;

  if (weekly) {
    // Weeks, newest first: a week counts when everything planned in it got done; this week doesn't break it.
    const weeks = new Map<ISODate, { planned: number; done: number }>();
    for (const s of live) {
      if (s.status === 'skipped') continue;
      const w = s.date ? weekStart(s.date) : s.week_start;
      const e = weeks.get(w) ?? { planned: 0, done: 0 };
      e.planned += 1;
      if (DONE.has(s.status)) e.done += 1;
      weeks.set(w, e);
    }
    const order = [...weeks.keys()].sort().reverse();
    let streak = 0;
    let best = 0;
    let run = 0;
    let current = true;
    for (const w of order) {
      const e = weeks.get(w)!;
      const ok = e.done >= e.planned;
      if (w === weekStart(today) && !ok) continue;
      if (ok) {
        run += 1;
        if (current) streak = run;
      } else {
        current = false;
        run = 0;
      }
      best = Math.max(best, run);
    }
    return { streak, best, unit: 'week', rate, doneDays: Math.round(done * 10) / 10, dueDays: due };
  }

  // Days, newest first.
  const dated = live.filter((s) => s.date && s.date <= today).sort((a, b) => (a.date! < b.date! ? 1 : -1));
  let streak = 0;
  let best = 0;
  let run = 0;
  let current = true;
  for (const s of dated) {
    const st = stateOf(s, today);
    if (st === 'planned' || st === 'skipped') continue;
    if (st === 'done' || st === 'part') {
      run += 1;
      if (current) streak = run;
    } else {
      current = false;
      run = 0;
    }
    best = Math.max(best, run);
  }
  return { streak, best, unit: 'day', rate, doneDays: Math.round(done * 10) / 10, dueDays: due };
}
