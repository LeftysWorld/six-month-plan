import { addDays, daysBetween, monthName, parseISO, shortDate, type DateRange, type ISODate } from '@six/core';

/** The smallest window the chart zooms to: one week, so a day is a readable stretch of the width. */
export const MIN_WINDOW_DAYS = 6;

/** Clamp a wanted window inside the full range, keeping its length when it can (sliding it) and never shorter than a week. */
export function clampWindow(want: DateRange, full: DateRange): DateRange {
  const fullDays = daysBetween(full.start, full.end);
  let len = Math.min(Math.max(daysBetween(want.start, want.end), MIN_WINDOW_DAYS), fullDays);
  let start = want.start;
  if (start < full.start) start = full.start;
  if (addDays(start, len) > full.end) start = addDays(full.end, -len);
  if (start < full.start) {
    start = full.start;
    len = fullDays;
  }
  return { start, end: addDays(start, len) };
}

/** Shift a window by whole days inside the full range. */
export function panWindow(win: DateRange, days: number, full: DateRange): DateRange {
  return clampWindow({ start: addDays(win.start, days), end: addDays(win.end, days) }, full);
}

/**
 * Zoom a window by a factor (>1 zooms in) around a point given as a fraction (0 = left edge, 1 = right edge),
 * so the day under the finger or cursor stays put.
 */
export function zoomWindow(win: DateRange, factor: number, at: number, full: DateRange): DateRange {
  const days = daysBetween(win.start, win.end);
  const newDays = Math.round(Math.min(Math.max(days / factor, MIN_WINDOW_DAYS), daysBetween(full.start, full.end)));
  const anchor = daysBetween(full.start, win.start) + at * days;
  const start = addDays(full.start, Math.round(anchor - at * newDays));
  return clampWindow({ start, end: addDays(start, newDays) }, full);
}

/** The last `days` days of the range (today included), ending at `anchor` (today or the latest reading) when it is inside the range. */
export function lastDaysWindow(days: number, anchor: ISODate, full: DateRange): DateRange {
  const end = anchor > full.end ? full.end : anchor < full.start ? full.start : anchor;
  return clampWindow({ start: addDays(end, -(days - 1)), end }, full);
}

export interface Tick {
  date: ISODate;
  label: string;
  /** A stronger label (a month start, a Monday) when the ticks are dense. */
  major?: boolean;
}

/**
 * X-axis ticks for a window: every day up to two weeks, every few days up to about six weeks,
 * weekly up to about four months, otherwise month starts.
 */
export function xTicks(win: DateRange): Tick[] {
  const days = daysBetween(win.start, win.end);
  const out: Tick[] = [];
  if (days <= 14) {
    for (let i = 0; i <= days; i++) {
      const d = addDays(win.start, i);
      const dt = new Date(parseISO(d));
      const dayNum = dt.getUTCDate();
      out.push({ date: d, label: String(dayNum), major: dayNum === 1 || dt.getUTCDay() === 1 });
    }
    return out;
  }
  if (days <= 45) {
    const step = days <= 28 ? 2 : 4;
    for (let i = 0; i <= days; i += step) {
      const d = addDays(win.start, i);
      const dt = new Date(parseISO(d));
      out.push({ date: d, label: String(dt.getUTCDate()), major: dt.getUTCDate() <= step });
    }
    return out;
  }
  if (days <= 125) {
    // Weekly, on Mondays.
    let d = win.start;
    while (new Date(parseISO(d)).getUTCDay() !== 1) d = addDays(d, 1);
    for (; d <= win.end; d = addDays(d, 7)) out.push({ date: d, label: shortDate(d) });
    return out;
  }
  const first = new Date(parseISO(win.start));
  for (let i = 0; i < 14; i++) {
    const dt = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    const iso = dt.toISOString().slice(0, 10);
    if (iso < win.start) continue;
    if (iso > win.end) break;
    out.push({ date: iso, label: monthName(dt.getUTCMonth()) });
  }
  if (out.length < 2) out.splice(0, out.length, { date: win.start, label: shortDate(win.start) }, { date: win.end, label: shortDate(win.end) });
  return out;
}

/** "Oct 1 – Oct 27" or "Oct 1 – Nov 3 · 5 weeks". */
export function windowLabel(win: DateRange): string {
  const days = daysBetween(win.start, win.end);
  const span = days <= 14 ? `${days + 1} days` : days < 60 ? `${Math.round((days + 1) / 7)} weeks` : `${Math.round((days + 1) / 30.4)} months`;
  return `${shortDate(win.start)} – ${shortDate(win.end)} · ${span}`;
}
