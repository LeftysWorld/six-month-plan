import { chainAt, suggestPath, type GoalIdea, type IdeaPrep, type ISODate, type PathPoint, type Plan } from '@six/core';
import type { AppData, Op } from './model.ts';
import { opsCreateGoal } from './ops.ts';
import { blankTask, opsAddTask, withOps } from './breakdown.ts';
import { opsStartIdea } from './backlog.ts';
import { chainFor, opsStartChain } from './chain.ts';

/**
 * Prepare, then commit. Preparing saves the plan on the selected idea (nothing else changes);
 * committing is a separate, deliberate step that creates the goal in a plan.
 */

/** Save the prepared plan on the idea. */
export function opsSavePrep(idea: GoalIdea, prep: IdeaPrep, title?: string): Op[] {
  const patch: Record<string, unknown> = { prep: { ...prep, prepared_at: new Date().toISOString() } };
  if (title && title.trim() && title.trim() !== idea.title) patch.title = title.trim();
  return [{ kind: 'update', collection: 'ideas', id: idea.id, patch }];
}

/** The suggested path for a "reach a number" prep, starting on `from`, with any targets the person changed. */
export function prepPath(prep: IdeaPrep, from: ISODate, blockDays: number): PathPoint[] {
  if (prep.type !== 'number' || prep.baseline == null || prep.target == null || !prep.target_date || prep.target_date <= from) return [];
  return suggestPath(prep.baseline, prep.target, from, prep.target_date, blockDays).map((p) => ({ ...p, value: prep.path_edits?.[p.date] ?? p.value }));
}

/**
 * Commit a prepared idea to a plan: the goal, its chain (3 months, month, week), its first
 * daily task, and the idea marked started and linked to the goal.
 */
export function opsCommitIdea(data: AppData, idea: GoalIdea, plan: Plan, today: ISODate, color: string): { ops: Op[]; goalId: string } {
  const prep = idea.prep ?? {};
  const type = prep.type ?? 'practice';
  const { ops, goalId } = opsCreateGoal(
    data,
    {
      planId: plan.id,
      title: idea.title,
      type,
      why: idea.note,
      done_means: idea.done_means ?? '',
      color,
      unit: prep.unit ?? '',
      measureName: prep.measure_name ?? '',
      baseline: prep.baseline ?? null,
      target: prep.target ?? null,
      targetDate: prep.target_date ?? '',
      path: prepPath(prep, today, plan.block_days),
      milestones: type === 'finish' ? (prep.milestones ?? []).filter((m) => m.title.trim()) : [],
      action: null,
    },
    today,
  );
  let next = withOps(data, ops);
  const goal = next.goals.find((g) => g.id === goalId)!;
  const from = today < plan.start_date ? plan.start_date : today;
  const chainOps = opsStartChain(next, goal, plan, from, { quarter: (prep.quarter ?? '').trim(), month: (prep.month ?? '').trim(), week: (prep.week ?? '').trim() });
  next = withOps(next, chainOps);
  const all = [...ops, ...chainOps];
  if (prep.task && prep.task.title.trim() && prep.task.days.length) {
    const week = chainFor(next, goal, plan, from).week.step!;
    all.push(...opsAddTask(next, goal, week, { ...blankTask(week, today), title: prep.task.title.trim(), when: 'days', days: prep.task.days, minutes: prep.task.minutes, through: null }, today));
  }
  all.push(...opsStartIdea(withOps(data, all), idea.id, goalId));
  return { ops: all, goalId };
}

/** The periods a goal committed to this plan today would start in (for checking the prepared notes). */
export function startPeriods(plan: Plan, today: ISODate) {
  return chainAt(plan, today < plan.start_date ? plan.start_date : today);
}
