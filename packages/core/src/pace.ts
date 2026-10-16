import { addDays, daysBetween, type ISODate } from './dates.ts';
import { valueOnPath, type DateRange, type PathPoint } from './plan.ts';
import { countsAsPlanned, sessionCredit } from './schedule.ts';
import type { Goal, Measurement, Milestone, PaceLabel, Session } from './types.ts';

/** Actual ÷ expected → label. 110%+ ahead, 90–110% on track, under 90% behind. */
export function paceLabel(actual: number, expected: number): PaceLabel {
  if (!(expected > 0.0001)) return 'none';
  const ratio = actual / expected;
  if (ratio >= 1.1) return 'ahead';
  if (ratio >= 0.9) return 'on_track';
  return 'behind';
}

export const PACE_TEXT: Record<PaceLabel, string> = {
  ahead: 'Ahead',
  on_track: 'On track',
  behind: 'Behind',
  none: 'Too early',
};

export interface Progress {
  /** Everything planned in the period. */
  planned: number;
  /** What should be done by now. */
  expected: number;
  /** What has been done (with partial credit). */
  actual: number;
  label: PaceLabel;
}

export interface ProgressOptions {
  today: ISODate;
  /** Share of today's waking hours already gone, 0..1. */
  dayFraction: number;
  /** Suppress labels (e.g. during a plan's first week). */
  tooEarly?: boolean;
}

function inPeriod(s: Session, range: DateRange): boolean {
  if (s.date) return s.date >= range.start && s.date <= range.end;
  // Not placed on a day yet: only counts toward periods of a week or longer.
  if (daysBetween(range.start, range.end) < 6) return false;
  return s.week_start >= addDays(range.start, -6) && s.week_start <= range.end;
}

/** How much of a session is "due" by now. */
function dueShare(s: Session, opts: ProgressOptions): number {
  if (s.date) {
    if (s.date < opts.today) return 1;
    if (s.date === opts.today) return opts.dayFraction;
    return 0;
  }
  // Not placed yet: due evenly across its week.
  const elapsed = daysBetween(s.week_start, opts.today) + opts.dayFraction;
  return Math.max(0, Math.min(1, elapsed / 7));
}

/** Plan vs actual for a set of sessions and milestones over a period. */
export function progressFor(
  sessions: Session[],
  range: DateRange,
  opts: ProgressOptions,
  milestones: Milestone[] = [],
): Progress {
  let planned = 0;
  let expected = 0;
  let actual = 0;
  for (const s of sessions) {
    if (!countsAsPlanned(s) || !inPeriod(s, range)) continue;
    planned += 1;
    expected += dueShare(s, opts);
    actual += sessionCredit(s);
  }
  for (const m of milestones) {
    if (m.due_date < range.start || m.due_date > range.end) continue;
    planned += 1;
    if (m.due_date <= opts.today) expected += 1;
    if (m.completed_at) actual += 1;
  }
  expected = Math.round(expected * 10) / 10;
  actual = Math.round(actual * 10) / 10;
  return { planned, expected, actual, label: opts.tooEarly ? 'none' : paceLabel(actual, expected) };
}

/** Average of readings in the 7 days up to `today` (falls back to the latest reading). */
export function sevenDayTrend(readings: Measurement[], today: ISODate): number | null {
  const sorted = [...readings].filter((r) => r.measured_on <= today).sort(byDate);
  if (sorted.length === 0) return null;
  const from = addDays(today, -6);
  const recent = sorted.filter((r) => r.measured_on >= from);
  const use = recent.length > 0 ? recent : [sorted[sorted.length - 1]!];
  return Math.round((use.reduce((sum, r) => sum + Number(r.value), 0) / use.length) * 10) / 10;
}

export function latestReading(readings: Measurement[], today?: ISODate): Measurement | null {
  const sorted = [...readings].filter((r) => !today || r.measured_on <= today).sort(byDate);
  return sorted[sorted.length - 1] ?? null;
}

export interface NumberGoalStatus {
  start: PathPoint;
  latest: number | null;
  trend: number | null;
  pathToday: number;
  /** Positive = ahead of the path, in the goal's units, in the goal's direction. */
  aheadBy: number | null;
  changeSoFar: number | null;
  label: PaceLabel;
}

/** Where a "reach a number" goal stands against its path. */
export function numberGoalStatus(
  goal: Goal,
  path: PathPoint[],
  readings: Measurement[],
  today: ISODate,
  fallbackStart: ISODate,
  tooEarly = false,
): NumberGoalStatus {
  const sorted = [...readings].sort(byDate);
  const startValue = goal.baseline_value ?? sorted[0]?.value ?? goal.target_value ?? 0;
  const start: PathPoint = { date: goal.baseline_date ?? sorted[0]?.measured_on ?? fallbackStart, value: Number(startValue) };
  const latest = latestReading(sorted, today);
  const trend = sevenDayTrend(sorted, today);
  const pathToday = Math.round(valueOnPath(start, path, today) * 10) / 10;
  if (trend == null) {
    return { start, latest: null, trend: null, pathToday, aheadBy: null, changeSoFar: null, label: 'none' };
  }
  const direction = Math.sign((goal.target_value ?? start.value) - start.value) || -1;
  const expectedChange = pathToday - start.value;
  const actualChange = trend - start.value;
  const aheadBy = Math.round((trend - pathToday) * direction * 10) / 10;
  let label: PaceLabel = 'none';
  if (!tooEarly && Math.abs(expectedChange) >= 0.1) {
    label = paceLabel(actualChange * direction, expectedChange * direction);
  }
  return {
    start,
    latest: latest ? Number(latest.value) : null,
    trend,
    pathToday,
    aheadBy,
    changeSoFar: Math.round((Number(latest?.value ?? trend) - start.value) * 10) / 10,
    label,
  };
}

/** Finish-type goals: milestones due by today vs completed. */
export function milestoneProgress(milestones: Milestone[], today: ISODate, tooEarly = false): Progress {
  const planned = milestones.length;
  const expected = milestones.filter((m) => m.due_date <= today).length;
  const actual = milestones.filter((m) => m.completed_at).length;
  return { planned, expected, actual, label: tooEarly ? 'none' : paceLabel(actual, expected) };
}

/**
 * Combine goal labels into "goals on pace" (ahead and on track both count).
 * Two-thirds or more of judged goals on pace is on track; fewer is behind.
 */
export function goalsOnPace(labels: PaceLabel[], tooEarly = false): Progress {
  const judged = labels.filter((l) => l !== 'none');
  const onPace = judged.filter((l) => l !== 'behind').length;
  let label: PaceLabel = 'none';
  if (!tooEarly && judged.length > 0) label = onPace / judged.length >= 2 / 3 ? 'on_track' : 'behind';
  return { planned: labels.length, expected: judged.length, actual: onPace, label };
}

/** Days since the most recent activity date (null if never). */
export function daysSince(dates: (ISODate | null | undefined)[], today: ISODate): number | null {
  const valid = dates.filter((d): d is ISODate => !!d && d <= today).sort();
  const last = valid[valid.length - 1];
  return last ? daysBetween(last, today) : null;
}

function byDate(a: Measurement, b: Measurement): number {
  return a.measured_on < b.measured_on ? -1 : a.measured_on > b.measured_on ? 1 : 0;
}
