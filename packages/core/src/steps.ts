import { addDays, daysBetween, type ISODate } from './dates.ts';
import type { Milestone } from './types.ts';

/**
 * Small helpers for finish goals: a forecast from the pace milestones get done, and splitting a
 * goal into evenly spaced steps.
 */

/** Fewer days than this since the start and the forecast stays quiet (one good day isn't a pace). */
export const FORECAST_MIN_DAYS = 7;
/** The forecast follows the last 4 weeks when there's enough in them. */
export const FORECAST_WINDOW_DAYS = 28;
/** Further out than this isn't a date, it's "not at this pace". */
export const FORECAST_MAX_DAYS = 730;

export interface Forecast {
  /** When it will likely be done at the current pace (the last finish when everything's done). */
  date: ISODate | null;
  reason: 'done' | 'pace' | 'too_early' | 'none_done' | 'no_milestones' | 'too_slow';
}

/**
 * When a finish goal will likely be done, from the pace its milestones are being completed: the
 * last 4 weeks when two or more were done in them (how it's going now), else since the start.
 */
export function forecastFinish(milestones: Milestone[], start: ISODate, today: ISODate): Forecast {
  if (!milestones.length) return { date: null, reason: 'no_milestones' };
  const done = milestones.map((m) => m.completed_at?.slice(0, 10)).filter((d): d is ISODate => !!d && d <= today).sort();
  const left = milestones.filter((m) => !m.completed_at).length;
  if (left === 0) return { date: done.at(-1) ?? today, reason: 'done' };
  const elapsed = daysBetween(start, today);
  if (elapsed < FORECAST_MIN_DAYS) return { date: null, reason: 'too_early' };
  const window = Math.min(FORECAST_WINDOW_DAYS, elapsed);
  const recent = done.filter((d) => d > addDays(today, -window));
  const since = done.filter((d) => d >= start);
  const use = recent.length >= 2 ? { n: recent.length, days: window } : { n: since.length, days: elapsed };
  if (use.n === 0) return { date: null, reason: 'none_done' };
  const days = Math.ceil(left / (use.n / use.days));
  if (days > FORECAST_MAX_DAYS) return { date: null, reason: 'too_slow' };
  return { date: addDays(today, days), reason: 'pace' };
}

/** N steps spread evenly from start to end: "Module 1" … "Module 7", the last one due on the end date. */
export function evenSteps(name: string, n: number, start: ISODate, end: ISODate): { title: string; due_date: ISODate }[] {
  const count = Math.max(1, Math.min(60, Math.round(n)));
  const span = Math.max(count, daysBetween(start, end));
  const base = name.trim() || 'Step';
  return Array.from({ length: count }, (_, i) => ({ title: `${base} ${i + 1}`, due_date: addDays(start, Math.round(((i + 1) * span) / count)) }));
}
