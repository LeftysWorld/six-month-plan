import { addDays, rankAtEnd, weekStart, type GoalIdea, type ISODate, type PaceCurve, type Plan, type StepLevel } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { View } from './derive.ts';
import { opsCreatePlan } from './ops.ts';
import { opsMakeGoal, type NewGoalInput } from './newGoal.ts';
import { defaultMonday, ladderPeriods, leadingNumber, opsCommitTasks, opsSaveTargets, targetsAt, type LadderPeriods, type TargetDraft, type TaskDraft } from './ladder.ts';
import { invertOps } from './planPack.ts';

/**
 * Planning an idea before it's a goal, and the gate on making it one.
 *
 * "Make it a goal" runs Plan this goal on the idea. What it is and when (the 6-month level), the
 * 3-month checkpoint and the first month must be set before the goal is made; when it starts within
 * two weeks, its first week and tasks are planned too. Until then everything is a draft kept on the
 * idea (goal_ideas.plan_draft), so you can plan a bit at any time and come back to it.
 *
 * The plan screens are the same ones a goal uses. They read a preview: the data as it would be
 * once the goal is made (built in memory, never saved), so suggestions, hours and periods work.
 */

/** What the goal will be made with (the Make a goal form, without its old week-goal and first-task fields). */
export type GoalDraftInput = Omit<NewGoalInput, 'weekGoal' | 'task' | 'ideaId'>;

export interface IdeaPlanDraft {
  v: 1;
  /** The id the goal will have, so the preview is the same goal each time. */
  goalId: string;
  /** The id a new season will have, when there is none running. */
  seasonId: string;
  seasonName: string;
  /** Saved once the 6-month step has been gone through. */
  what: boolean;
  input: GoalDraftInput;
  /** Running totals to count along the way ("150 applications"), due at the finish. */
  totals: string[];
  pace: PaceCurve;
  quarter: TargetDraft[];
  month: TargetDraft[];
  week: TargetDraft[];
  tasks: TaskDraft[];
}

const GOAL_COLORS = ['#5B8CFF', '#22B07D', '#FF7A45', '#E8559B', '#8B6CF6', '#3FB6C9'];

/** A fresh draft for an idea (or for a goal made from nothing), filled from what the idea already says. */
export function blankIdeaDraft(view: View, idea: GoalIdea | null, pathId: string | null): IdeaPlanDraft {
  const seasons = view.batches;
  const today = view.today;
  const planId = (idea?.plan_id && seasons.some((p) => p.id === idea.plan_id) ? idea.plan_id : null) ?? seasons.find((p) => p.start_date <= today)?.id ?? seasons[0]?.id ?? '';
  const count = planId ? view.goalsForPlan(planId).length : 0;
  return {
    v: 1,
    goalId: crypto.randomUUID(),
    seasonId: crypto.randomUUID(),
    seasonName: 'My six months',
    what: false,
    input: {
      title: idea?.title ?? '',
      type: 'finish',
      why: idea?.note ?? '',
      doneMeans: idea?.done_means ?? '',
      color: GOAL_COLORS[count % GOAL_COLORS.length]!,
      planId,
      start: idea?.plan_id === planId && idea?.planned_start ? idea.planned_start : null,
      finish: idea?.plan_id === planId && idea?.planned_end ? idea.planned_end : null,
      unit: '',
      measureName: '',
      baseline: null,
      target: null,
      targetDate: '',
      pathEdits: {},
      milestones: [],
      prize: '',
      prizeOnTime: '',
      shareActionIds: [],
      groupWithGoalId: null,
      groupId: idea?.group_id ?? null,
      pathId: pathId ?? idea?.path_id ?? null,
    },
    totals: [],
    pace: 'even',
    quarter: [],
    month: [],
    week: [],
    tasks: [],
  };
}

/** The idea's saved draft, or a fresh one. */
export function draftOf(view: View, idea: GoalIdea | null, pathId: string | null = null): IdeaPlanDraft {
  const d = idea?.plan_draft as IdeaPlanDraft | null | undefined;
  if (d && d.v === 1 && d.input && d.goalId) {
    const blank = blankIdeaDraft(view, idea, pathId);
    // The idea's own fields win: they may have been edited in the backlog since the draft was saved.
    const fromIdea = idea ? { title: idea.title, why: idea.note ?? '', doneMeans: idea.done_means ?? d.input.doneMeans ?? '', pathId: pathId ?? idea.path_id ?? null } : {};
    return { ...blank, ...d, input: { ...blank.input, ...d.input, ...fromIdea } };
  }
  return blankIdeaDraft(view, idea, pathId);
}

/** Replace every occurrence of one id with another in a value (ids are UUIDs, so this is exact). */
function remap<T>(value: T, from: string, to: string): T {
  if (from === to) return value;
  return JSON.parse(JSON.stringify(value).split(from).join(to)) as T;
}

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);

/** The season the goal goes in: the one picked, or a new six-month one starting today. */
function seasonFor(data: AppData, draft: IdeaPlanDraft, today: ISODate): { plan: Plan; ops: Op[] } {
  const existing = data.plans.find((p) => p.id === draft.input.planId && !p.archived_at);
  if (existing) return { plan: existing, ops: [] };
  const made = opsCreatePlan({ name: draft.seasonName.trim() || 'My six months', start: today, end: addDays(today, 182) });
  return { plan: remap(made.plan, made.plan.id, draft.seasonId), ops: remap(made.ops, made.plan.id, draft.seasonId) };
}

/** The goal as the draft describes it: made (with the totals as dates to hit), its pace set. Week goals and tasks come after. */
function opsGoalFrom(data: AppData, plan: Plan, draft: IdeaPlanDraft, ideaId: string | null, today: ISODate): Op[] {
  const end = draft.input.type !== 'number' && draft.input.finish ? draft.input.finish : plan.end_date;
  const totals = draft.totals.filter((t) => leadingNumber(t) != null).map((t) => ({ title: t.trim(), due_date: end }));
  const input: NewGoalInput = { ...draft.input, planId: plan.id, milestones: [...draft.input.milestones.filter((m) => m.title.trim()), ...totals], weekGoal: '', task: null, ideaId };
  const made = opsMakeGoal(data, plan, input, today);
  // The old one-step form also wrote an empty week goal; the plan's own targets replace it.
  const ops = made.ops.filter((op) => !(op.kind === 'insert' && op.collection === 'planSteps'));
  const out = remap(ops, made.goalId, draft.goalId);
  if (draft.pace !== 'even') out.push({ kind: 'update', collection: 'goals', id: draft.goalId, patch: { pace_curve: draft.pace } });
  return out;
}

export interface IdeaPreview {
  data: AppData;
  view: View;
  goal: NonNullable<ReturnType<View['goal']>>;
  plan: Plan;
  p: LadderPeriods;
  /** Starts this week or next: its first week and tasks are planned now. */
  soon: boolean;
}

/** Does a goal starting on `start` get its first week planned now (it starts this week or next)? */
export function startsSoon(start: ISODate, today: ISODate): boolean {
  return start <= addDays(weekStart(today), 13);
}

/** The data as it would be once the idea is a goal with its draft plan (in memory only). */
export function ideaPreview(data: AppData, draft: IdeaPlanDraft, today: ISODate, monday?: ISODate): IdeaPreview {
  const season = seasonFor(data, draft, today);
  let next = run(data, season.ops);
  next = run(next, opsGoalFrom(next, season.plan, draft, null, today));
  let view = new View(next, today, 0);
  const goal = view.goal(draft.goalId)!;
  const plan = next.plans.find((p) => p.id === season.plan.id)!;
  const p = ladderPeriods(view, goal, plan, monday ?? defaultMonday(view, goal, plan));
  for (const level of ['quarter', 'month', 'week'] as const) {
    if (draft[level].length) next = run(next, opsSaveTargets(next, goal, plan, level, p[level], draft[level]));
  }
  view = new View(next, today, 0);
  return { data: next, view, goal: view.goal(draft.goalId)!, plan, p, soon: startsSoon(view.startFor(goal, plan), today) };
}

/** What the plan still needs before the idea can be made a goal. Empty means it can. */
export function draftGaps(data: AppData, draft: IdeaPlanDraft, today: ISODate): string[] {
  const gaps: string[] = [];
  const i = draft.input;
  if (!i.title.trim()) gaps.push('a name');
  if (i.type === 'number' ? i.target == null || !i.targetDate || i.targetDate <= today : !i.doneMeans.trim()) gaps.push(i.type === 'number' ? 'a target and a date' : 'what done means');
  if (!draft.what) gaps.push('the 6-month step');
  const filled = (xs: TargetDraft[]) => xs.some((x) => x.text.trim() || x.value != null);
  if (!filled(draft.quarter)) gaps.push('a 3-month target');
  if (!filled(draft.month)) gaps.push('a month target');
  if (!data.plans.some((p) => p.id === i.planId && !p.archived_at) && data.plans.some((p) => !p.archived_at && p.end_date >= today)) gaps.push('a season');
  return gaps;
}

/** How far the plan has come, out of five (6 months, 3 months, month, week, tasks). The week and tasks count only once it starts soon. */
export function draftProgress(draft: IdeaPlanDraft | null | undefined): number {
  if (!draft || draft.v !== 1) return 0;
  const filled = (xs: TargetDraft[] | undefined) => (xs ?? []).some((x) => x.text.trim() || x.value != null);
  return [draft.what, filled(draft.quarter), filled(draft.month), filled(draft.week), (draft.tasks ?? []).length > 0].filter(Boolean).length;
}

/** Save the draft on the idea, and copy what the backlog shows (title, why, done means, season and dates). */
export function opsSaveDraft(idea: GoalIdea, draft: IdeaPlanDraft): Op[] {
  const i = draft.input;
  const patch: Record<string, unknown> = { plan_draft: draft };
  if (i.title.trim() && i.title.trim() !== idea.title) patch.title = i.title.trim();
  if (i.why.trim() !== (idea.note ?? '').trim()) patch.note = i.why.trim();
  if (i.doneMeans.trim() !== (idea.done_means ?? '').trim()) patch.done_means = i.doneMeans.trim();
  if ((i.pathId ?? null) !== (idea.path_id ?? null)) patch.path_id = i.pathId ?? null;
  if (draft.what && i.planId && i.planId !== idea.plan_id) patch.plan_id = i.planId;
  if (draft.what && i.planId) {
    if ((i.start ?? null) !== (idea.planned_start ?? null)) patch.planned_start = i.start ?? null;
    if ((i.finish ?? null) !== (idea.planned_end ?? null)) patch.planned_end = i.finish ?? null;
  }
  return [{ kind: 'update', collection: 'ideas', id: idea.id, patch }];
}

/** A new idea holding a draft: "Make a goal" from nothing starts as an idea, so leaving half-way keeps it in the backlog. */
export function opsNewIdeaWithDraft(data: AppData, draft: IdeaPlanDraft): { ops: Op[]; idea: GoalIdea } {
  const idea: GoalIdea = {
    id: crypto.randomUUID(),
    title: draft.input.title.trim() || 'Untitled goal',
    note: draft.input.why.trim(),
    done_means: draft.input.doneMeans.trim(),
    status: 'backlog',
    rank: rankAtEnd(data.ideas, 'backlog'),
    goal_id: null,
    created_at: new Date().toISOString(),
    started_at: null,
    path_id: draft.input.pathId ?? null,
    plan_draft: draft as unknown as Record<string, unknown>,
  };
  return { ops: [{ kind: 'insert', collection: 'ideas', rows: [idea as unknown as { id: string } & Record<string, unknown>] }], idea };
}

/**
 * Make the idea a goal from its plan: the season if there's none, the goal, its targets for each
 * level, the first week's tasks when it starts soon, and the idea marked started (draft cleared).
 * Throws with the gaps when the plan isn't far enough along.
 */
export function opsCommitIdea(data: AppData, idea: GoalIdea, draft: IdeaPlanDraft, today: ISODate): { ops: Op[]; undo: Op[]; goalId: string; tasks: number } {
  const gaps = draftGaps(data, draft, today);
  if (gaps.length) throw new Error(`Still needs ${gaps.join(', ')}.`);
  const ops: Op[] = [];
  let next = data;
  const add = (more: Op[]) => {
    ops.push(...more);
    next = run(next, more);
  };
  const season = seasonFor(next, draft, today);
  add(season.ops);
  add(opsGoalFrom(next, season.plan, draft, idea.id, today));
  const view = new View(next, today, 0);
  const goal = view.goal(draft.goalId)!;
  const plan = next.plans.find((p) => p.id === season.plan.id)!;
  const p = ladderPeriods(view, goal, plan, defaultMonday(view, goal, plan));
  // The first week is planned only when the goal starts this week or next; later, it's asked for once it's up next.
  const soon = startsSoon(view.startFor(goal, plan), today);
  for (const level of soon ? (['quarter', 'month', 'week'] as const) : (['quarter', 'month'] as const)) {
    if (draft[level].length) add(opsSaveTargets(next, goal, plan, level, p[level], draft[level]));
  }
  let tasks = 0;
  if (soon && draft.tasks.length) {
    const week = targetsAt(next, goal.id, plan.id, 'week', p.week.start);
    const t = opsCommitTasks(next, goal, p, week, draft.tasks, today);
    add(t.ops);
    tasks = t.made;
  }
  add([{ kind: 'update', collection: 'ideas', id: idea.id, patch: { plan_draft: null } }]);
  return { ops, undo: invertOps(data, ops), goalId: goal.id, tasks };
}

/** A goal that starts this week or next (not yet started) with nothing set for its first week: the Monday to plan, else null. */
export function firstWeekMissing(view: View, goal: NonNullable<ReturnType<View['goal']>>, plan: Plan): ISODate | null {
  const start = view.startFor(goal, plan);
  if (!startsSoon(start, view.today) || start < view.today) return null;
  const monday = defaultMonday(view, goal, plan);
  const p = ladderPeriods(view, goal, plan, monday);
  return targetsAt(view.data, goal.id, plan.id, 'week' as StepLevel, p.week.start).length === 0 ? monday : null;
}

/** Goals that start within two weeks with no goals set for their first week yet. */
export function firstWeekUnplanned(view: View): { goal: NonNullable<ReturnType<View['goal']>>; plan: Plan; monday: ISODate }[] {
  const out: { goal: NonNullable<ReturnType<View['goal']>>; plan: Plan; monday: ISODate }[] = [];
  for (const goal of view.activeGoals) {
    const plan = view.planForGoal(goal);
    const monday = plan ? firstWeekMissing(view, goal, plan) : null;
    if (plan && monday) out.push({ goal, plan, monday });
  }
  return out;
}
