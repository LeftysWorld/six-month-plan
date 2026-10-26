import { addDays, shortDate, type Goal, type ISODate, type Plan } from '@six/core';
import type { Op } from './model.ts';
import type { View } from './derive.ts';

/**
 * Changing a goal's start and end (from the roadmap or its edit sheet). Dates stay inside the
 * goal's window; a goal that starts after another can't start before that one is due to end;
 * a number goal's end is its path's end, so only its start can move here.
 */

export interface DateLimits {
  /** Earliest start: the window's start, or the day after the goal it waits on is due to end. */
  minStart: ISODate;
  maxEnd: ISODate;
  /** A number goal's end is set by its path (change the target on the goal page). */
  endLocked: boolean;
}

export function dateLimits(view: View, goal: Goal, plan: Plan): DateLimits {
  const { waitsFrom } = view.plannedWindow(goal, plan);
  const minStart = waitsFrom && waitsFrom > plan.start_date ? (waitsFrom > plan.end_date ? plan.end_date : waitsFrom) : plan.start_date;
  return { minStart, maxEnd: plan.end_date, endLocked: goal.type === 'number' };
}

/** Keep a start/end pair inside the limits, end on or after start. */
export function clampDates(limits: DateLimits, start: ISODate, end: ISODate): { start: ISODate; end: ISODate; clamped: boolean } {
  let s = start < limits.minStart ? limits.minStart : start > limits.maxEnd ? limits.maxEnd : start;
  let e = end > limits.maxEnd ? limits.maxEnd : end;
  if (e < s) e = s;
  const clamped = s !== start || e !== end;
  return { start: s, end: e, clamped };
}

const range = (a: ISODate, b: ISODate) => `${shortDate(a)} – ${shortDate(b)}`;

/**
 * Save a goal's new start and end. The start is stored only when it's later than the window's
 * start (otherwise it simply starts with the window); the end is the goal's finish-by date.
 * The change is written to the goal's history.
 */
export function opsSetGoalDates(view: View, goal: Goal, plan: Plan, next: { start: ISODate; end: ISODate }, today: ISODate): { ops: Op[]; start: ISODate; end: ISODate; clamped: boolean } {
  const limits = dateLimits(view, goal, plan);
  const before = view.plannedWindow(goal, plan);
  const { start, end, clamped } = clampDates(limits, next.start, limits.endLocked ? before.end : next.end);
  const patch: Partial<Goal> = {};
  const storedStart = start > plan.start_date ? start : null;
  if ((goal.start_date ?? null) !== storedStart && start !== before.start) patch.start_date = storedStart;
  if (!limits.endLocked) {
    const storedEnd = end === plan.end_date ? null : end;
    if ((goal.target_date ?? null) !== storedEnd && end !== before.end) patch.target_date = storedEnd;
  }
  if (!Object.keys(patch).length) return { ops: [], start, end, clamped };
  const ops: Op[] = [
    { kind: 'update', collection: 'goals', id: goal.id, patch },
    {
      kind: 'insert',
      collection: 'changeLog',
      rows: [
        {
          id: crypto.randomUUID(),
          entity: 'goal',
          entity_id: goal.id,
          summary: `Dates: ${range(before.start, before.end)} → ${range(start, end)}`,
          old_value: { start: before.start, end: before.end },
          new_value: { start, end },
          effective_from: today,
          review_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    },
  ];
  return { ops, start, end, clamped };
}

/** Undo for a date change: put the two fields back as they were. */
export function opsRestoreDates(goal: Goal): Op[] {
  return [{ kind: 'update', collection: 'goals', id: goal.id, patch: { start_date: goal.start_date ?? null, target_date: goal.target_date ?? null } }];
}

/** Goals a goal could start after: others in its window that don't (directly or not) wait on it. */
export function afterChoices(goals: Goal[], goal: Goal): Goal[] {
  const waitsOnMe = (g: Goal): boolean => {
    const seen = new Set<string>();
    let cur: Goal | undefined = g;
    while (cur?.after_goal_id && !seen.has(cur.id)) {
      if (cur.after_goal_id === goal.id) return true;
      seen.add(cur.id);
      cur = goals.find((x) => x.id === cur!.after_goal_id);
    }
    return false;
  };
  return goals.filter((g) => g.id !== goal.id && !g.completed_at && !waitsOnMe(g));
}

export { addDays };
