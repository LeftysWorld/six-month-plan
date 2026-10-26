import { addDays, suggestPath, type GoalType, type ISODate, type PathPoint, type Plan } from '@six/core';
import type { AppData, Op } from './model.ts';
import { opsCreateGoal, opsCreatePlan } from './ops.ts';
import { blankTask, opsAddTask, withOps } from './breakdown.ts';
import { chainFor, opsStartChain } from './chain.ts';
import { opsShareTask } from './connect.ts';
import { opsAddToGroup, opsCreateGroup, suggestGroupNames } from './groups.ts';
import { opsStartIdea } from './backlog.ts';

/**
 * Making a goal, in one step: the goal itself (what done looks like, by when), its season, its own
 * start and finish, this week's goal, and its first daily task (or a task it shares with another
 * goal). No separate prepare-then-commit ceremony: a goal exists once you've said these things.
 */

export interface NewGoalInput {
  title: string;
  type: GoalType;
  why: string;
  doneMeans: string;
  color: string;
  /** The season (review calendar) it belongs to. */
  planId: string;
  /** Its own start, when later than the season's. */
  start: ISODate | null;
  /** Its own finish, when earlier than the season's (not for number goals: their target date is the finish). */
  finish: ISODate | null;
  // number goals
  unit: string;
  measureName: string;
  baseline: number | null;
  target: number | null;
  targetDate: ISODate;
  /** The path's checkpoints you changed by hand, by date. */
  pathEdits: Record<string, number>;
  // finish goals
  milestones: { title: string; due_date: ISODate; value?: number | null; prize?: string }[];
  /** The treat for finishing, and the extra for finishing by the target date (both optional). */
  prize?: string;
  prizeOnTime?: string;
  /** This week's goal, in a line. */
  weekGoal: string;
  /** The first daily task, or null to share one instead. */
  task: { title: string; days: number[]; minutes: number } | null;
  /** Existing tasks (action ids) this goal shares from the start. */
  shareActionIds: string[];
  /** A goal to group it with (it joins that goal's group, or they start one). */
  groupWithGoalId: string | null;
  /** The Odyssey path this goal is a bet on, if any. */
  pathId: string | null;
  /** The backlog idea it came from, if any. */
  ideaId: string | null;
}

/** The suggested path for a number goal, from `from` to the target date, with any hand edits. */
export function newGoalPath(input: Pick<NewGoalInput, 'type' | 'baseline' | 'target' | 'targetDate' | 'pathEdits'>, from: ISODate, blockDays: number): PathPoint[] {
  if (input.type !== 'number' || input.baseline == null || input.target == null || !input.targetDate || input.targetDate <= from) return [];
  return suggestPath(input.baseline, input.target, from, input.targetDate, blockDays).map((p) => ({ ...p, value: input.pathEdits[p.date] ?? p.value }));
}

/** What a new goal still needs before it can be made. */
export function newGoalGaps(input: NewGoalInput, today: ISODate): string[] {
  const gaps: string[] = [];
  if (!input.title.trim()) gaps.push('a name');
  if (!input.doneMeans.trim() && input.type !== 'number') gaps.push('what done looks like');
  if (input.type === 'number' && (input.target == null || !input.targetDate || input.targetDate <= today)) gaps.push('a target and a date');
  if (!input.planId) gaps.push('a season');
  const hasTask = !!input.task && !!input.task.title.trim() && input.task.days.length > 0 && input.task.minutes > 0;
  if (!hasTask && input.shareActionIds.length === 0 && input.type !== 'number') gaps.push('a daily task, or one to share');
  return gaps;
}

/** Make the goal. Returns the ops and the new goal's id. */
export function opsMakeGoal(data: AppData, plan: Plan, input: NewGoalInput, today: ISODate): { ops: Op[]; goalId: string } {
  const from = today < plan.start_date ? plan.start_date : today;
  const start = input.start && input.start > from ? input.start : from;
  const { ops, goalId } = opsCreateGoal(
    data,
    {
      planId: plan.id,
      title: input.title,
      type: input.type,
      why: input.why,
      done_means: input.doneMeans,
      color: input.color,
      unit: input.unit,
      measureName: input.measureName,
      baseline: input.baseline,
      target: input.target,
      targetDate: input.targetDate,
      path: newGoalPath(input, start, plan.block_days),
      milestones: input.milestones.filter((m) => m.title.trim()).map((m) => ({ title: m.title, due_date: m.due_date, ...(m.value != null ? { value: m.value } : {}), ...(m.prize?.trim() ? { prize: m.prize.trim() } : {}) })),
      action: null,
    },
    today,
  );
  const all: Op[] = [...ops];
  // Its own dates inside the season.
  const dates: Record<string, unknown> = {};
  if (input.pathId) dates.path_id = input.pathId;
  if (start > plan.start_date) dates.start_date = start;
  if (input.type !== 'number' && input.finish && input.finish < plan.end_date && input.finish >= start) dates.target_date = input.finish;
  // Its prizes: for finishing, and for finishing by the date it has right now (that date is fixed as the bonus's judge).
  if (input.prize?.trim()) dates.prize = input.prize.trim();
  if (input.prizeOnTime?.trim()) {
    dates.prize_on_time = input.prizeOnTime.trim();
    dates.target_date_at_set = (dates.target_date as ISODate | undefined) ?? (input.type === 'number' ? input.targetDate || plan.end_date : plan.end_date);
  }
  if (Object.keys(dates).length) all.push({ kind: 'update', collection: 'goals', id: goalId, patch: dates });
  let next = withOps(data, all);
  const goal = next.goals.find((g) => g.id === goalId)!;
  // This week's goal.
  const chainOps = opsStartChain(next, goal, plan, start, { week: input.weekGoal.trim() });
  all.push(...chainOps);
  next = withOps(next, chainOps);
  // Its first daily task.
  if (input.task && input.task.title.trim() && input.task.days.length) {
    const week = chainFor(next, goal, plan, start).week.step!;
    // A task with minutes is logged in minutes; one without is a plain check-off.
    const taskOps = opsAddTask(next, goal, week, { ...blankTask(week, today), title: input.task.title.trim(), kind: input.task.minutes > 0 ? 'minutes' : 'check', when: 'days', days: input.task.days, minutes: input.task.minutes, through: null, start: start > today ? start : null }, today);
    all.push(...taskOps);
    next = withOps(next, taskOps);
  }
  // Tasks it shares with other goals from the start.
  for (const actionId of input.shareActionIds) {
    if (!next.actions.some((a) => a.id === actionId && !a.archived_at)) continue;
    const shareOps = opsShareTask(next, actionId, goalId);
    all.push(...shareOps);
    next = withOps(next, shareOps);
  }
  // A group: join the partner's, or start one with it.
  const partner = input.groupWithGoalId ? next.goals.find((g) => g.id === input.groupWithGoalId && !g.archived_at) : undefined;
  if (partner) {
    const mine = next.goals.find((g) => g.id === goalId)!;
    const groupOps = partner.group_id ? opsAddToGroup(next, goalId, partner.group_id) : opsCreateGroup(next, suggestGroupNames([partner, mine])[0]!, [partner.id, goalId]).ops;
    all.push(...groupOps);
    next = withOps(next, groupOps);
  }
  if (input.ideaId) all.push(...opsStartIdea(next, input.ideaId, goalId));
  return { ops: all, goalId };
}

/** A six-month season starting today, for someone with none running. */
export function opsStartSeason(name: string, today: ISODate): { ops: Op[]; plan: Plan } {
  return opsCreatePlan({ name: name.trim() || 'My six months', start: today, end: addDays(today, 182) });
}
