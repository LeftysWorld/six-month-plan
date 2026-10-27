import { addDays, daysBetween, type ISODate } from './dates.ts';
import type { Goal, Measurement } from './types.ts';

/**
 * Pace in plain words: at the rate of the last few weeks, when does a number goal get there?
 * The rate is the straight line through the readings of the last `windowDays` (first-to-last when
 * there are only two), so one salty day doesn't swing it.
 */
export interface Projection {
  /** Change per week at the recent rate, in the goal's units (negative when going down). */
  ratePerWeek: number | null;
  /** Day the target is reached at that rate; null if the rate points the wrong way or is ~0. */
  eta: ISODate | null;
  /** Days the eta lands after the target date (negative = early); null without both. */
  daysOff: number | null;
  /** Readings used. */
  points: number;
}

export function projectNumberGoal(goal: Pick<Goal, 'target_value' | 'target_date'>, readings: Measurement[], today: ISODate, windowDays = 28): Projection {
  const none: Projection = { ratePerWeek: null, eta: null, daysOff: null, points: 0 };
  if (goal.target_value == null) return none;
  const from = addDays(today, -windowDays);
  const pts = readings
    .filter((r) => r.measured_on <= today && r.measured_on >= from)
    .map((r) => ({ x: daysBetween(from, r.measured_on), y: Number(r.value) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2 || pts[pts.length - 1]!.x === pts[0]!.x) return { ...none, points: pts.length };
  // Least squares slope per day.
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const slope = sxx ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0;
  const ratePerWeek = Math.round(slope * 7 * 100) / 100;
  const latest = pts[pts.length - 1]!.y;
  const remaining = goal.target_value - latest;
  if (Math.abs(slope) < 1e-6 || Math.sign(remaining) !== Math.sign(slope) || Math.abs(remaining) < 1e-9) {
    return { ratePerWeek, eta: Math.abs(remaining) < 1e-9 ? today : null, daysOff: null, points: n };
  }
  const days = Math.ceil(remaining / slope);
  const eta = addDays(today, Math.min(days, 3650));
  const daysOff = goal.target_date ? daysBetween(goal.target_date, eta) : null;
  return { ratePerWeek, eta, daysOff, points: n };
}
