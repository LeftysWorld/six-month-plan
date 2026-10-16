/**
 * Calendar dates are plain ISO strings ("2026-10-16"), never timestamps.
 * All arithmetic is done in UTC so a date never shifts with the device timezone.
 */
export type ISODate = string;

const DAY_MS = 86_400_000;

export function parseISO(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function formatISO(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return formatISO(parseISO(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b) - parseISO(a)) / DAY_MS);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: ISODate): number {
  const day = new Date(parseISO(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week containing `date`. */
export function weekStart(date: ISODate): ISODate {
  return addDays(date, 1 - isoWeekday(date));
}

/** The seven dates of the week starting on `monday`. */
export function weekDates(monday: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Today's date in a given IANA timezone (e.g. "America/New_York"). */
export function todayIn(timezone: string, now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return formatISO(now.getTime());
  }
}

/** Fraction of the waking day (6:00–22:00) that has passed in a timezone, 0..1. */
export function dayFractionIn(timezone: string, now: Date = new Date()): number {
  let hours = now.getHours() + now.getMinutes() / 60;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    hours = h + m / 60;
  } catch {
    // fall back to device time
  }
  return Math.min(1, Math.max(0, (hours - 6) / 16));
}

/** True when `date` falls within [from, to] inclusive; `to` may be open. */
export function inRange(date: ISODate, from: ISODate, to?: ISODate | null): boolean {
  return date >= from && (to == null || date <= to);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Oct 16" */
export function shortDate(date: ISODate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** "Fri" */
export function weekdayName(date: ISODate): string {
  return WEEKDAYS[isoWeekday(date) - 1] ?? '';
}

/** "Friday, October 16" */
export function longDate(date: ISODate): string {
  return new Date(parseISO(date)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function monthName(monthIndex: number): string {
  return MONTHS[monthIndex] ?? '';
}
