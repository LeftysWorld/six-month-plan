/**
 * The daily routine shown on Today: a fixed day built around one wake-up time. Every item sits a
 * set number of minutes after waking, so moving the wake-up (7:00 → 6:00) moves the whole day
 * with it and the gaps stay the same: pre-workout 30 minutes after waking, lights out 16 hours in.
 * Saved on the profile (profiles.daily_routine); unset means the routine below at 7:00.
 */

export interface RoutineItem {
  /** Minutes after waking it starts. */
  at: number;
  /** How long it runs, for a block like "Lift, then stretch" (shown as 8:00–9:30 am). */
  minutes?: number;
  what: string;
  /** "{wake}" is replaced with the wake-up time ("8 hours of sleep, up at 7:00"). */
  note?: string;
}

export interface DailyRoutine {
  /** Minutes after midnight: 420 = 7:00 am. */
  wake: number;
  items: RoutineItem[];
}

export const DEFAULT_ROUTINE: DailyRoutine = {
  wake: 7 * 60,
  items: [
    { at: 0, what: 'Wake up, glass of water' },
    { at: 30, what: 'GHOST Legend pre-workout', note: 'Take it 20–30 min before you lift.' },
    { at: 60, minutes: 90, what: 'Lift, then stretch' },
    { at: 165, what: 'Whey shake #1 + creatine (5\u00a0g)', note: 'Mix the creatine right into the shake. It works the same at any time of day. Taking it daily is what matters.' },
    { at: 360, what: 'Whey shake #2', note: 'This replaces lunch. No caffeine after this point.' },
    { at: 690, what: 'Dinner', note: 'Finish eating at least 3 hours before bed.' },
    { at: 900, what: 'Magnesium bisglycinate', note: 'It helps you relax and sleep.' },
    { at: 915, what: 'Deep Sleep Complex', note: 'Take it 30–45 min before bed.' },
    { at: 960, what: 'Lights out', note: '8 hours of sleep, up at {wake}.' },
  ],
};

/** Wake-up choices: every 15 minutes from 4:00 to 9:00 am. */
export const WAKE_CHOICES: number[] = Array.from({ length: (9 * 60 - 4 * 60) / 15 + 1 }, (_, i) => 4 * 60 + i * 15);

/** The saved routine, or the default; a bad wake-up falls back to 7:00. */
export function dailyRoutine(raw: Partial<DailyRoutine> | null | undefined): DailyRoutine {
  const wake = typeof raw?.wake === 'number' && raw.wake >= 0 && raw.wake < 24 * 60 ? Math.round(raw.wake) : DEFAULT_ROUTINE.wake;
  const items = Array.isArray(raw?.items) && raw.items.length ? raw.items.filter((i) => i && typeof i.at === 'number' && typeof i.what === 'string') : DEFAULT_ROUTINE.items;
  return { wake, items: [...items].sort((a, b) => a.at - b.at) };
}

/** "7:00 am", "1:00 pm", "12:30 am" from minutes after midnight (wrapping past midnight). */
export function timeOfDay(minutes: number, withPeriod = true): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')}${withPeriod ? (h < 12 ? ' am' : ' pm') : ''}`;
}

export interface RoutineRow {
  item: RoutineItem;
  /** Minutes after midnight it starts (may pass 1440 for something after midnight). */
  start: number;
  end: number;
  /** "7:00 am", "8:00–9:30 am", "11:30 am–1:00 pm". */
  time: string;
  note: string;
}

/** The day's items at clock times, from the wake-up. */
export function routineRows(r: DailyRoutine): RoutineRow[] {
  return r.items.map((item) => {
    const start = r.wake + item.at;
    const end = start + (item.minutes ?? 0);
    const samePeriod = Math.floor((start % 1440) / 720) === Math.floor((end % 1440) / 720);
    const time = item.minutes ? `${timeOfDay(start, !samePeriod)}–${timeOfDay(end)}` : timeOfDay(start);
    return { item, start, end, time, note: (item.note ?? '').replace('{wake}', timeOfDay(r.wake, false)) };
  });
}

/**
 * Where you are in the day at `now` (minutes after midnight): the item under way (a block you're
 * in, like the lift), else the next one coming. Before waking, nothing is past and the wake-up is
 * next; after the last item, everything is past.
 */
export function routineNow(rows: RoutineRow[], now: number): { current: number | null; next: number | null; past: (i: number) => boolean } {
  // Before the wake-up, read the time as the end of the night before (a late night counts as still yesterday).
  const t = rows.length && now < rows[0]!.start && now + 1440 <= rows.at(-1)!.start ? now + 1440 : now;
  const current = rows.findIndex((r) => r.end > r.start && t >= r.start && t < r.end);
  const next = rows.findIndex((r) => r.start > t);
  return {
    current: current >= 0 ? current : null,
    next: next >= 0 ? next : null,
    past: (i) => i !== current && rows[i]!.end <= t,
  };
}
