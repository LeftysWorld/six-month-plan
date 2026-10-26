import {
  activeProjects,
  addDays,
  evenMilestones,
  isProject,
  readyAfter,
  shiftedDates,
  shortDate,
  wipLimit,
  type Closeout,
  type DodItem,
  type Goal,
  type GoalIdea,
  type ISODate,
  type Milestone,
  type RaidItem,
  type RaidKind,
} from '@six/core';
import type { AppData, Op } from './model.ts';
import { opsCompleteGoal, opsReopenGoal } from './ops.ts';

/**
 * Projects under goals, as ops. A project is a goal row with parent_id: temporary work with a
 * finish line (a course, an exam, a build) that, with its sibling projects, delivers the goal.
 * It runs in its goal's window, is measured by its milestones and has a short brief.
 */

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
type Row = { id: string } & Record<string, unknown>;
const row = <T extends { id: string }>(x: T): Row[] => [x as unknown as Row];

export interface ProjectInput {
  title: string;
  why?: string;
  done_means?: string;
  start_date: ISODate;
  target_date: ISODate;
  deadline?: ISODate | null;
  fixed_start?: boolean;
  fixed_deadline?: boolean;
  depends_on?: string[];
}

/** A new project under a goal. It starts "not started": starting it is its own step (WIP limit). */
export function opsCreateProject(parent: Goal, input: ProjectInput): { ops: Op[]; id: string } {
  const id = newId();
  const project: Goal = {
    id,
    title: input.title.trim(),
    type: 'finish',
    why: (input.why ?? '').trim(),
    done_means: (input.done_means ?? '').trim(),
    unit: null,
    baseline_value: null,
    baseline_date: null,
    target_value: null,
    target_date: input.target_date,
    color: parent.color,
    measurement_type_id: null,
    archived_at: null,
    parent_id: parent.id,
    start_date: input.start_date,
    deadline: input.deadline && input.deadline >= input.target_date ? input.deadline : null,
    fixed_start: !!input.fixed_start,
    fixed_deadline: !!input.fixed_deadline,
    depends_on: input.depends_on ?? [],
  };
  return { ops: [{ kind: 'insert', collection: 'goals', rows: row(project) }], id };
}

/** Turn a backlog idea into a project under a goal (the idea is marked started, pointing at it). */
export function opsIdeaToProject(data: AppData, idea: GoalIdea, parent: Goal, dates: { start: ISODate; end: ISODate }): { ops: Op[]; id: string } {
  const { ops, id } = opsCreateProject(parent, { title: idea.title, why: idea.note, done_means: idea.done_means ?? '', start_date: dates.start, target_date: dates.end });
  const rank = Math.max(0, ...data.ideas.filter((i) => i.status === 'started').map((i) => i.rank)) + 1;
  ops.push({ kind: 'update', collection: 'ideas', id: idea.id, patch: { status: 'started', goal_id: id, started_at: nowISO(), rank } });
  return { ops, id };
}

/** Projects active now (started, not finished or dropped) whose goal is still live. */
export function liveActiveProjects(data: AppData): Goal[] {
  const parentLive = (g: Goal) => {
    const parent = data.goals.find((x) => x.id === g.parent_id);
    return !!parent && !parent.archived_at && !parent.completed_at;
  };
  return activeProjects(data.goals).filter(parentLive);
}

export function wipStatus(data: AppData): { active: Goal[]; limit: number; full: boolean } {
  const active = liveActiveProjects(data);
  const limit = wipLimit(data.profile.project_wip_limit);
  return { active, limit, full: active.length >= limit };
}

/**
 * Start a project: it becomes active from today and its planned dates are saved as the baseline
 * (what slips are measured against). Starting over the WIP limit, or before a project it waits
 * on has finished, is allowed but written to the decision log with your reason.
 */
export function opsStartProject(data: AppData, project: Goal, today: ISODate, override?: { reason: string; why: 'wip' | 'waiting' | 'both' }): Op[] {
  const planned = project.start_date ?? today;
  const end = project.target_date ?? addDays(today, 90);
  const patch: Partial<Goal> = {
    started_at: nowISO(),
    baseline_start: planned,
    baseline_end: end,
    start_date: today,
    target_date: end < today ? today : end,
  };
  const ops: Op[] = [{ kind: 'update', collection: 'goals', id: project.id, patch }];
  if (planned !== today) ops.push(changeLog(project.id, `Started ${today < planned ? `early (planned ${shortDate(planned)})` : `late (planned ${shortDate(planned)})`}`, planned, today, today));
  if (override) {
    const { limit, active } = wipStatus(data);
    const what = override.why === 'waiting' ? 'before the project it waits on finished' : override.why === 'wip' ? `over the limit of ${limit} active projects (${active.length + 1} now)` : `over the WIP limit and before the project it waits on finished`;
    ops.push(...opsAddRaid(project.id, 'decision', `Started ${project.title} ${what}`, override.reason));
  }
  return ops;
}

/** Slips: each time a started project's target date moved later (from its change history). */
export function slipsOf(data: AppData, projectId: string): number {
  return data.changeLog.filter((c) => c.entity === 'project_target' && c.entity_id === projectId && String(c.new_value) > String(c.old_value)).length;
}

/**
 * Change a project's dates. Once it has started, moving the target is recorded (a slip when it
 * moves later), so the baseline-vs-now variance and the slip count stay honest.
 */
export function opsSetProjectDates(project: Goal, patch: Partial<Pick<Goal, 'start_date' | 'target_date' | 'deadline' | 'fixed_start' | 'fixed_deadline'>>, today: ISODate): Op[] {
  const clean: Partial<Goal> = { ...patch };
  const target = clean.target_date ?? project.target_date ?? null;
  if (clean.deadline !== undefined && clean.deadline && target && clean.deadline < target) clean.deadline = target;
  if (clean.target_date && (project.deadline ?? null) && clean.deadline === undefined && project.deadline! < clean.target_date) clean.deadline = clean.target_date;
  const ops: Op[] = [{ kind: 'update', collection: 'goals', id: project.id, patch: clean }];
  if (project.started_at && clean.target_date && project.target_date && clean.target_date !== project.target_date) {
    const later = clean.target_date > project.target_date;
    ops.push({
      kind: 'insert',
      collection: 'changeLog',
      rows: row({
        id: newId(),
        entity: 'project_target',
        entity_id: project.id,
        summary: `Target ${later ? 'slipped' : 'moved earlier'}: ${shortDate(project.target_date)} → ${shortDate(clean.target_date)}`,
        old_value: project.target_date,
        new_value: clean.target_date,
        effective_from: today,
        review_id: null,
        created_at: nowISO(),
      }),
    });
  }
  return ops;
}

/** Move a waiting project's flexible dates by `days` (its deadline too, unless that's fixed). */
export function opsShiftProject(project: Goal, days: number, today: ISODate): Op[] {
  const next = shiftedDates(project, days);
  return [
    { kind: 'update', collection: 'goals', id: project.id, patch: next },
    changeLog(project.id, `Moved ${days > 0 ? 'later' : 'earlier'} by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} to follow the project it waits on`, project.start_date ?? null, next.start_date ?? null, today),
  ];
}

export function opsSetDependencies(project: Goal, ids: string[]): Op[] {
  return [{ kind: 'update', collection: 'goals', id: project.id, patch: { depends_on: [...new Set(ids.filter((id) => id !== project.id))] } }];
}

/** Brief fields: scope, definition of done, pre-mortem, kill criteria, why and done. */
export function opsUpdateBrief(project: Goal, patch: Partial<Pick<Goal, 'title' | 'why' | 'done_means' | 'scope_in' | 'scope_out' | 'premortem' | 'kill_criteria' | 'dod' | 'benefit_question' | 'benefit_check_on' | 'benefit_result'>>): Op[] {
  return [{ kind: 'update', collection: 'goals', id: project.id, patch }];
}

export function opsSetDod(project: Goal, dod: DodItem[]): Op[] {
  return opsUpdateBrief(project, { dod: dod.filter((d) => d.text.trim()).map((d) => ({ text: d.text.trim(), done: d.done })) });
}

/**
 * Close a project: it's done (its own tasks come off your list, like completing a goal), the
 * close-out answers become a lesson for the next project, and a benefits check-back is set.
 * Projects that were waiting only on this one are returned so the app can offer to start them.
 */
export function opsCloseProject(data: AppData, project: Goal, closeout: Omit<Closeout, 'closed_on'>, benefit: { question: string; on: ISODate | null }, today: ISODate): { ops: Op[]; ready: Goal[] } {
  // Closed at a stage gate already? Then only the close-out answers are saved.
  const ops = project.completed_at ? [] : opsCompleteGoal(data, project, '', today);
  ops.push({
    kind: 'update',
    collection: 'goals',
    id: project.id,
    patch: {
      closeout: { worked: closeout.worked.trim(), didnt: closeout.didnt.trim(), carry: closeout.carry.trim(), closed_on: today },
      benefit_question: benefit.question.trim(),
      benefit_check_on: benefit.question.trim() ? benefit.on : null,
    },
  });
  const after = data.goals.map((g) => (g.id === project.id ? { ...g, completed_at: nowISO() } : g));
  return { ops, ready: readyAfter(project.id, after) };
}

/** Drop a project: it stops counting toward its goal, its tasks come off the list, and why goes in the decision log. */
export function opsDropProject(data: AppData, project: Goal, reason: string, today: ISODate): Op[] {
  const ops = opsCompleteGoal(data, project, '', today).map((op) =>
    op.kind === 'update' && op.collection === 'goals' && op.id === project.id ? { ...op, patch: { dropped_at: op.patch.completed_at } } : op,
  );
  ops.push(...opsAddRaid(project.id, 'decision', `Dropped ${project.title}`, reason));
  return ops;
}

/** Reopen a closed or dropped project (its tasks come back). */
export function opsReopenProject(data: AppData, project: Goal): Op[] {
  if (project.dropped_at) {
    const as = { ...project, completed_at: project.dropped_at };
    return opsReopenGoal(data, as).map((op) => (op.kind === 'update' && op.collection === 'goals' && op.id === project.id ? { ...op, patch: { dropped_at: null } } : op));
  }
  return opsReopenGoal(data, project);
}

// ---------- Milestones ----------

export function opsAddProjectMilestone(projectId: string, title: string, due: ISODate): Op[] {
  const m: Milestone = { id: newId(), goal_id: projectId, title: title.trim(), due_date: due, completed_at: null, created_at: nowISO() };
  return [{ kind: 'insert', collection: 'milestones', rows: row(m) }];
}

/** Split a project into evenly spaced steps: "Module 1" … "Module 7", the last due on the target date. */
export function opsSplitIntoMilestones(projectId: string, base: string, n: number, start: ISODate, end: ISODate): Op[] {
  const created = nowISO();
  const list = evenMilestones(base, n, start, end).map((m): Milestone => ({ id: newId(), goal_id: projectId, title: m.title, due_date: m.due_date, completed_at: null, created_at: created }));
  return list.length ? [{ kind: 'insert', collection: 'milestones', rows: list as unknown as Row[] }] : [];
}

export function opsUpdateMilestone(m: Milestone, patch: Partial<Pick<Milestone, 'title' | 'due_date' | 'deliverable'>>): Op[] {
  return [{ kind: 'update', collection: 'milestones', id: m.id, patch }];
}

export function opsDeleteMilestone(m: Milestone): Op[] {
  return [{ kind: 'delete', collection: 'milestones', id: m.id }];
}

// ---------- RAID: risks, assumptions, issues, decisions ----------

export function opsAddRaid(goalId: string, kind: RaidKind, title: string, detail = ''): Op[] {
  const item: RaidItem = { id: newId(), goal_id: goalId, kind, title: title.trim(), detail: detail.trim(), status: 'open', created_at: nowISO(), closed_at: null };
  return item.title ? [{ kind: 'insert', collection: 'raidItems', rows: row(item) }] : [];
}

export function opsUpdateRaid(item: RaidItem, patch: Partial<Pick<RaidItem, 'title' | 'detail'>>): Op[] {
  return [{ kind: 'update', collection: 'raidItems', id: item.id, patch }];
}

export function opsToggleRaid(item: RaidItem): Op[] {
  const closed = item.status === 'open';
  return [{ kind: 'update', collection: 'raidItems', id: item.id, patch: { status: closed ? 'closed' : 'open', closed_at: closed ? nowISO() : null } }];
}

export function opsDeleteRaid(item: RaidItem): Op[] {
  return [{ kind: 'delete', collection: 'raidItems', id: item.id }];
}

export function raidFor(data: AppData, goalId: string, kind?: RaidKind): RaidItem[] {
  return (data.raidItems ?? [])
    .filter((r) => r.goal_id === goalId && (!kind || r.kind === kind))
    .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || (a.created_at < b.created_at ? 1 : -1));
}

/** Decisions for a goal and its projects together, newest first (the goal's decision log). */
export function decisionsFor(data: AppData, goalId: string): (RaidItem & { on: Goal | undefined })[] {
  const ids = new Set([goalId, ...data.goals.filter((g) => g.parent_id === goalId).map((g) => g.id)]);
  return (data.raidItems ?? [])
    .filter((r) => r.kind === 'decision' && ids.has(r.goal_id))
    .map((r) => ({ ...r, on: data.goals.find((g) => g.id === r.goal_id) }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Obstacles noted when logging a project's tasks, counted (the "issues" the logs already hold). */
export function loggedObstacles(data: AppData, projectId: string): { name: string; count: number }[] {
  const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === projectId).map((ag) => ag.action_id));
  const counts = new Map<string, number>();
  for (const s of data.sessions) {
    if (!s.action_id || !actionIds.has(s.action_id)) continue;
    for (const o of s.obstacles ?? []) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function isProjectGoal(g: Goal | undefined): boolean {
  return isProject(g);
}

function changeLog(entityId: string, summary: string, oldValue: unknown, newValue: unknown, today: ISODate): Op {
  return {
    kind: 'insert',
    collection: 'changeLog',
    rows: row({ id: newId(), entity: 'goal', entity_id: entityId, summary, old_value: oldValue, new_value: newValue, effective_from: today, review_id: null, created_at: nowISO() }),
  };
}
