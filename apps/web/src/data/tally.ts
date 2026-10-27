import { addDays, isTally, tallyOf, tallyReachedOn, tallyStatus, type Action, type ISODate, type Milestone, type TallyStatus } from '@six/core';
import type { View } from './derive.ts';
import type { AppData, Op } from './model.ts';

/**
 * Running totals on dates to hit: "250 applications by Dec 15", counted from the "Apply to 25 jobs" task.
 * The milestone keeps the target (value) and the task (count_action_id); the total is read from the task's logs.
 */

/** The count tasks on a goal that a tally could be counted from. */
export function countTasksFor(view: View, goalId: string): Action[] {
  return view.actionsForGoal(goalId).filter((a) => a.kind === 'count' && !a.archived_at);
}

/** The tallies counted from a task (any goal). */
export function talliesFor(data: AppData, actionId: string): Milestone[] {
  return data.milestones.filter((m) => m.count_action_id === actionId && isTally(m)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
}

/** The day counting began for a tally: the task's first scheduled day, else the goal's start, else the first log. */
function countingFrom(view: View, m: Milestone): ISODate {
  const first = view.data.schedules
    .filter((s) => s.action_id === m.count_action_id)
    .map((s) => s.effective_from)
    .sort()[0];
  const goal = view.goal(m.goal_id);
  const plan = goal ? view.planForGoal(goal) : null;
  const start = goal && plan ? view.startFor(goal, plan) : undefined;
  const firstLog = view.data.sessions
    .filter((s) => s.action_id === m.count_action_id && s.date && s.status !== 'planned')
    .map((s) => s.date!)
    .sort()[0];
  return [first, start, firstLog].filter((d): d is ISODate => !!d).sort()[0] ?? m.due_date;
}

/** Where a tally stands today, or null for a plain date. */
export function tallyFor(view: View, m: Milestone, today: ISODate): TallyStatus | null {
  if (!isTally(m) || !m.count_action_id) return null;
  const total = tallyOf(view.data.sessions, m.count_action_id, today);
  const goal = view.goal(m.goal_id);
  return tallyStatus(m, total, countingFrom(view, m), today, view.tooEarly(goal ? view.planForGoal(goal) : null, goal));
}

/**
 * Tick off every tally whose total has reached its target, dated to the day it got there.
 * Run after logging; it never reopens one (reopen by hand if a log was a mistake and the total is corrected).
 */
export function opsSettleTallies(data: AppData): Op[] {
  const ops: Op[] = [];
  for (const m of data.milestones) {
    if (m.completed_at || !isTally(m) || !m.count_action_id) continue;
    const on = tallyReachedOn(data.sessions, m.count_action_id, Number(m.value));
    if (on) ops.push({ kind: 'update', collection: 'milestones', id: m.id, patch: { completed_at: `${on}T12:00:00.000Z` } });
  }
  return ops;
}

/** The words after the number in a tally's title: "250 applications" → "applications". */
export function tallyUnit(m: Pick<Milestone, 'title'>): string {
  return m.title.replace(/^\s*[\d,.]+\s*/, '').trim();
}

/**
 * The goal's headline total, when it has one: the tally with the biggest target (latest date on a
 * tie). It stands in for "x of y milestones" wherever the goal's progress is summed up.
 */
export function headlineTally(view: View, goalId: string, today: ISODate): { m: Milestone; t: TallyStatus } | null {
  const ms = view.data.milestones.filter((m) => m.goal_id === goalId && isTally(m)).sort((a, b) => Number(b.value) - Number(a.value) || (a.due_date < b.due_date ? 1 : -1));
  const m = ms[0];
  if (!m) return null;
  const t = tallyFor(view, m, today);
  return t ? { m, t } : null;
}

/** What a tally's task logged inside a week (Monday to Sunday). */
export function tallyInWeek(data: AppData, m: Milestone, monday: ISODate): number {
  if (!m.count_action_id) return 0;
  const sunday = addDays(monday, 6);
  return tallyOf(data.sessions, m.count_action_id, sunday) - tallyOf(data.sessions, m.count_action_id, addDays(monday, -1));
}

/**
 * Milestones that are plainly totals but were never linked ("250 applications" on a goal whose only
 * count task is "Apply to 25 jobs") get linked, so the counter shows without a setup step.
 * Only when the goal has exactly one count task and the title starts with a number (years skipped).
 */
export function opsAutoLinkTallies(data: AppData): Op[] {
  const ops: Op[] = [];
  for (const m of data.milestones) {
    if (m.completed_at || m.count_action_id || m.value != null) continue;
    const n = Number((m.title.match(/^\s*([\d,]+)\b/)?.[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 5 || (n >= 1900 && n <= 2100)) continue;
    const goal = data.goals.find((g) => g.id === m.goal_id);
    if (!goal || goal.type === 'number') continue;
    const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
    const counts = data.actions.filter((a) => actionIds.has(a.id) && a.kind === 'count' && !a.archived_at);
    if (counts.length !== 1) continue;
    ops.push({ kind: 'update', collection: 'milestones', id: m.id, patch: { value: n, count_action_id: counts[0]!.id } });
  }
  return ops;
}
