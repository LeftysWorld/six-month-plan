import { addDays, isoWeekday, weekStart, type ISODate } from './dates.ts';
import { cascadeRanges, planMonths, type CascadeNode, type DateRange } from './plan.ts';
import { countsAsPlanned, sessionCredit } from './schedule.ts';
import type { Action, Plan, Review, ReviewKind, Session } from './types.ts';

/**
 * Review helpers: what a period actually looked like, patterns across weeks, and
 * which month, 3-month and plan reviews are due. Pure functions, no UI.
 */

/** Sessions that belong to a period (moved ones are replaced by their copy). */
export function sessionsInPeriod(sessions: Session[], range: DateRange): Session[] {
  return sessions.filter((s) => {
    if (!countsAsPlanned(s)) return false;
    if (s.date) return s.date >= range.start && s.date <= range.end;
    return s.week_start >= range.start && s.week_start <= range.end;
  });
}

/**
 * Minutes a session actually took: what was logged, else the planned minutes for done,
 * the minimum's minutes for "minimum kept", half for a partial without minutes, 0 otherwise.
 */
export function minutesDone(session: Session, action?: Pick<Action, 'min_minutes'> | null): number {
  if (session.status === 'planned' || session.status === 'skipped' || session.status === 'moved') return 0;
  if (session.actual_minutes != null) return session.actual_minutes;
  if (session.status === 'done') return session.planned_minutes;
  if (session.status === 'minimum') return action?.min_minutes ?? 0;
  return Math.round(session.planned_minutes / 2);
}

export interface PeriodTally {
  /** Sessions that were due (dated on or before the last finished day, or undated in a finished week). */
  planned: number;
  /** Credit earned (done and minimum 1, partial a share). */
  credit: number;
  /** Planned sessions still to come inside the period (e.g. Sunday's, on a Saturday review). */
  upcoming: number;
  minutesPlanned: number;
  minutesDone: number;
}

/**
 * Plan vs actual for a period, judged only on days that are over (or today, if it's already logged).
 * Days still to come are counted separately instead of as misses.
 */
export function periodTally(
  sessions: Session[],
  range: DateRange,
  today: ISODate,
  actionById: (id: string | null) => Pick<Action, 'min_minutes'> | null | undefined = () => null,
): PeriodTally {
  const out: PeriodTally = { planned: 0, credit: 0, upcoming: 0, minutesPlanned: 0, minutesDone: 0 };
  for (const s of sessionsInPeriod(sessions, range)) {
    const future = s.status === 'planned' && (s.date ? s.date >= today : addDays(s.week_start, 6) >= today);
    if (future) {
      out.upcoming += 1;
      continue;
    }
    if (s.origin !== 'unplanned') {
      out.planned += 1;
      out.minutesPlanned += s.planned_minutes;
    }
    out.credit += sessionCredit(s);
    out.minutesDone += minutesDone(s, actionById(s.action_id));
  }
  out.credit = Math.round(out.credit * 10) / 10;
  return out;
}

export interface WeekPoint {
  monday: ISODate;
  planned: number;
  credit: number;
  /** credit ÷ planned, or null for a week with nothing planned. */
  rate: number | null;
  minutesPlanned: number;
  minutesDone: number;
}

/**
 * One point per week, oldest first, ending with the week starting `lastMonday`.
 * Weeks before `from` (e.g. before the plan's first real week) come back empty (rate null).
 */
export function weeklyTrend(
  sessions: Session[],
  lastMonday: ISODate,
  weeks: number,
  today: ISODate,
  actionById?: (id: string | null) => Pick<Action, 'min_minutes'> | null | undefined,
  from?: ISODate,
): WeekPoint[] {
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const monday = addDays(lastMonday, -7 * i);
    if (from && monday < from) {
      out.push({ monday, planned: 0, credit: 0, rate: null, minutesPlanned: 0, minutesDone: 0 });
      continue;
    }
    const t = periodTally(sessions, { start: monday, end: addDays(monday, 6) }, today, actionById);
    out.push({
      monday,
      planned: t.planned,
      credit: t.credit,
      rate: t.planned ? Math.min(1.5, t.credit / t.planned) : null,
      minutesPlanned: t.minutesPlanned,
      minutesDone: t.minutesDone,
    });
  }
  return out;
}

/** Misses (due and not done) per ISO weekday over a period, Monday first. */
export function missesByWeekday(sessions: Session[], range: DateRange, today: ISODate): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessionsInPeriod(sessions, range)) {
    if (!s.date || s.date >= today || s.origin === 'unplanned') continue;
    if (sessionCredit(s) === 0) out[isoWeekday(s.date) - 1]! += 1;
  }
  return out;
}

/** The weekday that collects most misses, when it's a real pattern (3+ misses and 40%+ of all misses). */
export function weekdayPattern(sessions: Session[], range: DateRange, today: ISODate): { weekday: number; misses: number; total: number } | null {
  const by = missesByWeekday(sessions, range, today);
  const total = by.reduce((a, b) => a + b, 0);
  const top = Math.max(...by);
  if (top < 3 || top / total < 0.4) return null;
  return { weekday: by.indexOf(top) + 1, misses: top, total };
}

/** Obstacles logged on sessions in a period, most frequent first. */
export function obstacleCounts(sessions: Session[], range: DateRange): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sessionsInPeriod(sessions, range)) {
    for (const o of s.obstacles) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

/** The most recent finished review of a kind that started before `before`. */
export function previousReview(reviews: Review[], kind: ReviewKind, before: ISODate): Review | null {
  return (
    reviews
      .filter((r) => r.kind === kind && r.status === 'done' && r.period_start < before)
      .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0] ?? null
  );
}

/** How often a planned change ("what should change next") actually happened. */
export function commitmentStats(reviews: Review[]): { answered: number; kept: number; partly: number } {
  let answered = 0;
  let kept = 0;
  let partly = 0;
  for (const r of reviews) {
    if (r.status !== 'done' || !r.commitment_kept) continue;
    answered += 1;
    if (r.commitment_kept === 'yes') kept += 1;
    if (r.commitment_kept === 'partly') partly += 1;
  }
  return { answered, kept, partly };
}

/**
 * The Monday of a plan's first real week. A plan that starts Friday to Sunday has only a few
 * days in its first calendar week, so that stub is folded into the next week instead of
 * counting as a week of its own (in review counts, averages and trends).
 */
export function firstPlanWeek(plan: Pick<Plan, 'start_date'>): ISODate {
  const monday = weekStart(plan.start_date);
  return isoWeekday(plan.start_date) >= 5 ? addDays(monday, 7) : monday;
}

/** Weekly reviews done vs weeks finished in a plan (weeks that ended before today). */
export function weeklyReviewCount(plan: Plan, reviews: Review[], today: ISODate): { done: number; weeks: number } {
  const first = firstPlanWeek(plan);
  const done = new Set(reviews.filter((r) => r.kind === 'weekly' && r.status === 'done').map((r) => r.period_start));
  let weeks = 0;
  let count = 0;
  for (let monday = first; addDays(monday, 6) < today && monday <= plan.end_date; monday = addDays(monday, 7)) {
    weeks += 1;
    if (done.has(monday)) count += 1;
  }
  return { done: count, weeks };
}

// ---------- Which month, 3-month and plan reviews are due ----------

/** Reviews open this many days before their period ends (Friday for a period ending Sunday). */
export const REVIEW_OPENS_DAYS_BEFORE = 2;
export const RETRO_OPENS_DAYS_BEFORE = 6;

export interface PeriodReviewSlot {
  kind: Exclude<ReviewKind, 'weekly'>;
  plan: Plan;
  period: DateRange;
  /** Month 3, Last 3 months, the plan name… */
  title: string;
  opensOn: ISODate;
  /** 'open' (can start now, period not over), 'overdue' (period over, not done), 'upcoming'. */
  state: 'open' | 'overdue' | 'upcoming';
}

function isDone(reviews: Review[], kind: ReviewKind, start: ISODate): boolean {
  return reviews.some((r) => r.kind === kind && r.status === 'done' && r.period_start === start);
}

/**
 * The month and 3-month reviews for a plan: the latest one that's open or still not done
 * (a missed one stays open until the next one of its kind opens), plus the next upcoming one.
 * The last 3-month stage ends with the plan, so the plan retrospective covers it.
 */
export function periodReviewSlots(plan: Plan, reviews: Review[], today: ISODate): PeriodReviewSlot[] {
  const out: PeriodReviewSlot[] = [];
  const stages: { kind: 'block' | 'quarter'; nodes: CascadeNode[] }[] = [
    { kind: 'block', nodes: planMonths(plan) },
    { kind: 'quarter', nodes: cascadeRanges(plan).filter((q) => q.end < plan.end_date) },
  ];
  for (const { kind, nodes } of stages) {
    const opens = (n: CascadeNode) => addDays(n.end, -REVIEW_OPENS_DAYS_BEFORE);
    const opened = nodes.filter((n) => opens(n) <= today);
    const latest = opened[opened.length - 1];
    if (latest && !isDone(reviews, kind, latest.start)) {
      out.push({ kind, plan, period: { start: latest.start, end: latest.end }, title: latest.title, opensOn: opens(latest), state: latest.end < today ? 'overdue' : 'open' });
    }
    const next = nodes.find((n) => opens(n) > today);
    if (next) out.push({ kind, plan, period: { start: next.start, end: next.end }, title: next.title, opensOn: opens(next), state: 'upcoming' });
  }
  return out;
}

/** The retrospective for a plan: open from the plan's last week until it's done (upcoming before that). */
export function retroSlot(plan: Plan, reviews: Review[], today: ISODate): PeriodReviewSlot | null {
  if (isDone(reviews, 'retro', plan.start_date)) return null;
  const opensOn = addDays(plan.end_date, -RETRO_OPENS_DAYS_BEFORE);
  const state = plan.end_date < today ? 'overdue' : opensOn <= today ? 'open' : 'upcoming';
  return { kind: 'retro', plan, period: { start: plan.start_date, end: plan.end_date }, title: plan.name, opensOn, state };
}

/** The month or 3-month stage of a plan that starts on `start` (falls back to the one containing it). */
export function periodNode(plan: Plan, kind: 'block' | 'quarter', start: ISODate): CascadeNode | null {
  const nodes = kind === 'block' ? planMonths(plan) : cascadeRanges(plan);
  return nodes.find((n) => n.start === start) ?? nodes.find((n) => n.start <= start && n.end >= start) ?? null;
}
