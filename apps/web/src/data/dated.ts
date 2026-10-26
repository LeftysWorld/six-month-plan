import type { Goal, ISODate, Milestone, PlanStep } from '@six/core';
import type { AppData, Op } from './model.ts';
import { fmt } from './derive.ts';

/**
 * A goal's dates inside its timeline, besides its start and finish:
 * - milestones: dates you add (class begins, exam day, weigh 200 lb by Jan 1). They're yours to
 *   add, move, rename, tick off or delete, from the roadmap, the calendar or the goal's page.
 * - checkpoints: when each 3-month, month and week goal you've set is due. They come from the goal
 *   chain, so their dates follow the season's periods; their text is edited on the goal's page.
 */

export type CheckpointLevel = 'quarter' | 'month' | 'week';
export const CHECKPOINT_NAME: Record<CheckpointLevel, string> = { quarter: '3-month goal', month: 'Month goal', week: 'Week goal' };

export interface Checkpoint {
  id: string;
  goalId: string;
  level: CheckpointLevel;
  date: ISODate;
  /** What should be true by then: "197 lb", or the goal's own words. */
  text: string;
  done: boolean;
}

/** The text of a set step: its number (with the goal's unit) and/or its note. */
export function stepText(goal: Goal, step: PlanStep): string {
  const value = step.target_value != null ? `${fmt(step.target_value)}${goal.unit ? ` ${goal.unit}` : ''}` : '';
  const note = step.target_note.trim();
  return value && note ? `${value} · ${note}` : value || note;
}

/**
 * The checkpoints of a goal that have been written down. Week goals are many and short, so only the
 * ones from `weeksFrom` on are included (the roadmap passes the current week; the calendar, every week).
 */
export function checkpointsOf(data: AppData, goal: Goal, weeksFrom: ISODate | null = null, planId: string | null = null): Checkpoint[] {
  return data.planSteps
    .filter((s) => s.goal_id === goal.id && (s.level === 'quarter' || s.level === 'month' || s.level === 'week'))
    .filter((s) => !planId || s.plan_id === planId)
    .filter((s) => s.level !== 'week' || !weeksFrom || s.end_date >= weeksFrom)
    .map((s) => ({ step: s, text: stepText(goal, s) }))
    .filter((x) => x.text)
    .map(({ step, text }) => ({ id: step.id, goalId: goal.id, level: step.level as CheckpointLevel, date: step.end_date, text, done: !!step.completed_at }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function opsUpdateMilestone(m: Milestone, patch: Partial<Pick<Milestone, 'title' | 'due_date' | 'completed_at'>>): Op[] {
  const clean: Record<string, unknown> = {};
  if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== m.title) clean.title = patch.title.trim();
  if (patch.due_date !== undefined && patch.due_date && patch.due_date !== m.due_date) clean.due_date = patch.due_date;
  if (patch.completed_at !== undefined && (patch.completed_at ?? null) !== (m.completed_at ?? null)) clean.completed_at = patch.completed_at ?? null;
  return Object.keys(clean).length ? [{ kind: 'update', collection: 'milestones', id: m.id, patch: clean }] : [];
}

export function opsDeleteMilestone(m: Milestone): Op[] {
  return [{ kind: 'delete', collection: 'milestones', id: m.id }];
}

/** Undo for a delete or an edit: put the milestone back as it was. */
export function opsRestoreMilestone(data: AppData, m: Milestone): Op[] {
  return data.milestones.some((x) => x.id === m.id)
    ? [{ kind: 'update', collection: 'milestones', id: m.id, patch: { title: m.title, due_date: m.due_date, completed_at: m.completed_at } }]
    : [{ kind: 'insert', collection: 'milestones', rows: [m as unknown as { id: string } & Record<string, unknown>] }];
}
