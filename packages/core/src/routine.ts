/**
 * The daily routine shown on Today: your own day, built around one wake-up time. Every item sits a
 * set number of minutes after waking, so moving the wake-up (7:00 → 6:00) moves the whole day
 * with it and the gaps stay the same: breakfast 30 minutes after waking, lights out 16 hours in.
 * Saved on the profile (profiles.daily_routine), wake-up and items both. The app ships no items
 * of its own: a profile with none saved has no routine until its owner sets one up.
 */

export interface RoutineItem {
  /** Minutes after waking it starts. */
  at: number;
  /** How long it runs, for a block like "Lift, then stretch" (shown as 8:00–9:30 am). */
  minutes?: number;
  what: string;
  /** "{wake}" is replaced with the wake-up time ("8 hours of sleep, up at 7:00"). */
  note?: string;
  /** Only on lifting days, or only on rest days. Unset: every day. */
  on?: 'lift' | 'rest';
  /** The note on a rest day instead, when it says something different. */
  rest_note?: string;
}

export interface DailyRoutine {
  /** Minutes after midnight: 420 = 7:00 am. */
  wake: number;
  items: RoutineItem[];
}

/** The wake-up a routine starts from until you pick one: 7:00 am. */
export const DEFAULT_WAKE = 7 * 60;

/** What "Set up my day" starts you with: the two ends of the day, to change and add to. */
export const STARTER_ROUTINE: DailyRoutine = {
  wake: DEFAULT_WAKE,
  items: [
    { at: 0, what: 'Wake up' },
    { at: 960, what: 'Lights out', note: '8 hours of sleep, up at {wake}.' },
  ],
};

/** Wake-up choices: every 15 minutes from 4:00 to 9:00 am. */
export const WAKE_CHOICES: number[] = Array.from({ length: (9 * 60 - 4 * 60) / 15 + 1 }, (_, i) => 4 * 60 + i * 15);

/** The saved routine; none saved is an empty day at 7:00. A bad wake-up falls back to 7:00. */
export function dailyRoutine(raw: Partial<DailyRoutine> | null | undefined): DailyRoutine {
  const wake = typeof raw?.wake === 'number' && raw.wake >= 0 && raw.wake < 24 * 60 ? Math.round(raw.wake) : DEFAULT_WAKE;
  const items = Array.isArray(raw?.items) ? raw.items.filter((i) => i && typeof i.at === 'number' && typeof i.what === 'string') : [];
  return { wake, items: [...items].sort((a, b) => a.at - b.at) };
}

/**
 * Minutes after waking for a clock time (minutes after midnight). A time earlier than the wake-up
 * belongs to the end of the day: with a 7:00 wake-up, 12:30 am is 17½ hours in, not 6½ hours before.
 */
export function afterWaking(wake: number, clock: number): number {
  return (((Math.round(clock) - wake) % 1440) + 1440) % 1440;
}

/**
 * A routine as edited, ready to save: items with nothing written are dropped, text is trimmed, an
 * empty note or "which days" is left off, and the day is in time order.
 */
export function cleanRoutine(wake: number, items: RoutineItem[]): DailyRoutine {
  const tidy = (item: RoutineItem): RoutineItem => {
    const note = (item.note ?? '').trim();
    const rest = (item.rest_note ?? '').trim();
    return {
      at: Math.min(1439, Math.max(0, Math.round(item.at))),
      ...(item.minutes && item.minutes > 0 ? { minutes: Math.round(item.minutes) } : {}),
      what: item.what.trim(),
      ...(note ? { note } : {}),
      ...(item.on === 'lift' || item.on === 'rest' ? { on: item.on } : {}),
      ...(rest ? { rest_note: rest } : {}),
    };
  };
  return { wake: dailyRoutine({ wake }).wake, items: items.filter((i) => i.what.trim()).map(tidy).sort((a, b) => a.at - b.at) };
}

/** "07:30" (a time input's value) for minutes after midnight, and back; a bad value reads as null. */
export function clockValue(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function clockMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
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

/**
 * The day's items at clock times, from the wake-up. On a rest day (`lift` false) the lifting-only
 * items (pre-workout, the lift) drop out and rest-day notes are used; the rest of the day keeps its times.
 */
export function routineRows(r: DailyRoutine, lift = true): RoutineRow[] {
  return r.items.filter((item) => !item.on || item.on === (lift ? 'lift' : 'rest')).map((item) => {
    const start = r.wake + item.at;
    const end = start + (item.minutes ?? 0);
    const samePeriod = Math.floor((start % 1440) / 720) === Math.floor((end % 1440) / 720);
    const time = item.minutes ? `${timeOfDay(start, !samePeriod)}–${timeOfDay(end)}` : timeOfDay(start);
    const note = (!lift && item.rest_note ? item.rest_note : item.note) ?? '';
    return { item, start, end, time, note: note.replace('{wake}', timeOfDay(r.wake, false)) };
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
