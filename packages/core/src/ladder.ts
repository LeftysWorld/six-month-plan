import { addDays, daysBetween, isoWeekday, type ISODate } from './dates.ts';

/**
 * The plan ladder: a goal planned top down, from the finish back to this week.
 *   6 months (the goal) → 3 months → this month → this week → this week's tasks
 * Each level holds up to three targets, and each target answers to one above it.
 * This file is the arithmetic: how far along a running total should be by a date (the pace curve),
 * what a week needs, and whether the week's tasks fit the hours you have on each day.
 */

/** How the work is spread over a goal's run: evenly, building up, or heaviest at the start. */
export type PaceCurve = 'even' | 'ramp' | 'front';

export const PACE_CURVES: { id: PaceCurve; label: string; hint: string }[] = [
  { id: 'even', label: 'Even', hint: 'The same amount every week.' },
  { id: 'ramp', label: 'Ramp up', hint: 'Lighter at the start, building as you find your feet.' },
  { id: 'front', label: 'Front-load', hint: 'Heaviest at the start, while you have the room.' },
];

/** Most targets a level holds. More than three is a wish list. */
export const MAX_TARGETS = 3;

/**
 * Share of the whole done by `date` (0–1) on a curve from `start` to `end`.
 * Even is a straight line. Ramp spreads the work with a weight rising from 0.5 to 1.5 over the run
 * (about a third of the pace at the start that it has at the end); front-load is the mirror.
 */
export function curveShare(curve: PaceCurve, start: ISODate, end: ISODate, date: ISODate): number {
  const span = Math.max(1, daysBetween(start, end) + 1);
  const t = Math.min(1, Math.max(0, (daysBetween(start, date) + 1) / span));
  if (curve === 'ramp') return 0.5 * t + 0.5 * t * t;
  if (curve === 'front') return 1.5 * t - 0.5 * t * t;
  return t;
}

/** Where a running total should be by `date` on a curve, rounded to a whole number. */
export function totalBy(total: number, curve: PaceCurve, start: ISODate, end: ISODate, date: ISODate): number {
  return Math.round(total * curveShare(curve, start, end, date));
}

/** A number goal (lb, minutes, km) along the same curve, rounded to one decimal. */
export function valueBy(from: number, to: number, curve: PaceCurve, start: ISODate, end: ISODate, date: ISODate): number {
  return Math.round((from + (to - from) * curveShare(curve, start, end, date)) * 10) / 10;
}

/** The amount for each calendar month of a run (the bars under the pace choice). */
export function monthlyAmounts(total: number, curve: PaceCurve, start: ISODate, end: ISODate): { month: string; from: ISODate; to: ISODate; amount: number; cumulative: number }[] {
  const out: { month: string; from: ISODate; to: ISODate; amount: number; cumulative: number }[] = [];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let from = start;
  let before = 0;
  while (from <= end) {
    const y = Number(from.slice(0, 4));
    const m = Number(from.slice(5, 7));
    const nextFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` as ISODate;
    const to = addDays(nextFirst, -1) < end ? addDays(nextFirst, -1) : end;
    const cumulative = totalBy(total, curve, start, end, to);
    out.push({ month: names[m - 1]!, from, to, amount: cumulative - before, cumulative });
    before = cumulative;
    from = addDays(to, 1);
  }
  return out;
}

/**
 * What a week needs so a period lands: what's left to the period's target, spread over the weeks
 * left in it (this one included), rounded up. Never below zero.
 */
export function weekNeeds(periodTarget: number, totalNow: number, weekStartDate: ISODate, periodEnd: ISODate): number {
  const left = Math.max(0, periodTarget - totalNow);
  const weeks = Math.max(1, Math.ceil((daysBetween(weekStartDate, periodEnd) + 1) / 7));
  return Math.ceil(left / weeks);
}

// ---------- The week: does it fit? ----------

/** One task placed in the week, for the fit check. `key` is anything that names it (a draft, a session). */
export interface PlacedTask {
  key: string;
  /** Same task on another day shares this (a task happens at most once a day). */
  taskKey: string;
  date: ISODate;
  minutes: number;
  /** Only tasks you're planning now can be moved by a suggested fix. */
  movable: boolean;
}

export interface DayLoad {
  date: ISODate;
  /** Minutes you said you have that weekday (Settings). */
  available: number;
  planned: number;
  over: number;
}

/** Planned minutes against your hours, day by day, Monday first. `available` is Monday-first, 7 numbers. */
export function weekLoad(monday: ISODate, tasks: PlacedTask[], available: number[]): DayLoad[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const planned = tasks.filter((t) => t.date === date).reduce((sum, t) => sum + t.minutes, 0);
    const cap = available[i] ?? 0;
    return { date, available: cap, planned, over: Math.max(0, planned - cap) };
  });
}

export interface LoadFix {
  key: string;
  from: ISODate;
  to: ISODate;
  minutes: number;
  /** How far over the day was. */
  over: number;
}

/**
 * One move that takes the first overloaded day back under: a movable task on that day goes to the
 * day with the most room that it fits on and that doesn't already have the same task. Prefers the
 * smallest task that clears the overload; otherwise the biggest that fits somewhere. Days before
 * `from` (already gone) are never offered. Null when nothing can help.
 */
export function suggestLoadFix(monday: ISODate, tasks: PlacedTask[], available: number[], from: ISODate = monday, skip: ISODate[] = []): LoadFix | null {
  const days = weekLoad(monday, tasks, available);
  for (const day of days) {
    if (day.over <= 0 || day.date < from || skip.includes(day.date)) continue;
    const candidates = tasks.filter((t) => t.date === day.date && t.movable);
    const options: LoadFix[] = [];
    for (const t of candidates) {
      for (const other of days) {
        if (other.date === day.date || other.date < from) continue;
        if (tasks.some((x) => x.taskKey === t.taskKey && x.date === other.date)) continue;
        if (other.planned + t.minutes > other.available) continue;
        options.push({ key: t.key, from: day.date, to: other.date, minutes: t.minutes, over: day.over });
      }
    }
    if (!options.length) continue;
    const room = (d: ISODate) => {
      const x = days.find((y) => y.date === d)!;
      return x.available - x.planned;
    };
    const clears = options.filter((o) => o.minutes >= day.over).sort((a, b) => a.minutes - b.minutes || room(b.to) - room(a.to) || (a.to < b.to ? -1 : 1));
    if (clears.length) return clears[0]!;
    return options.sort((a, b) => b.minutes - a.minutes || room(b.to) - room(a.to) || (a.to < b.to ? -1 : 1))[0]!;
  }
  return null;
}

/** The week to plan from a date: this week until Wednesday, then next week (Thursday on, you're planning ahead). */
export function weekToPlan(today: ISODate): ISODate {
  const wd = isoWeekday(today);
  const monday = addDays(today, 1 - wd);
  return wd <= 3 ? monday : addDays(monday, 7);
}
