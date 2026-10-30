import {
  MAX_TARGETS,
  addDays,
  chainAt,
  daysBetween,
  isoWeekday,
  shortDate,
  tallyOf,
  totalBy,
  weekNeeds,
  weekStart,
  weekToPlan,
  type Action,
  type ActionSchedule,
  type CascadeNode,
  type Goal,
  type ISODate,
  type Milestone,
  type PaceCurve,
  type Plan,
  type PlanStep,
  type Session,
  type StepLevel,
} from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { fmt, minutesText, type View } from './derive.ts';
import { opsEnsureWeek } from './ops.ts';
import { suggestedTarget } from './breakdown.ts';
import { invertOps } from './planPack.ts';
import { tallyUnit } from './tally.ts';

/**
 * Plan this goal: the ladder from the finish back to this week.
 *   6 months (the goal) → 3 months → this month → this week → the week's tasks
 * Each level holds up to three targets (plan_steps rows, one per slot) and each answers to one
 * above it (parent_id). The week's tasks are actions linked to the week target they serve
 * (step_id). Suggestions come from the level above and from the hours you have.
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;
const rows = <T extends { id: string }>(items: T[]): Row[] => items as unknown as Row[];

export type LadderStep = 'start' | 'season' | 'quarter' | 'month' | 'week' | 'tasks' | 'review';
export type TargetLevel = Extract<StepLevel, 'quarter' | 'month' | 'week'>;
export const LADDER_STEPS: Exclude<LadderStep, 'start' | 'review'>[] = ['season', 'quarter', 'month', 'week', 'tasks'];

export function isLadderStep(s: string | null): s is LadderStep {
  return s === 'start' || s === 'review' || (LADDER_STEPS as string[]).includes(s ?? '');
}

// ---------- Periods ----------

export interface LadderPeriods {
  /** Where the goal's own run starts and ends inside its season. */
  start: ISODate;
  end: ISODate;
  quarter: CascadeNode;
  month: CascadeNode;
  week: CascadeNode;
  /** Monday of the week being planned. */
  monday: ISODate;
}

/** The Monday to plan by default: this week until Wednesday, then next week; inside the goal's run. */
export function defaultMonday(view: View, goal: Goal, plan: Plan): ISODate {
  const { start, end } = view.plannedWindow(goal, plan);
  let monday = weekToPlan(view.today);
  if (addDays(monday, 6) < start) monday = weekStart(start);
  if (monday > end) monday = weekStart(end < view.today ? end : view.today);
  return monday;
}

/** The 3-month stage, month and week a planned week falls in, clipped to the goal's own run. */
export function ladderPeriods(view: View, goal: Goal, plan: Plan, monday: ISODate): LadderPeriods {
  const { start, end } = view.plannedWindow(goal, plan);
  const at = monday < plan.start_date ? plan.start_date : monday > plan.end_date ? plan.end_date : monday;
  const chain = chainAt(plan, at);
  // "This month" is the month you'd plan if you started Monday: once the current one has less than
  // about three weeks left, it's the next one. Same for the 3-month checkpoint, six weeks out.
  const ahead = (node: CascadeNode, level: 'quarter' | 'month', days: number): CascadeNode => {
    if (node.end >= addDays(monday, days) || node.end >= plan.end_date) return node;
    return chainAt(plan, addDays(node.end, 1))[level];
  };
  return { start, end, quarter: ahead(chain.quarter, 'quarter', 42), month: ahead(chain.month, 'month', 20), week: chain.week, monday };
}

/** "by Nov 29": the day a period closes for this goal (its own finish if that comes first). */
export function periodEnd(p: LadderPeriods, node: CascadeNode): ISODate {
  return node.end > p.end ? p.end : node.end;
}

// ---------- Targets ----------

/** A period's targets for a goal, in slot order. */
export function targetsAt(data: AppData, goalId: string, planId: string, level: StepLevel, start: ISODate): PlanStep[] {
  return data.planSteps
    .filter((s) => s.goal_id === goalId && s.plan_id === planId && s.level === level && s.start_date === start)
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}

/** The targets set for each level of the ladder at a planned week. */
export function ladderTargets(data: AppData, goal: Goal, plan: Plan, p: LadderPeriods): Record<TargetLevel, PlanStep[]> {
  return {
    quarter: targetsAt(data, goal.id, plan.id, 'quarter', p.quarter.start).filter(hasText),
    month: targetsAt(data, goal.id, plan.id, 'month', p.month.start).filter(hasText),
    week: targetsAt(data, goal.id, plan.id, 'week', p.week.start).filter(hasText),
  };
}

function hasText(s: PlanStep): boolean {
  return s.target_note.trim() !== '' || s.target_value != null;
}

/** Has the goal been planned down (a 3-month or month target for the current periods)? */
export function isPlannedDown(view: View, goal: Goal, plan: Plan): boolean {
  const p = ladderPeriods(view, goal, plan, defaultMonday(view, goal, plan));
  const t = ladderTargets(view.data, goal, plan, p);
  return t.quarter.length > 0 || t.month.length > 0;
}

/** One target as you edit it. */
export interface TargetDraft {
  id: string;
  text: string;
  doneMeans: string;
  value: number | null;
  parentId: string | null;
}

export function draftsFrom(steps: PlanStep[]): TargetDraft[] {
  return steps.map((s) => ({ id: s.id, text: s.target_note, doneMeans: s.done_means ?? '', value: s.target_value != null ? Number(s.target_value) : null, parentId: s.parent_id }));
}

export function blankTarget(parentId: string | null = null): TargetDraft {
  return { id: newId(), text: '', doneMeans: '', value: null, parentId };
}

/**
 * Save a period's targets: changed ones are updated, new ones inserted, removed ones deleted
 * (a task linked to a removed target keeps running, unlinked). Blank drafts are dropped.
 */
export function opsSaveTargets(data: AppData, goal: Goal, plan: Plan, level: TargetLevel, node: CascadeNode, drafts: TargetDraft[]): Op[] {
  const existing = targetsAt(data, goal.id, plan.id, level, node.start);
  const keep = drafts.filter((d) => d.text.trim() !== '' || d.value != null).slice(0, MAX_TARGETS);
  const ops: Op[] = [];
  keep.forEach((d, slot) => {
    const row = existing.find((s) => s.id === d.id);
    const fields = { target_note: d.text.trim(), done_means: d.doneMeans.trim(), target_value: d.value, parent_id: d.parentId, slot };
    if (row) {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) if ((row as unknown as Record<string, unknown>)[k] !== v && !(k === 'done_means' && (row.done_means ?? '') === v)) patch[k] = v;
      if (Object.keys(patch).length) ops.push({ kind: 'update', collection: 'planSteps', id: row.id, patch });
    } else {
      const step: PlanStep = { id: d.id, goal_id: goal.id, plan_id: plan.id, level, idx: node.idx, title: node.title, start_date: node.start, end_date: node.end, completed_at: null, ...fields };
      ops.push({ kind: 'insert', collection: 'planSteps', rows: rows([step]) });
    }
  });
  for (const row of existing) {
    if (keep.some((d) => d.id === row.id)) continue;
    for (const a of data.actions.filter((x) => x.step_id === row.id)) ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { step_id: null } });
    for (const child of data.planSteps.filter((x) => x.parent_id === row.id)) ops.push({ kind: 'update', collection: 'planSteps', id: child.id, patch: { parent_id: null } });
    ops.push({ kind: 'delete', collection: 'planSteps', id: row.id });
  }
  return ops;
}

/** Tick a target done, or reopen it. */
export function opsToggleTarget(step: PlanStep): Op[] {
  return [{ kind: 'update', collection: 'planSteps', id: step.id, patch: { completed_at: step.completed_at ? null : new Date().toISOString() } }];
}

/** A target as one line: "75 applications", "207.8 lb · Lock in the eating window". */
export function targetText(goal: Goal, s: Pick<PlanStep, 'target_note' | 'target_value'>): string {
  const value = goal.type === 'number' && s.target_value != null ? `${fmt(Number(s.target_value))} ${goal.unit ?? ''}`.trim() : '';
  const note = s.target_note.trim();
  if (value && note && !note.includes(fmt(Number(s.target_value)))) return `${value} · ${note}`;
  return note || value;
}

// ---------- Running totals and pace ----------

export interface GoalTotal {
  milestone: Milestone;
  target: number;
  /** "applications" from "150 applications". */
  unit: string;
  /** The count task it's counted from, once there is one. */
  actionId: string | null;
  /** The total logged so far (0 until a count task is linked). */
  now: number;
}

/** A number at the start of a title that isn't a year: "150 applications" → 150. */
export function leadingNumber(title: string): number | null {
  const n = Number((title.match(/^\s*([\d,]+)\b/)?.[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0 || (n >= 1900 && n <= 2100)) return null;
  return n;
}

/** "applications" → "application" for a count of one. */
export function singular(unit: string): string {
  return /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit;
}

/** The goal's headline running total ("150 applications"), linked to a count task or not yet. */
export function goalTotal(data: AppData, goal: Goal, today: ISODate): GoalTotal | null {
  if (goal.type === 'number') return null;
  const ms = data.milestones
    .filter((m) => m.goal_id === goal.id)
    .map((m) => ({ m, target: m.value != null && Number(m.value) > 0 ? Number(m.value) : leadingNumber(m.title) }))
    .filter((x): x is { m: Milestone; target: number } => x.target != null)
    .sort((a, b) => b.target - a.target || (a.m.due_date < b.m.due_date ? 1 : -1));
  const top = ms[0];
  if (!top) return null;
  const actionId = top.m.count_action_id ?? null;
  return { milestone: top.m, target: top.target, unit: tallyUnit(top.m) || 'done', actionId, now: actionId ? tallyOf(data.sessions, actionId, today) : 0 };
}

export function curveOf(goal: Goal): PaceCurve {
  return goal.pace_curve === 'ramp' || goal.pace_curve === 'front' ? goal.pace_curve : 'even';
}

/** One suggested target for a level. */
export interface Suggestion {
  key: string;
  text: string;
  value: number | null;
  doneMeans: string;
  /** Where it came from, in a few words. */
  why: string;
  parentId: string | null;
}

/**
 * Suggestions for a level, from the level above and the goal's numbers:
 * - a number goal: where its path says you'll be at the period's end;
 * - a running total: where the pace curve puts it (a week: what's left of the month, spread over the weeks left);
 * - dates to hit that fall in the period;
 * - for the month and week: a step toward each target above that has no number.
 */
export function suggestionsFor(view: View, goal: Goal, plan: Plan, level: TargetLevel, p: LadderPeriods, parents: PlanStep[]): Suggestion[] {
  const data = view.data;
  const today = view.today;
  const node = p[level];
  const end = periodEnd(p, node);
  const out: Suggestion[] = [];
  const parentFor = (value: number | null) => parents.find((s) => s.target_value != null && value != null)?.id ?? parents[0]?.id ?? null;
  if (goal.type === 'number') {
    const v = suggestedTarget(data, goal, plan, end);
    if (v != null) {
      const down = goal.target_value != null && goal.baseline_value != null && Number(goal.target_value) < Number(goal.baseline_value);
      out.push({ key: 'path', text: `${fmt(v)} ${goal.unit ?? ''}`.trim(), value: v, doneMeans: `a reading ${down ? 'at or under' : 'at or over'} ${fmt(v)}`, why: `On your path by ${shortDate(end)}`, parentId: parentFor(v) });
    }
  }
  const total = goalTotal(data, goal, today);
  if (total) {
    if (level === 'week') {
      const month = targetsAt(data, goal.id, plan.id, 'month', p.month.start).find((s) => s.target_value != null);
      const monthEnd = periodEnd(p, p.month);
      const periodTarget = month ? Number(month.target_value) : totalBy(total.target, curveOf(goal), p.start, p.end, monthEnd);
      const now = total.actionId ? tallyOf(data.sessions, total.actionId, addDays(p.monday, -1)) : total.now;
      const need = weekNeeds(periodTarget, now, p.monday, monthEnd);
      if (need > 0) {
        const weeksLeft = Math.max(1, Math.ceil((daysBetween(p.monday, monthEnd) + 1) / 7));
        out.push({
          key: 'total',
          text: `${need} ${need === 1 ? singular(total.unit) : total.unit}`,
          value: now + need,
          doneMeans: `the running total reads ${now + need}`,
          why: `${now} of ${periodTarget} by ${shortDate(monthEnd)} · ${periodTarget - now} to go in ${weeksLeft} week${weeksLeft === 1 ? '' : 's'}`,
          parentId: month?.id ?? parentFor(1),
        });
      }
    } else {
      const by = totalBy(total.target, curveOf(goal), p.start, p.end, end);
      out.push({
        key: 'total',
        text: `${by} ${total.unit}`,
        value: by,
        doneMeans: `the running total reads ${by}`,
        why: `${Math.round((by / total.target) * 100)}% of ${total.target} by ${shortDate(end)} (${curveOf(goal) === 'even' ? 'even pace' : curveOf(goal) === 'ramp' ? 'ramping up' : 'front-loaded'})`,
        parentId: parentFor(by),
      });
    }
  }
  const from = level === 'week' ? p.monday : node.start;
  for (const m of view.milestonesOf(goal.id)) {
    if (m.completed_at || m.due_date < from || m.due_date > end || m.id === total?.milestone.id) continue;
    out.push({ key: `m-${m.id}`, text: m.title, value: null, doneMeans: 'ticked off on the goal page', why: `Date to hit · ${shortDate(m.due_date)}`, parentId: parents[0]?.id ?? null });
  }
  if (level !== 'quarter') {
    for (const parent of parents) {
      if (parent.target_value != null && total) continue;
      out.push({ key: `p-${parent.id}`, text: `Step toward: ${parent.target_note.trim()}`, value: null, doneMeans: '', why: level === 'week' ? 'From this month' : 'From the 3-month checkpoint', parentId: parent.id });
    }
  }
  return out.slice(0, 5);
}

// ---------- Hours ----------

/** Planned minutes per goal in a week (existing and projected sessions), plus one-offs with no goal. */
export function weekMinutesByGoal(view: View, monday: ISODate): Map<string | null, number> {
  const sunday = addDays(monday, 6);
  const out = new Map<string | null, number>();
  for (const s of view.projectedSessions({ start: monday, end: sunday })) {
    if (s.status === 'moved' || s.status === 'skipped') continue;
    const day = s.date ?? s.week_start;
    if (day < monday || day > sunday) continue;
    const goals = view.goalsForAction(s.action_id).filter((g) => !g.archived_at);
    // A shared task counts once, for its first goal.
    const key = goals[0]?.id ?? null;
    out.set(key, (out.get(key) ?? 0) + s.planned_minutes);
  }
  return out;
}

export interface Hours {
  /** Minutes a week you said you have (Settings). */
  available: number;
  /** Other goals' minutes, biggest first. */
  others: { goal: Goal; minutes: number }[];
  /** Minutes with no goal (one-offs, habits are not counted). */
  loose: number;
  /** What's left for this goal. */
  left: number;
  /** What this goal has planned that week already. */
  mine: number;
}

/** A week's hours: what you have, what other goals take, and what's left for this one. */
export function hoursFor(view: View, goal: Goal, monday: ISODate): Hours {
  const available = view.data.profile.available_minutes.reduce((a, b) => a + b, 0);
  const by = weekMinutesByGoal(view, monday);
  const others = [...by.entries()]
    .filter(([id]) => id && id !== goal.id)
    .map(([id, minutes]) => ({ goal: view.goal(id!)!, minutes }))
    .filter((x) => x.goal)
    .sort((a, b) => b.minutes - a.minutes);
  const loose = by.get(null) ?? 0;
  const taken = others.reduce((s, x) => s + x.minutes, 0) + loose;
  return { available, others, loose, left: Math.max(0, available - taken), mine: by.get(goal.id) ?? 0 };
}

/** Average weekly minutes of the other goals over a range of weeks (for "Also in these 3 months"). */
export function othersOverRange(view: View, goal: Goal, from: ISODate, to: ISODate): { goal: Goal; minutes: number; starts: ISODate | null }[] {
  const totals = new Map<string, number>();
  let weeks = 0;
  for (let monday = weekStart(from); monday <= to && weeks < 14; monday = addDays(monday, 7)) {
    weeks += 1;
    for (const [id, m] of weekMinutesByGoal(view, monday)) if (id && id !== goal.id) totals.set(id, (totals.get(id) ?? 0) + m);
  }
  return [...totals.entries()]
    .map(([id, m]) => {
      const g = view.goal(id);
      const plan = g ? view.planForGoal(g) : null;
      const starts = g && plan ? view.startFor(g, plan) : null;
      return { goal: g!, minutes: Math.round(m / Math.max(1, weeks)), starts: starts && starts > from ? starts : null };
    })
    .filter((x) => x.goal && x.minutes > 0 && !x.goal.archived_at && !x.goal.completed_at)
    .sort((a, b) => b.minutes - a.minutes);
}

export function hoursText(min: number): string {
  return min < 60 ? `${min} m` : minutesText(min);
}

// ---------- The week's tasks ----------

export type TaskRepeat = 'week' | 'month' | 'open';

/** A task you're planning, before it's saved. */
export interface TaskDraft {
  key: string;
  title: string;
  minutes: number;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  kind: 'check' | 'count';
  /** For a count task: how many each time (adds to the running total). */
  count: number | null;
  /** Which week target it serves (its slot, 0–2), or null. */
  target: number | null;
  repeat: TaskRepeat;
}

export function blankTask(target: number | null, day?: number): TaskDraft {
  return { key: newId(), title: '', minutes: 30, days: day ? [day] : [], kind: 'check', count: null, target, repeat: 'week' };
}

/** A task placed on a day of the planned week, for the grid and the fit check. */
export interface WeekChip {
  key: string;
  /** Same task on another day shares this. */
  taskKey: string;
  title: string;
  minutes: number;
  date: ISODate;
  /** This goal's (planned now, or already running), or another goal's. */
  mine: boolean;
  /** The week target it serves (its slot), for this goal's tasks. */
  target: number | null;
  draftKey: string | null;
  actionId: string | null;
  color: string;
}

/** Everything on each day of the planned week: what's already there, and the tasks you're planning. */
export function weekChips(view: View, goal: Goal, monday: ISODate, weekTargets: PlanStep[], drafts: TaskDraft[]): WeekChip[] {
  const sunday = addDays(monday, 6);
  const out: WeekChip[] = [];
  for (const s of view.projectedSessions({ start: monday, end: sunday })) {
    if (s.status === 'moved' || s.status === 'skipped' || !s.date || s.date < monday || s.date > sunday) continue;
    const goals = view.goalsForAction(s.action_id);
    const mine = goals.some((g) => g.id === goal.id);
    const action = view.action(s.action_id);
    const slot = mine && action?.step_id ? weekTargets.findIndex((t) => t.id === action.step_id) : -1;
    out.push({ key: s.id, taskKey: s.action_id ?? s.id, title: s.title, minutes: s.planned_minutes, date: s.date, mine, target: slot >= 0 ? slot : null, draftKey: null, actionId: s.action_id, color: goals[0]?.color ?? '#9AA49E' });
  }
  for (const d of drafts) {
    if (!d.title.trim()) continue;
    for (const day of d.days) {
      out.push({ key: `${d.key}-${day}`, taskKey: d.key, title: d.title.trim(), minutes: d.minutes, date: addDays(monday, day - 1), mine: true, target: d.target, draftKey: d.key, actionId: null, color: goal.color });
    }
  }
  return out;
}

/** Undated "times a week" sessions of this goal in the planned week (they don't sit on a day yet). */
export function undatedInWeek(view: View, goal: Goal, monday: ISODate): Session[] {
  return view.sessionsForGoal(goal.id).filter((s) => !s.date && s.week_start === monday && s.status === 'planned');
}

/** Save the planned tasks: each becomes a task on its days, linked to its week target, then the week is filled in. */
export function opsCommitTasks(data: AppData, goal: Goal, p: LadderPeriods, weekTargets: PlanStep[], drafts: TaskDraft[], today: ISODate): { ops: Op[]; undo: Op[]; made: number } {
  const ops: Op[] = [];
  let next = data;
  const add = (more: Op[]) => {
    ops.push(...more);
    next = more.reduce(applyOp, next);
  };
  const sunday = addDays(p.monday, 6);
  const from = p.monday > today ? p.monday : today;
  let made = 0;
  const total = goalTotal(data, goal, today);
  for (const d of drafts) {
    if (!d.title.trim() || !d.days.length || from > sunday) continue;
    const step = d.target != null ? weekTargets[d.target] : undefined;
    const action: Action = {
      id: newId(),
      title: d.title.trim(),
      kind: d.kind,
      planned_minutes: Math.max(0, Math.round(d.minutes)),
      planned_count: d.kind === 'count' ? Math.max(1, d.count ?? 1) : null,
      min_label: '',
      min_minutes: null,
      min_count: null,
      priority: false,
      step_id: step?.id ?? null,
      archived_at: null,
    };
    const monthEnd = periodEnd(p, p.month);
    const schedule: ActionSchedule = {
      id: newId(),
      action_id: action.id,
      rule: 'days',
      days: [...new Set(d.days)].sort((a, b) => a - b),
      per_week: null,
      effective_from: from,
      effective_to: d.repeat === 'week' ? sunday : d.repeat === 'month' ? (monthEnd > sunday ? monthEnd : sunday) : null,
    };
    add([
      { kind: 'insert', collection: 'actions', rows: rows([action]) },
      { kind: 'insert', collection: 'schedules', rows: rows([schedule]) },
      { kind: 'insert', collection: 'actionGoals', rows: [{ id: newId(), action_id: action.id, goal_id: goal.id }] },
    ]);
    // The first count task feeds the goal's running total when nothing does yet.
    if (d.kind === 'count' && total && !total.actionId && !next.milestones.find((m) => m.id === total.milestone.id)?.count_action_id) {
      add([{ kind: 'update', collection: 'milestones', id: total.milestone.id, patch: { count_action_id: action.id, value: total.target } }]);
    }
    made += 1;
  }
  add(opsEnsureWeek(next, p.monday));
  if (weekStart(today) !== p.monday && weekStart(today) < p.monday) add(opsEnsureWeek(next, weekStart(today)));
  return { ops, undo: invertOps(data, ops), made };
}

/** Link a task that's already running to one of this week's targets (or unlink it). */
export function opsLinkTask(action: Action, stepId: string | null): Op[] {
  return action.step_id === stepId ? [] : [{ kind: 'update', collection: 'actions', id: action.id, patch: { step_id: stepId } }];
}

/** "Mon–Fri", "Mon, Wed, Fri", "Tue". */
export function daysLabel(days: number[]): string {
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 0) return 'No day yet';
  if (d.length === 7) return 'Every day';
  const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  return run ? `${names[d[0]!]}–${names[d.at(-1)!]}` : d.map((x) => names[x]).join(', ');
}

export function weekdayOf(date: ISODate): number {
  return isoWeekday(date);
}

// ---------- Drafts kept while you plan ----------

const DRAFT_PREFIX = 'six.ladder.v1';

export function loadTaskDrafts(goalId: string, monday: ISODate): TaskDraft[] {
  try {
    // Drafts for weeks long gone are dropped (a plan left half-done a month ago won't come back).
    const cutoff = addDays(monday, -35);
    for (const k of Object.keys(localStorage)) {
      const week = k.startsWith(`${DRAFT_PREFIX}.`) ? k.slice(-10) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(week) && week < cutoff) localStorage.removeItem(k);
    }
    const raw = localStorage.getItem(`${DRAFT_PREFIX}.${goalId}.${monday}`);
    const list = raw ? (JSON.parse(raw) as TaskDraft[]) : [];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.key === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTaskDrafts(goalId: string, monday: ISODate, drafts: TaskDraft[]): void {
  try {
    const key = `${DRAFT_PREFIX}.${goalId}.${monday}`;
    if (drafts.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    // storage blocked: the drafts last while the page is open
  }
}

// ---------- Summaries ----------

/** One line per level for the goal page and the overview. */
export function ladderSummary(data: AppData, goal: Goal, plan: Plan, p: LadderPeriods): { level: TargetLevel; end: ISODate; text: string; done: number; count: number }[] {
  const t = ladderTargets(data, goal, plan, p);
  return (['quarter', 'month', 'week'] as const).map((level) => ({
    level,
    end: periodEnd(p, p[level]),
    text: t[level].map((s) => targetText(goal, s)).join(' · '),
    done: t[level].filter((s) => s.completed_at).length,
    count: t[level].length,
  }));
}

/** Goals in live seasons that haven't been planned down yet. */
export function unplannedGoals(view: View, exceptId?: string): Goal[] {
  return view.activeGoals.filter((g) => {
    if (g.id === exceptId) return false;
    const plan = view.planForGoal(g);
    return !!plan && !isPlannedDown(view, g, plan);
  });
}
