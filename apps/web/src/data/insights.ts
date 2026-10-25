import {
  addDays,
  commitmentStats,
  firstPlanWeek,
  isoWeekday,
  minutesDone,
  obstacleCounts,
  periodTally,
  sessionCredit,
  weekStart,
  weekdayPattern,
  weeklyTrend,
  WEEKDAY_LONG,
  type CommitmentAnswer,
  type DateRange,
  type Goal,
  type GoalResult,
  type ISODate,
  type Plan,
  type Review,
  type WeekPoint,
} from '@six/core';
import type { AppData, Op } from './model.ts';
import { minutesText, type View } from './derive.ts';
import { opsEditTask, withOps, type TaskInput } from './breakdown.ts';

/** Patterns across recent weeks, written as short plain sentences for the review hub and the review. */

export function actionLookup(data: AppData) {
  const byId = new Map(data.actions.map((a) => [a.id, a]));
  return (id: string | null) => (id ? byId.get(id) ?? null : null);
}

/** The last `weeks` weeks ending with the week starting `lastMonday`. Weeks before `from` are empty. */
export function trendFor(data: AppData, lastMonday: ISODate, weeks: number, today: ISODate, from?: ISODate): WeekPoint[] {
  return weeklyTrend(data.sessions, lastMonday, weeks, today, actionLookup(data), from);
}

/**
 * Weekly trend for a plan: the last 8 finished weeks, or, for a young plan, its first 8 weeks
 * with weeks still to come as empty slots. Never shows weeks before the plan's first real week.
 */
export function planTrend(data: AppData, plan: Plan, lastMonday: ISODate, today: ISODate, weeks = 8): WeekPoint[] {
  const from = firstPlanWeek(plan);
  const frameEnd = addDays(from, 7 * (weeks - 1)) > lastMonday ? addDays(from, 7 * (weeks - 1)) : lastMonday;
  return trendFor(data, frameEnd, weeks, today, from).map((w) => (w.monday > lastMonday ? { ...w, planned: 0, credit: 0, rate: null, minutesPlanned: 0, minutesDone: 0 } : w));
}

/** Average minutes done and planned per week over the weeks that had anything planned. */
export function timeAverages(points: WeekPoint[]): { done: number; planned: number; weeks: number } | null {
  const used = points.filter((p) => p.planned > 0);
  if (!used.length) return null;
  const done = Math.round(used.reduce((s, p) => s + p.minutesDone, 0) / used.length);
  const planned = Math.round(used.reduce((s, p) => s + p.minutesPlanned, 0) / used.length);
  return { done, planned, weeks: used.length };
}

export function timeSentence(points: WeekPoint[]): string | null {
  const t = timeAverages(points);
  if (!t || t.planned === 0) return null;
  return t.weeks === 1
    ? `Last week: ${minutesText(roundTo5(t.done))} done, of ${minutesText(roundTo5(t.planned))} planned.`
    : `Last ${t.weeks} weeks: about ${minutesText(roundTo5(t.done))} done a week, of ${minutesText(roundTo5(t.planned))} planned.`;
}

export function obstacleSentence(data: AppData, range: DateRange): string | null {
  const top = obstacleCounts(data.sessions, range)[0];
  if (!top || top.count < 2) return null;
  const weeks = Math.max(1, Math.round((Date.parse(range.end) - Date.parse(range.start)) / (7 * 864e5)));
  return `${top.name} got in the way ${top.count} times ${weeks === 1 ? 'last week' : `in the last ${weeks} weeks`}.`;
}

export function weekdaySentence(data: AppData, range: DateRange, today: ISODate): string | null {
  const p = weekdayPattern(data.sessions, range, today);
  if (!p) return null;
  return `${p.misses} of your ${p.total} misses landed on a ${WEEKDAY_LONG[p.weekday - 1]}. Moving a task off that day may help more than doing less.`;
}

export function commitmentSentence(data: AppData): string | null {
  const s = commitmentStats(data.reviews);
  if (s.answered < 2) return null;
  return `Your planned changes stuck ${s.kept} of ${s.answered} times${s.partly ? ` (${s.partly} more partly)` : ''}.`;
}

export type InsightAction = { kind: 'move-weekday'; weekday: number } | { kind: 'review'; label: string };
export interface Insight {
  text: string;
  action?: InsightAction;
}

/**
 * The hub's insights: the weekly trend (from the plan's first real week), time per week,
 * the biggest obstacle, a weekday that collects misses (with a fix), and how often changes stuck.
 */
export function hubInsights(data: AppData, plan: Plan, today: ISODate, reviewOpen: boolean): { trend: WeekPoint[]; insights: Insight[] } {
  const lastMonday = addDays(weekStart(today), -7);
  const from = firstPlanWeek(plan);
  const trend = planTrend(data, plan, lastMonday, today);
  const start = addDays(lastMonday, -21) < from ? from : addDays(lastMonday, -21);
  const window: DateRange = { start, end: addDays(lastMonday, 6) };
  const out: Insight[] = [];
  const finished = trend.filter((w) => w.monday <= lastMonday).slice(-4);
  const time = timeSentence(finished);
  const avg = timeAverages(finished);
  if (time) out.push({ text: time, action: reviewOpen && avg && avg.planned > avg.done * 1.25 ? { kind: 'review', label: `Plan next week around ${minutesText(roundTo5(avg.done))}` } : undefined });
  const obstacle = obstacleSentence(data, window);
  if (obstacle) out.push({ text: obstacle });
  const p = window.start <= window.end ? weekdayPattern(data.sessions, window, today) : null;
  if (p) out.push({ text: `${p.misses} of your ${p.total} misses landed on a ${WEEKDAY_LONG[p.weekday - 1]}.`, action: { kind: 'move-weekday', weekday: p.weekday } });
  const commitment = commitmentSentence(data);
  if (commitment) out.push({ text: commitment });
  return { trend, insights: out };
}

/** Minutes actually done per goal in a week, biggest first (goals with nothing done are left out). */
export function minutesByGoal(view: View, data: AppData, goals: Goal[], monday: ISODate): { goal: Goal; minutes: number }[] {
  const lookup = actionLookup(data);
  const end = addDays(monday, 6);
  return goals
    .map((goal) => ({
      goal,
      minutes: view
        .sessionsForGoal(goal.id)
        .filter((s) => (s.date ? s.date >= monday && s.date <= end : s.week_start === monday))
        .reduce((sum, s) => sum + minutesDone(s, lookup(s.action_id)), 0),
    }))
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

// ---------- Changes you committed to ----------

export interface CommitmentEntry {
  review: Review;
  text: string;
  /** How the next review answered "did it happen?" (null = not answered). */
  kept: CommitmentAnswer | null;
  /** A later review exists (so a null answer means it was skipped, not that it's still running). */
  answered: boolean;
}

/** Changes written in weekly reviews, newest first, each with how the following review answered. */
export function commitmentTrail(reviews: Review[], limit = 6): CommitmentEntry[] {
  const weekly = reviews.filter((r) => r.kind === 'weekly' && r.status === 'done').sort((a, b) => (a.period_start < b.period_start ? 1 : -1));
  const out: CommitmentEntry[] = [];
  for (let i = 0; i < weekly.length && out.length < limit; i++) {
    const r = weekly[i]!;
    if (!r.change_next.trim()) continue;
    const after = weekly.slice(0, i).reverse().find((x) => x.period_start > r.period_start) ?? null;
    out.push({ review: r, text: r.change_next.trim(), kept: after?.commitment_kept ?? null, answered: !!after });
  }
  return out;
}

/**
 * The change you're working on: the one written in the review of last week (it applies to this
 * week), or, once this week is reviewed, the one for next week.
 */
export function currentCommitment(reviews: Review[], today: ISODate): { review: Review; text: string; forWeek: ISODate } | null {
  const thisMonday = weekStart(today);
  const done = (monday: ISODate) => reviews.find((r) => r.kind === 'weekly' && r.status === 'done' && r.period_start === monday);
  const thisWeek = done(thisMonday);
  if (thisWeek?.change_next.trim()) return { review: thisWeek, text: thisWeek.change_next.trim(), forWeek: addDays(thisMonday, 7) };
  const lastWeek = done(addDays(thisMonday, -7));
  if (lastWeek?.change_next.trim()) return { review: lastWeek, text: lastWeek.change_next.trim(), forWeek: thisMonday };
  return null;
}

/** "On it" / "Slipping" for a commitment, kept on this device only (a light mid-week check). */
export type CommitmentCheck = 'on' | 'slipping';
const checkKey = (reviewId: string) => `six.commitment.${reviewId}`;
export function readCheck(reviewId: string): CommitmentCheck | null {
  try {
    const v = localStorage.getItem(checkKey(reviewId));
    return v === 'on' || v === 'slipping' ? v : null;
  } catch {
    return null;
  }
}
export function writeCheck(reviewId: string, value: CommitmentCheck | null): void {
  try {
    if (value) localStorage.setItem(checkKey(reviewId), value);
    else localStorage.removeItem(checkKey(reviewId));
  } catch {
    // Storage blocked: the check just isn't remembered.
  }
}

// ---------- Scorecard: goals × weeks ----------

export interface ScoreCell {
  monday: ISODate;
  /** Share of the goal's due tasks done that week (null when nothing was due). */
  rate: number | null;
  done: number;
  planned: number;
  /** How the weekly review rated that week's goal, if it was rated. */
  result: GoalResult | null;
  /** The week isn't over yet. */
  current: boolean;
}

/** For each goal, one cell per week from the plan's first real week (at most `weeks`), ending with this week. */
export function scorecard(view: View, data: AppData, plan: Plan, goals: Goal[], today: ISODate, weeks = 6): { mondays: ISODate[]; rows: { goal: Goal; cells: ScoreCell[] }[]; hits: { hit: number; rated: number } } {
  const thisMonday = weekStart(today);
  const from = firstPlanWeek(plan);
  const mondays: ISODate[] = [];
  for (let m = thisMonday; mondays.length < weeks && m >= from; m = addDays(m, -7)) mondays.unshift(m);
  const lookup = actionLookup(data);
  const reviewFor = (monday: ISODate) => data.reviews.find((r) => r.kind === 'weekly' && r.status === 'done' && r.period_start === monday);
  let hit = 0;
  let rated = 0;
  const rows = goals.map((goal) => ({
    goal,
    cells: mondays.map((monday): ScoreCell => {
      const t = periodTally(view.sessionsForGoal(goal.id), { start: monday, end: addDays(monday, 6) }, today, lookup);
      const result = reviewFor(monday)?.goal_results?.find((g) => g.goal_id === goal.id)?.result ?? null;
      if (result) {
        rated += 1;
        if (result === 'hit') hit += 1;
      }
      return { monday, rate: t.planned ? Math.min(1, t.credit / t.planned) : null, done: Math.round(t.credit), planned: t.planned, result, current: monday === thisMonday };
    }),
  }));
  return { mondays, rows, hits: { hit, rated } };
}

// ---------- Review length ----------

/** An honest estimate of a review's length from what it will ask, rounded to 5 minutes. */
export function reviewMinutes(input: { goals: number; measurements: number; suggestions: number; planning: boolean }): number {
  const m = 2 + input.goals * 0.75 + input.measurements * 0.5 + input.suggestions * 0.75 + (input.planning ? 2 + input.goals * 0.5 : 0);
  return Math.max(5, Math.round(m / 5) * 5);
}

// ---------- Fix: move a weekday that collects misses ----------

export interface WeekdayMove {
  from: number;
  to: number;
  tasks: { actionId: string; title: string }[];
  /** First day the change applies (next Monday). */
  start: ISODate;
}

/**
 * Plan for moving fixed-day tasks off a weekday that keeps getting missed: the tasks that missed
 * on that day in the last 4 weeks move to the weekday with the least fixed time on it.
 */
export function weekdayMove(data: AppData, weekday: number, today: ISODate): WeekdayMove | null {
  const start = addDays(weekStart(today), 7);
  const since = addDays(weekStart(today), -28);
  const missed = new Set(
    data.sessions
      .filter((s) => s.action_id && s.date && s.date >= since && s.date < today && isoWeekday(s.date) === weekday && s.origin !== 'unplanned' && s.status !== 'moved' && sessionCredit(s) === 0)
      .map((s) => s.action_id!),
  );
  const live = (actionId: string) => data.schedules.find((x) => x.action_id === actionId && x.rule === 'days' && x.effective_from <= start && (x.effective_to == null || x.effective_to >= start));
  const tasks = data.actions.filter((a) => !a.archived_at && missed.has(a.id) && live(a.id)?.days.includes(weekday));
  if (!tasks.length) return null;
  const load = [0, 0, 0, 0, 0, 0, 0];
  for (const a of data.actions) {
    const s = live(a.id);
    if (!s || a.archived_at) continue;
    for (const d of s.days) load[d - 1]! += a.planned_minutes;
  }
  let to = 0;
  for (let d = 1; d <= 7; d++) {
    if (d === weekday || tasks.every((a) => live(a.id)!.days.includes(d))) continue;
    if (to === 0 || load[d - 1]! < load[to - 1]!) to = d;
  }
  if (to === 0) return null;
  return { from: weekday, to, tasks: tasks.map((a) => ({ actionId: a.id, title: a.title })), start };
}

/** Apply a weekday move from next Monday on. Earlier weeks keep their old days. */
export function opsWeekdayMove(data: AppData, move: WeekdayMove, today: ISODate): Op[] {
  const ops: Op[] = [];
  let next = data;
  for (const t of move.tasks) {
    const action = next.actions.find((a) => a.id === t.actionId);
    const s = next.schedules.find((x) => x.action_id === t.actionId && x.rule === 'days' && x.effective_from <= move.start && (x.effective_to == null || x.effective_to >= move.start));
    if (!action || !s) continue;
    const days = [...new Set(s.days.map((d) => (d === move.from ? move.to : d)))].sort((a, b) => a - b);
    const input: TaskInput = {
      title: action.title,
      kind: action.kind,
      minutes: action.planned_minutes,
      count: action.planned_count,
      when: 'days',
      date: move.start,
      days,
      perWeek: days.length,
      through: s.effective_to,
      priority: action.priority,
      minLabel: action.min_label,
      cue: action.cue ?? '',
    };
    const more = opsEditTask(next, action, input, move.start, today);
    ops.push(...more);
    next = withOps(next, more);
  }
  return ops;
}

function roundTo5(min: number): number {
  return Math.round(min / 5) * 5;
}
