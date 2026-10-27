import { isTally, tallyOf, tallyReachedOn, tallyStatus, type Action, type ISODate, type Milestone, type TallyStatus } from '@six/core';
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
