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

export function dateLimits(_view: View, goal: Goal, plan: Plan): DateLimits {
  return { minStart: plan.start_date, maxEnd: plan.end_date, endLocked: goal.type === 'number' };
}

/**
 * Keep a start/end pair inside the limits, end on or after start. `hold` says which side stays put
 * when they cross: dragging the start past the end stops at the end (hold 'end'), and the other way
 * round; a locked end always holds.
 */
export function clampDates(limits: DateLimits, start: ISODate, end: ISODate, hold: 'start' | 'end' = limits.endLocked ? 'end' : 'start'): { start: ISODate; end: ISODate; clamped: boolean } {
  let s = start < limits.minStart ? limits.minStart : start > limits.maxEnd ? limits.maxEnd : start;
  let e = end > limits.maxEnd ? limits.maxEnd : end < limits.minStart ? limits.minStart : end;
  if (e < s) {
    if (hold === 'end' || limits.endLocked) s = e;
    else e = s;
  }
  const clamped = s !== start || e !== end;
  return { start: s, end: e, clamped };
}

const range = (a: ISODate, b: ISODate) => `${shortDate(a)} – ${shortDate(b)}`;

/**
 * Save a goal's new start and end. The start is stored only when it's later than the window's
 * start (otherwise it simply starts with the window); the end is the goal's finish-by date.
 * The change is written to the goal's history.
 */
export function opsSetGoalDates(
  view: View,
  goal: Goal,
  plan: Plan,
  next: { start: ISODate; end: ISODate },
  today: ISODate,
  hold?: 'start' | 'end',
): { ops: Op[]; start: ISODate; end: ISODate; clamped: boolean; logId: string | null } {
  const limits = dateLimits(view, goal, plan);
  const before = view.plannedWindow(goal, plan);
  const { start, end, clamped } = clampDates(limits, next.start, limits.endLocked ? before.end : next.end, hold);
  const patch: Partial<Goal> = {};
  const storedStart = start > plan.start_date ? start : null;
  if ((goal.start_date ?? null) !== storedStart && start !== before.start) patch.start_date = storedStart;
  if (!limits.endLocked) {
    const storedEnd = end === plan.end_date ? null : end;
    if ((goal.target_date ?? null) !== storedEnd && end !== before.end) patch.target_date = storedEnd;
  }
  if (!Object.keys(patch).length) return { ops: [], start, end, clamped, logId: null };
  const logId = crypto.randomUUID();
  const ops: Op[] = [
    { kind: 'update', collection: 'goals', id: goal.id, patch },
    {
      kind: 'insert',
      collection: 'changeLog',
      rows: [
        {
          id: logId,
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
  return { ops, start, end, clamped, logId };
}

/** Undo for a date change: put the two fields back as they were, and take the change out of the history. */
export function opsRestoreDates(goal: Goal, logId?: string | null): Op[] {
  return [
    { kind: 'update', collection: 'goals', id: goal.id, patch: { start_date: goal.start_date ?? null, target_date: goal.target_date ?? null } },
    ...(logId ? [{ kind: 'delete' as const, collection: 'changeLog' as const, id: logId }] : []),
  ];
}

export { addDays };
