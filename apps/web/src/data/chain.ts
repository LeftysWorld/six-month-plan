import { addDays, chainAt, daysBetween, progressFor, shortDate, weekStart, type CascadeNode, type Goal, type ISODate, type PaceLabel, type Plan, type PlanStep, type Session } from '@six/core';
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
export function opsStartChain(
  data: AppData,
  goal: Goal,
  plan: Plan,
  today: ISODate,
  notes: Partial<Record<ChainLevel, string>>,
  values: Partial<Record<ChainLevel, number | null>> = {},
): Op[] {
  let chain = chainFor(data, goal, plan, today);
  const ops: Op[] = [];
  for (const level of CHAIN_LEVELS) {
    if (chain[level].step) continue;
    const base = stepFor(goal, plan, chain, level);
    const step = { ...base, target_note: notes[level] ?? '', target_value: values[level] !== undefined ? values[level] : base.target_value };
    ops.push({ kind: 'insert', collection: 'planSteps', rows: [step as unknown as { id: string } & Record<string, unknown>] });
    chain = { ...chain, [level]: { ...chain[level], step } };
  }
  return ops;
}

export interface CatchUp {
  /** One plain sentence, e.g. "1 extra a week for the next 3 weeks catches you up." */
  text: string;
  /** How many extra tasks to schedule this week (null when extra tasks aren't the fix). */
  extra: number | null;
}

/**
 * What gets a goal back on pace this month, or null when it's on pace.
 * Task-based goals get a number of extra tasks for this week, which "Add N this week" schedules.
 */
export function catchUpPlan(view: View, data: AppData, goal: Goal, plan: Plan, today: ISODate): CatchUp | null {
  if (view.startFor(goal, plan) > today || view.tooEarly(plan, goal)) return null;
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
    return { text: `${fmt(perWeek)} ${goal.unit ?? ''} a week reaches ${fmt(Number(target))} by ${shortish(month.end)}.`, extra: null };
  }
  if (goal.type === 'finish') {
    const overdue = data.milestones.filter((m) => m.goal_id === goal.id && !m.completed_at && m.due_date < today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    if (!overdue.length) return null;
    return {
      text: overdue.length === 1 ? `Finish "${overdue[0]!.title}" this week to get back on track.` : `${overdue.length} milestones are overdue. Finish the oldest first.`,
      extra: null,
    };
  }
  const p = progressFor(view.sessionsForGoal(goal.id), { start: month.start, end: today }, { today, dayFraction: 0 });
  const gap = Math.round(p.expected - p.actual);
  if (p.label !== 'behind' || gap < 1) return null;
  if (!mainAction(view, data, goal, today)) return { text: `${gap} behind this month. Add a daily task to catch up.`, extra: null };
  if (weeksLeft === 1) return { text: `${gap} extra this week catches you up.`, extra: gap };
  const per = Math.ceil(gap / weeksLeft);
  const weeks = Math.ceil(gap / per);
  return { text: `${per} extra a week for the next ${weeks} week${weeks === 1 ? '' : 's'} catches you up.`, extra: per };
}

/** The catch-up sentence alone (see catchUpPlan). */
export function catchUp(view: View, data: AppData, goal: Goal, plan: Plan, today: ISODate): string | null {
  return catchUpPlan(view, data, goal, plan, today)?.text ?? null;
}

/** The goal's main task this week: the one with the most sessions (ties: the priority one). */
function mainAction(view: View, data: AppData, goal: Goal, today: ISODate) {
  const monday = weekStart(today);
  const count = new Map<string, number>();
  for (const s of view.sessionsForGoal(goal.id)) {
    if (s.action_id && (s.date ? weekStart(s.date) : s.week_start) === monday) count.set(s.action_id, (count.get(s.action_id) ?? 0) + 1);
  }
  const actions = view.actionsForGoal(goal.id).filter((a) => !a.archived_at);
  if (!actions.length) return null;
  return [...actions].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || Number(b.priority) - Number(a.priority))[0]!;
}

/**
 * Schedule `n` extra sessions of the goal's main task on the rest of this week,
 * on the days with the fewest of that goal's tasks (never twice on a day if it can be helped).
 * Returns the ops and the days used.
 */
export function opsAddExtra(view: View, data: AppData, goal: Goal, today: ISODate, n: number): { ops: Op[]; days: ISODate[] } {
  const action = mainAction(view, data, goal, today);
  if (!action || n < 1) return { ops: [], days: [] };
  const monday = weekStart(today);
  const days: ISODate[] = [];
  for (let d = today; d <= addDays(monday, 6); d = addDays(d, 1)) days.push(d);
  const goalSessions = view.sessionsForGoal(goal.id).filter((s) => s.status !== 'moved');
  const load = new Map(days.map((d) => [d, goalSessions.filter((s) => s.date === d).length]));
  const hasAction = new Set(goalSessions.filter((s) => s.action_id === action.id && s.date).map((s) => s.date!));
  const usedSlots = data.sessions.filter((s) => s.action_id === action.id && s.week_start === monday && s.origin === 'oneoff').length;
  const picked: ISODate[] = [];
  for (let i = 0; i < n; i++) {
    const day = [...days].sort((a, b) => Number(hasAction.has(a)) - Number(hasAction.has(b)) || load.get(a)! - load.get(b)! || (a < b ? -1 : 1))[0]!;
    picked.push(day);
    hasAction.add(day);
    load.set(day, load.get(day)! + 1);
  }
  const sessions: Session[] = picked.map((date, i) => ({
    id: crypto.randomUUID(),
    action_id: action.id,
    week_start: monday,
    slot: 500 + usedSlots + i,
    date,
    title: action.title,
    priority: false,
    planned_minutes: action.planned_minutes,
    planned_count: action.planned_count,
    status: 'planned',
    actual_minutes: null,
    actual_count: null,
    note: '',
    obstacles: [],
    origin: 'oneoff',
    source: 'catch-up',
    moved_from: null,
    logged_at: null,
  }));
  return { ops: [{ kind: 'insert', collection: 'sessions', rows: sessions as unknown as ({ id: string } & Record<string, unknown>)[] }], days: [...picked].sort() };
}

/** How one period of the chain is going, in a few words, with a pace label. */
export function periodStatus(view: View, data: AppData, goal: Goal, plan: Plan, link: ChainLink, today: ISODate): { text: string; label: PaceLabel } | null {
  const node = link.node;
  if (node.start > today) return { text: `Starts ${shortDate(node.start)}`, label: 'none' };
  if (goal.type === 'number') {
    const n = view.goalPace(goal, plan).number;
    const target = link.step?.target_value ?? link.suggested;
    if (!n || n.latest == null || target == null) return null;
    return { text: `${fmt(n.trend ?? n.latest)} now · aiming for ${fmt(Number(target))}`, label: n.label };
  }
  if (goal.type === 'finish') {
    const ms = data.milestones.filter((m) => m.goal_id === goal.id && m.due_date >= node.start && m.due_date <= node.end);
    if (ms.length) return { text: `${ms.filter((m) => m.completed_at).length} of ${ms.length} milestones`, label: 'none' };
  }
  const p = progressFor(view.projectedSessions(node).filter((s) => view.goalsForAction(s.action_id).some((g) => g.id === goal.id)), node, { today, dayFraction: 0 });
  if (p.planned === 0) return { text: 'No tasks yet', label: 'none' };
  return { text: `${fmt(p.actual, 0)} of ${p.planned} done`, label: p.label };
}

function shortish(d: ISODate): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
}

