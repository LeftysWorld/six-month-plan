import { addDays, type ISODate, type Session } from '@six/core';

/**
 * The check-in streak, built to survive real life:
 * - logging any one thing on a day counts as a check-in
 * - you start with 2 freezes; a missed day spends one instead of breaking the streak
 * - every 7 check-ins earns a freeze back (you can hold at most 2)
 * - with no freezes left, a missed day is still forgiven if you log 2 things the next day ("earn it back")
 * - today never breaks the streak while it's still today
 */
export interface Streak {
  days: number;
  freezes: number;
  checkedInToday: boolean;
  /** Yesterday was missed (covered by a freeze or earned back): "never miss twice". */
  missedYesterday: boolean;
  /** Logged on each of the last 14 days, oldest first. */
  last14: { date: ISODate; state: 'done' | 'frozen' | 'missed' | 'today' }[];
}

const MAX_FREEZES = 2;

function loggedByDay(sessions: Session[]): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  for (const s of sessions) {
    if (!s.date || s.status === 'planned' || s.status === 'moved' || s.status === 'skipped') continue;
    out.set(s.date, (out.get(s.date) ?? 0) + 1);
  }
  return out;
}

export function checkInStreak(sessions: Session[], today: ISODate): Streak {
  const logged = loggedByDay(sessions);
  const dates = [...logged.keys()].sort();
  const states = new Map<ISODate, 'done' | 'frozen' | 'missed' | 'today'>();
  let days = 0;
  let freezes = MAX_FREEZES;
  let sinceEarn = 0;
  if (dates.length) {
    for (let d = dates[0]!; d <= today; d = addDays(d, 1)) {
      const n = logged.get(d) ?? 0;
      if (n > 0) {
        days++;
        sinceEarn++;
        if (sinceEarn >= 7) {
          freezes = Math.min(MAX_FREEZES, freezes + 1);
          sinceEarn = 0;
        }
        states.set(d, 'done');
      } else if (d === today) {
        states.set(d, 'today');
      } else if (days > 0 && freezes > 0) {
        freezes--;
        states.set(d, 'frozen');
      } else if (days > 0 && (logged.get(addDays(d, 1)) ?? 0) >= 2) {
        states.set(d, 'frozen');
      } else {
        days = 0;
        sinceEarn = 0;
        freezes = MAX_FREEZES;
        states.set(d, 'missed');
      }
    }
  }
  const yesterday = addDays(today, -1);
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(today, i - 13);
    return { date, state: states.get(date) ?? (date === today ? 'today' : 'missed') } as Streak['last14'][number];
  });
  return {
    days,
    freezes,
    checkedInToday: (logged.get(today) ?? 0) > 0,
    missedYesterday: days > 0 && states.get(yesterday) === 'frozen',
    last14,
  };
}

// ---------- Morning plan and evening wrap-up (shown once a day; remembered per browser) ----------

export type Ritual = 'morning' | 'evening';

export function ritualDue(kind: Ritual, today: ISODate, hour: number = new Date().getHours()): boolean {
  if (kind === 'morning' && (hour < 4 || hour >= 12)) return false;
  if (kind === 'evening' && hour < 18) return false;
  try {
    return localStorage.getItem(`six.ritual.${kind}`) !== today;
  } catch {
    return true;
  }
}

export function dismissRitual(kind: Ritual, today: ISODate): void {
  try {
    localStorage.setItem(`six.ritual.${kind}`, today);
  } catch {
    // storage blocked: the card simply shows again next visit
  }
}
