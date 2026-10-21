import { addDays, daysBetween, isoWeekday, shortDate, type ISODate } from './dates.ts';
import type { GoalTarget, Plan, StepLevel } from './types.ts';

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

/** 1-based week number within a plan (week 1 starts on the plan's start date). */
export function planWeekNumber(plan: Plan, date: ISODate): number {
  return Math.floor(daysBetween(plan.start_date, date) / 7) + 1;
}

export function planTotalWeeks(plan: Plan): number {
  return Math.max(1, Math.round((daysBetween(plan.start_date, plan.end_date) + 1) / 7));
}

export function planDayNumber(plan: Plan, date: ISODate): number {
  return daysBetween(plan.start_date, date) + 1;
}

export function planTotalDays(plan: Plan): number {
  return daysBetween(plan.start_date, plan.end_date) + 1;
}

/** 0-based index of the block containing `date`, clamped to the plan. */
export function blockIndex(plan: Plan, date: ISODate): number {
  const total = blockCount(plan);
  const i = Math.floor(daysBetween(plan.start_date, date) / plan.block_days);
  return Math.min(Math.max(i, 0), total - 1);
}

export function blockCount(plan: Plan): number {
  return Math.max(1, Math.ceil(planTotalDays(plan) / plan.block_days));
}

export function blockRange(plan: Plan, index: number): DateRange {
  const start = addDays(plan.start_date, index * plan.block_days);
  const naturalEnd = addDays(start, plan.block_days - 1);
  return { start, end: naturalEnd > plan.end_date ? plan.end_date : naturalEnd };
}

/** The 3-month checkpoint: the first 13 weeks, then the remainder. */
export function quarterRange(plan: Plan, date: ISODate): DateRange {
  const firstEnd = addDays(plan.start_date, 13 * 7 - 1);
  if (date <= firstEnd || firstEnd >= plan.end_date) {
    return { start: plan.start_date, end: firstEnd > plan.end_date ? plan.end_date : firstEnd };
  }
  return { start: addDays(firstEnd, 1), end: plan.end_date };
}

export function isActivePlan(plan: Plan, date: ISODate): boolean {
  return !plan.archived_at && plan.start_date <= date && plan.end_date >= date;
}

export interface PathPoint {
  date: ISODate;
  value: number;
}

/**
 * Suggested path for a "reach a number" goal: a straight line from the starting
 * value to the target, with a point at the end of every block. Values are rounded
 * to one decimal. The person can edit any point afterwards.
 */
export function suggestPath(
  startValue: number,
  targetValue: number,
  startDate: ISODate,
  targetDate: ISODate,
  blockDays: number,
): PathPoint[] {
  const totalDays = Math.max(1, daysBetween(startDate, targetDate));
  const points: PathPoint[] = [];
  for (let day = blockDays; day < totalDays; day += blockDays) {
    const value = startValue + ((targetValue - startValue) * day) / totalDays;
    points.push({ date: addDays(startDate, day), value: Math.round(value * 10) / 10 });
  }
  points.push({ date: targetDate, value: targetValue });
  return points;
}

/** Targets currently in force for a goal, sorted by date. */
export function currentTargets(targets: GoalTarget[], goalId: string): GoalTarget[] {
  return targets
    .filter((t) => t.goal_id === goalId && !t.superseded_at)
    .sort((a, b) => (a.target_date < b.target_date ? -1 : 1));
}

/**
 * Where the path says the value should be on `date`, interpolating between the
 * starting point and the path points. Before the start it returns the start value;
 * after the last point it returns the last value.
 */
export function valueOnPath(start: PathPoint, points: PathPoint[], date: ISODate): number {
  const all = [start, ...points.filter((p) => p.date > start.date)].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
  if (date <= start.date || all.length === 1) return start.value;
  for (let i = 1; i < all.length; i++) {
    const prev = all[i - 1]!;
    const next = all[i]!;
    if (date <= next.date) {
      const span = daysBetween(prev.date, next.date) || 1;
      const t = daysBetween(prev.date, date) / span;
      return prev.value + (next.value - prev.value) * t;
    }
  }
  return all[all.length - 1]!.value;
}

/** Weekly change the path asks for around `date` (negative = losing). */
export function weeklyRateOnPath(start: PathPoint, points: PathPoint[], date: ISODate): number {
  return valueOnPath(start, points, addDays(date, 7)) - valueOnPath(start, points, date);
}

// ---------- Breakdown: 6 months → 3 months → months → weeks ----------

export interface CascadeNode extends DateRange {
  level: StepLevel;
  idx: number;
  title: string;
  children: CascadeNode[];
}

/** The Sunday on or before a date. */
function sundayOnOrBefore(date: ISODate): ISODate {
  return addDays(date, -(isoWeekday(date) % 7));
}

/** Split a range into Monday–Sunday weeks (the first and last may be partial). */
export function weekRanges(range: DateRange): DateRange[] {
  const out: DateRange[] = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    const sunday = addDays(cursor, 7 - isoWeekday(cursor));
    const end = sunday < range.end ? sunday : range.end;
    out.push({ start: cursor, end });
    cursor = addDays(end, 1);
  }
  return out;
}

/** Split a 3-month stage into 3 months whose boundaries fall on Sundays, so weeks never straddle two months. */
export function monthRanges(range: DateRange, parts = 3): DateRange[] {
  const length = daysBetween(range.start, range.end) + 1;
  const out: DateRange[] = [];
  let start = range.start;
  for (let k = 1; k <= parts; k++) {
    let end: ISODate;
    if (k === parts) {
      end = range.end;
    } else {
      const ideal = addDays(range.start, Math.round((length * k) / parts) - 1);
      const snapped = sundayOnOrBefore(ideal);
      end = daysBetween(start, snapped) >= 6 ? snapped : ideal;
    }
    if (start > range.end) break;
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}

/**
 * The full breakdown of a plan: two 3-month stages (13 weeks, then the rest),
 * three months in each, and the weeks of every month.
 */
export function cascadeRanges(plan: Plan): CascadeNode[] {
  const firstEnd = addDays(plan.start_date, 13 * 7 - 1);
  const quarters: DateRange[] =
    firstEnd >= plan.end_date
      ? [{ start: plan.start_date, end: plan.end_date }]
      : [
          { start: plan.start_date, end: firstEnd },
          { start: addDays(firstEnd, 1), end: plan.end_date },
        ];
  let monthNo = 0;
  let weekNo = 0;
  return quarters.map((q, qi) => ({
    ...q,
    level: 'quarter' as const,
    idx: qi,
    title: qi === 0 ? 'First 3 months' : 'Last 3 months',
    children: monthRanges(q).map((m, mi) => {
      monthNo += 1;
      return {
        ...m,
        level: 'month' as const,
        idx: mi,
        title: `Month ${monthNo}`,
        children: weekRanges(m).map((w, wi) => {
          weekNo += 1;
          return { ...w, level: 'week' as const, idx: wi, title: `Week ${weekNo}`, children: [] };
        }),
      };
    }),
  }));
}

/** "Oct 2 – Oct 29" */
export function rangeLabel(range: DateRange): string {
  return range.start === range.end ? shortDate(range.start) : `${shortDate(range.start)} – ${shortDate(range.end)}`;
}

export interface ChainPeriods {
  quarter: CascadeNode;
  month: CascadeNode;
  week: CascadeNode;
}

/**
 * The 3-month stage, month and week a date falls in (clamped to the plan).
 * Each goal keeps one goal per level for the current period only.
 */
export function chainAt(plan: Plan, date: ISODate): ChainPeriods {
  const d = date < plan.start_date ? plan.start_date : date > plan.end_date ? plan.end_date : date;
  const inside = (n: DateRange) => n.start <= d && n.end >= d;
  const quarters = cascadeRanges(plan);
  const quarter = quarters.find(inside) ?? quarters[quarters.length - 1]!;
  const month = quarter.children.find(inside) ?? quarter.children[quarter.children.length - 1]!;
  const week = month.children.find(inside) ?? month.children[month.children.length - 1]!;
  return { quarter, month, week };
}

/** The months of a plan, in order (used where the app talks about "this month"). */
export function planMonths(plan: Plan): CascadeNode[] {
  return cascadeRanges(plan).flatMap((q) => q.children);
}
