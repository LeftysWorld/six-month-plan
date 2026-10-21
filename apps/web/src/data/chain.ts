import { addDays, chainAt, daysBetween, progressFor, type CascadeNode, type Goal, type ISODate, type Plan, type PlanStep } from '@six/core';
import type { AppData, Op } from './model.ts';
import { makeStep, suggestedTarget } from './breakdown.ts';
import { fmt, type View } from './derive.ts';

/**
 * The goal chain: each goal has one 6-month goal (the goal itself) and, for the
 * current period only, one 3-month goal, one month goal and one week goal.
 * Steps are created when you first set them, not for every month and week up front.
 */

export type ChainLevel = 'quarter' | 'month' | 'week';
export const CHAIN_LEVELS: ChainLevel[] = ['quarter', 'month', 'week'];
export const LEVEL_NAME: Record<ChainLevel, string> = { quarter: '3-month goal', month: 'This month', week: 'This week' };

export interface ChainLink {
  level: ChainLevel;
  node: CascadeNode;
  /** The saved step for this period, if one has been set. */
  step: PlanStep | null;
  /** For number goals: where the path says you should be at the end of the period. */
  suggested: number | null;
}

export type Chain = Record<ChainLevel, ChainLink>;

function findStep(data: AppData, goal: Goal, plan: Plan, level: ChainLevel, node: CascadeNode): PlanStep | null {
  return data.planSteps.find((s) => s.goal_id === goal.id && s.plan_id === plan.id && s.level === level && s.start_date === node.start) ?? null;
}

/** The chain for a goal on a date (today, or a later date when planning ahead). */
export function chainFor(data: AppData, goal: Goal, plan: Plan, date: ISODate): Chain {
  const periods = chainAt(plan, date);
  const link = (level: ChainLevel): ChainLink => {
    const node = periods[level];
    return { level, node, step: findStep(data, goal, plan, level, node), suggested: suggestedTarget(data, goal, plan, node.end) };
  };
  return { quarter: link('quarter'), month: link('month'), week: link('week') };
}

/** Has this period's goal been written down? */
export function isSet(link: ChainLink): boolean {
  return !!link.step && (link.step.target_note.trim() !== '' || link.step.target_value != null);
}

/** A step object for a period that hasn't been saved yet (inserted the first time it's needed). */
export function stepFor(goal: Goal, plan: Plan, chain: Chain, level: ChainLevel): PlanStep {
  const link = chain[level];
  if (link.step) return link.step;
  const parentLevel = level === 'week' ? 'month' : level === 'month' ? 'quarter' : null;
  const parent = parentLevel ? chain[parentLevel].step?.id ?? null : null;
  return makeStep(goal, plan, parent, level, link.node.idx, link.node.title, link.node, link.suggested);
}

/** Ops that save a not-yet-saved step (nothing if it already exists). */
export function opsEnsureStep(data: AppData, step: PlanStep): Op[] {
  return data.planSteps.some((s) => s.id === step.id) ? [] : [{ kind: 'insert', collection: 'planSteps', rows: [step as unknown as { id: string } & Record<string, unknown>] }];
}

/** Set (or change) the goal for one level of the current chain. */
export function opsSetLevel(
  data: AppData,
  goal: Goal,
  plan: Plan,
  chain: Chain,
  level: ChainLevel,
  patch: { target_note?: string; target_value?: number | null },
): Op[] {
  const link = chain[level];
  if (link.step) return [{ kind: 'update', collection: 'planSteps', id: link.step.id, patch }];
  const step = { ...stepFor(goal, plan, chain, level), ...patch };
  return [{ kind: 'insert', collection: 'planSteps', rows: [step as unknown as { id: string } & Record<string, unknown>] }];
}

/** Start a new goal's chain with sensible defaults, so it's useful before you edit anything. */
export function opsStartChain(data: AppData, goal: Goal, plan: Plan, today: ISODate, notes: Partial<Record<ChainLevel, string>>): Op[] {
  let chain = chainFor(data, goal, plan, today);
  const ops: Op[] = [];
  for (const level of CHAIN_LEVELS) {
    if (chain[level].step) continue;
    const step = { ...stepFor(goal, plan, chain, level), target_note: notes[level] ?? '' };
    ops.push({ kind: 'insert', collection: 'planSteps', rows: [step as unknown as { id: string } & Record<string, unknown>] });
    chain = { ...chain, [level]: { ...chain[level], step } };
  }
  return ops;
}

/** Levels of the current chain that still need a goal written down. */
export function chainGaps(chain: Chain): ChainLevel[] {
  return CHAIN_LEVELS.filter((l) => !isSet(chain[l]));
}

/**
 * What gets a goal back on pace this month, in plain words, or null when it's on pace.
 * e.g. "1 extra a week for the next 3 weeks catches you up" or "1.3 lb a week reaches 207.8 by Nov 1".
 */
export function catchUp(view: View, data: AppData, goal: Goal, plan: Plan, today: ISODate): string | null {
  if (plan.start_date > today || view.tooEarly(plan)) return null;
  const { month } = chainAt(plan, today);
  const daysLeft = Math.max(1, daysBetween(today, month.end) + 1);
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  if (goal.type === 'number') {
    const status = view.goalPace(goal, plan).number;
    if (!status || status.aheadBy == null || status.aheadBy >= 0) return null;
    const now = status.trend ?? status.latest;
    const step = chainFor(data, goal, plan, today).month;
    const target = step.step?.target_value ?? step.suggested;
    if (now == null || target == null) return null;
    const perWeek = Math.abs(Number(target) - now) / Math.max(1, daysLeft / 7);
    return `${fmt(perWeek)} ${goal.unit ?? ''} a week reaches ${fmt(Number(target))} by ${shortish(month.end)}.`;
  }
  if (goal.type === 'finish') {
    const overdue = data.milestones.filter((m) => m.goal_id === goal.id && !m.completed_at && m.due_date < today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    if (!overdue.length) return null;
    return overdue.length === 1 ? `Finish "${overdue[0]!.title}" this week to get back on track.` : `${overdue.length} milestones are overdue. Finish the oldest first.`;
  }
  const p = progressFor(view.sessionsForGoal(goal.id), { start: month.start, end: today }, { today, dayFraction: 0 });
  const gap = Math.round(p.expected - p.actual);
  if (p.label !== 'behind' || gap < 1) return null;
  if (weeksLeft === 1) return `${gap} extra this week catches you up.`;
  const per = Math.ceil(gap / weeksLeft);
  const weeks = Math.ceil(gap / per);
  return `${per} extra a week for the next ${weeks} week${weeks === 1 ? '' : 's'} catches you up.`;
}

function shortish(d: ISODate): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
}

/** The chain for the period after the current one ends (used when planning next week in the review). */
export function nextWeekStart(today: ISODate): ISODate {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, 7 - dow);
}
