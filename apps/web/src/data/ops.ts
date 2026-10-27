import {
  currentTargets,
  missingSessionsForWeek,
  weekStart,
  type Action,
  type ActionKind,
  type ActionSchedule,
  type Attachment,
  type Goal,
  type GoalType,
  type ISODate,
  type Milestone,
  type PathPoint,
  type Plan,
  type Profile,
  type Session,
  type SessionStatus,
  type WorkoutSet,
} from '@six/core';
import type { AppData, CollectionKey, Op, ReviewPayload } from './model.ts';
import { opsRemoveFromGroup } from './groups.ts';

/** Builders that turn a user intention into the database changes it needs. */

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();

type Row = { id: string } & Record<string, unknown>;
const rows = <T extends { id: string }>(items: T[]): Row[] => items as unknown as Row[];

// ---------- Sessions ----------

export function opsEnsureWeek(data: AppData, monday: ISODate): Op[] {
  const missing = missingSessionsForWeek(data.actions, data.schedules, data.sessions, monday, newId);
  return missing.length ? [{ kind: 'insertIgnore', collection: 'sessions', rows: rows(missing) }] : [];
}

export interface SessionLog {
  status: SessionStatus;
  actual_minutes?: number | null;
  actual_count?: number | null;
  note?: string;
  obstacles?: string[];
  /** For an "any day this week" session (no date yet): the day it was done on. */
  on?: ISODate;
}

export function opsLogSession(session: Session, log: SessionLog): Op[] {
  const patch: Record<string, unknown> = {
    status: log.status,
    logged_at: log.status === 'planned' ? null : nowISO(),
  };
  if (log.actual_minutes !== undefined) patch.actual_minutes = log.actual_minutes;
  if (log.actual_count !== undefined) patch.actual_count = log.actual_count;
  if (log.note !== undefined) patch.note = log.note;
  if (log.obstacles !== undefined) patch.obstacles = log.obstacles;
  if (log.on && !session.date && log.status !== 'planned') patch.date = log.on;
  if (log.status === 'done') {
    if (log.actual_minutes === undefined && session.actual_minutes == null) patch.actual_minutes = session.planned_minutes;
    if (log.actual_count === undefined && session.actual_count == null) patch.actual_count = session.planned_count;
  }
  return [{ kind: 'update', collection: 'sessions', id: session.id, patch }];
}

/** Restore a session to exactly how it was (for Undo). */
export function opsRestoreSession(before: Session): Op[] {
  const { id, ...rest } = before;
  return [{ kind: 'update', collection: 'sessions', id, patch: rest as Record<string, unknown> }];
}

/** Move one session to another day (or back to the tray with null). */
export function opsMoveSession(session: Session, date: ISODate | null): Op[] {
  return [{ kind: 'update', collection: 'sessions', id: session.id, patch: { date } }];
}

export function opsAddOneOff(input: { title: string; minutes: number; priority: boolean; date: ISODate }): Op[] {
  const session: Session = {
    id: newId(),
    action_id: null,
    week_start: weekStart(input.date),
    slot: 0,
    date: input.date,
    title: input.title.trim(),
    priority: input.priority,
    planned_minutes: input.minutes,
    planned_count: null,
    status: 'planned',
    actual_minutes: null,
    actual_count: null,
    note: '',
    obstacles: [],
    origin: 'oneoff',
    source: 'manual',
    moved_from: null,
    logged_at: null,
  };
  return [{ kind: 'insert', collection: 'sessions', rows: rows([session]) }];
}

/**
 * An extra session of a task on a day, to do now and log as usual: a workout on a day it isn't
 * planned, or a second one on a day that already has one. It shows on Today as "Extra".
 */
export function opsStartExtra(data: AppData, action: Action, date: ISODate): { ops: Op[]; session: Session } {
  const monday = weekStart(date);
  const used = data.sessions.filter((s) => s.action_id === action.id && s.week_start === monday && s.origin === 'unplanned').length;
  const session: Session = {
    id: newId(),
    action_id: action.id,
    week_start: monday,
    slot: 1000 + used,
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
    origin: 'unplanned',
    source: 'manual',
    moved_from: null,
    logged_at: null,
  };
  return { ops: [{ kind: 'insert', collection: 'sessions', rows: rows([session]) }], session };
}

/** Delete an extra session (not a planned one) with its logged sets. Returns the ops that bring it back. */
export function opsDeleteExtra(data: AppData, session: Session): { ops: Op[]; undo: Op[] } {
  const sets = data.workoutSets.filter((w) => w.session_id === session.id);
  return {
    ops: [...sets.map((w): Op => ({ kind: 'delete', collection: 'workoutSets', id: w.id })), { kind: 'delete', collection: 'sessions', id: session.id }],
    undo: [{ kind: 'insert', collection: 'sessions', rows: rows([session]) }, ...(sets.length ? [{ kind: 'insert', collection: 'workoutSets', rows: rows(sets) } as Op] : [])],
  };
}

/** Log something done that wasn't on the plan. */
export function opsLogUnplanned(data: AppData, action: Action, date: ISODate, minutes: number): Op[] {
  const monday = weekStart(date);
  const used = data.sessions.filter(
    (s) => s.action_id === action.id && s.week_start === monday && s.origin === 'unplanned',
  ).length;
  const session: Session = {
    id: newId(),
    action_id: action.id,
    week_start: monday,
    slot: 1000 + used,
    date,
    title: action.title,
    priority: false,
    planned_minutes: 0,
    planned_count: null,
    status: 'done',
    actual_minutes: minutes,
    actual_count: null,
    note: '',
    obstacles: [],
    origin: 'unplanned',
    source: 'manual',
    moved_from: null,
    logged_at: nowISO(),
  };
  return [{ kind: 'insert', collection: 'sessions', rows: rows([session]) }];
}

export function opsSaveWorkout(data: AppData, sessionId: string, sets: Omit<WorkoutSet, 'id' | 'session_id'>[]): Op[] {
  const existing = data.workoutSets.filter((w) => w.session_id === sessionId);
  const fresh: WorkoutSet[] = sets.map((s) => ({ ...s, id: newId(), session_id: sessionId }));
  return [
    ...existing.map((w): Op => ({ kind: 'delete', collection: 'workoutSets', id: w.id })),
    ...(fresh.length ? [{ kind: 'insert', collection: 'workoutSets', rows: rows(fresh) } as Op] : []),
  ];
}

// ---------- Plans ----------

/** Create a batch, or (solo) a goal's own clock. `solo` is only sent when true, so older databases still work. */
export function opsCreatePlan(input: { name: string; start: ISODate; end: ISODate; solo?: boolean }): { ops: Op[]; plan: Plan } {
  const plan: Plan = {
    id: newId(),
    name: input.name.trim(),
    start_date: input.start,
    end_date: input.end,
    block_days: 28,
    archived_at: null,
    ...(input.solo ? { solo: true } : {}),
  };
  return { ops: [{ kind: 'insert', collection: 'plans', rows: rows([plan]) }], plan };
}

export function opsArchivePlan(plan: Plan, archived: boolean): Op[] {
  return [{ kind: 'update', collection: 'plans', id: plan.id, patch: { archived_at: archived ? nowISO() : null } }];
}

// ---------- Goals ----------

export interface ActionInput {
  title: string;
  kind: ActionKind;
  planned_minutes: number;
  planned_count: number | null;
  min_label: string;
  min_minutes: number | null;
  min_count: number | null;
  priority: boolean;
  rule: 'days' | 'per_week';
  days: number[];
  per_week: number | null;
}

export interface GoalInput {
  planId: string;
  title: string;
  type: GoalType;
  why: string;
  done_means: string;
  color: string;
  // number goals
  unit: string;
  measureName: string;
  baseline: number | null;
  target: number | null;
  targetDate: ISODate;
  path: PathPoint[];
  // finish goals
  milestones: { title: string; due_date: ISODate; value?: number | null; prize?: string }[];
  // optional regular action
  action: ActionInput | null;
}

export function opsCreateGoal(data: AppData, input: GoalInput, today: ISODate): { ops: Op[]; goalId: string } {
  const goalId = newId();
  const ops: Op[] = [];
  let measurementTypeId: string | null = null;
  if (input.type === 'number') {
    measurementTypeId = newId();
    ops.push({
      kind: 'insert',
      collection: 'measurementTypes',
      rows: rows([
        {
          id: measurementTypeId,
          name: input.measureName.trim() || input.title.trim(),
          unit: input.unit.trim(),
          cadence_days: 7,
          goal_id: null,
          archived_at: null,
        },
      ]),
    });
  }
  const goal: Goal = {
    id: goalId,
    title: input.title.trim(),
    type: input.type,
    why: input.why.trim(),
    done_means: input.done_means.trim(),
    unit: input.type === 'number' ? input.unit.trim() : null,
    baseline_value: input.type === 'number' ? input.baseline : null,
    baseline_date: input.type === 'number' && input.baseline != null ? today : null,
    target_value: input.type === 'number' ? input.target : null,
    target_date: input.type === 'number' ? input.targetDate : null,
    color: input.color,
    measurement_type_id: measurementTypeId,
    archived_at: null,
  };
  ops.push({ kind: 'insert', collection: 'goals', rows: rows([goal]) });
  if (measurementTypeId) {
    ops.push({ kind: 'update', collection: 'measurementTypes', id: measurementTypeId, patch: { goal_id: goalId } });
  }
  ops.push({ kind: 'insert', collection: 'planGoals', rows: rows([{ id: newId(), plan_id: input.planId, goal_id: goalId }]) });
  if (input.type === 'number' && input.path.length) {
    ops.push({
      kind: 'insert',
      collection: 'goalTargets',
      rows: rows(
        input.path.map((p) => ({
          id: newId(),
          goal_id: goalId,
          target_date: p.date,
          target_value: p.value,
          effective_from: today,
          superseded_at: null,
        })),
      ),
    });
  }
  if (input.type === 'number' && input.baseline != null && measurementTypeId) {
    ops.push({
      kind: 'insert',
      collection: 'measurements',
      rows: rows([{ id: newId(), type_id: measurementTypeId, value: input.baseline, measured_on: today, source: 'manual', note: 'Starting point' }]),
    });
  }
  const ms = input.milestones.filter((m) => m.title.trim());
  if (ms.length) {
    ops.push({
      kind: 'insert',
      collection: 'milestones',
      rows: rows(ms.map((m): Milestone => ({ id: newId(), goal_id: goalId, title: m.title.trim(), due_date: m.due_date, completed_at: null, value: m.value ?? null, prize: m.prize?.trim() ?? '', prize_claimed_at: null }))),
    });
  }
  if (input.action && input.action.title.trim()) {
    ops.push(...opsCreateAction(data, input.action, [goalId], today).ops);
  }
  return { ops, goalId };
}

export function opsUpdateGoal(goal: Goal, patch: Partial<Goal>): Op[] {
  return [{ kind: 'update', collection: 'goals', id: goal.id, patch }];
}

export function opsArchiveGoal(goal: Goal, archived: boolean): Op[] {
  return [{ kind: 'update', collection: 'goals', id: goal.id, patch: { archived_at: archived ? nowISO() : null } }];
}

/**
 * Finish a goal: it moves to Completed with an optional note on how it ended. Its own tasks
 * (not shared with another goal) are archived with the same timestamp and planned sessions
 * from `from` on come off the list. History is kept.
 */
export function opsCompleteGoal(data: AppData, goal: Goal, note: string, from: ISODate): Op[] {
  const at = nowISO();
  const ops: Op[] = [{ kind: 'update', collection: 'goals', id: goal.id, patch: { completed_at: at, ...(note.trim() ? { completion_note: note.trim() } : {}) } }];
  const mine = new Set(data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
  const own = data.actions.filter((a) => mine.has(a.id) && !a.archived_at && data.actionGoals.filter((ag) => ag.action_id === a.id).length === 1);
  const ids = new Set(own.map((a) => a.id));
  for (const a of own) ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { archived_at: at } });
  for (const s of data.sessions) {
    if (s.action_id && ids.has(s.action_id) && s.status === 'planned' && (s.date ?? s.week_start) >= from) ops.push({ kind: 'delete', collection: 'sessions', id: s.id });
  }
  return ops;
}

/** Undo a completion: the goal is active again and the tasks archived with it come back. */
export function opsReopenGoal(data: AppData, goal: Goal): Op[] {
  const at = goal.completed_at;
  const ops: Op[] = [{ kind: 'update', collection: 'goals', id: goal.id, patch: { completed_at: null } }];
  if (!at) return ops;
  const mine = new Set(data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
  for (const a of data.actions) {
    if (mine.has(a.id) && a.archived_at === at) ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { archived_at: null } });
  }
  return ops;
}

export function opsLinkGoalToPlan(data: AppData, goalId: string, planId: string): Op[] {
  if (data.planGoals.some((pg) => pg.goal_id === goalId && pg.plan_id === planId)) return [];
  return [{ kind: 'insert', collection: 'planGoals', rows: rows([{ id: newId(), plan_id: planId, goal_id: goalId }]) }];
}

/** Replace a goal's path. Old points are kept but marked superseded. */
export function opsReplacePath(data: AppData, goal: Goal, points: PathPoint[], today: ISODate): Op[] {
  const old = currentTargets(data.goalTargets, goal.id);
  return [
    ...old.map((t): Op => ({ kind: 'update', collection: 'goalTargets', id: t.id, patch: { superseded_at: nowISO() } })),
    {
      kind: 'insert',
      collection: 'goalTargets',
      rows: rows(points.map((p) => ({ id: newId(), goal_id: goal.id, target_date: p.date, target_value: p.value, effective_from: today, superseded_at: null }))),
    },
    {
      kind: 'insert',
      collection: 'changeLog',
      rows: rows([
        {
          id: newId(),
          entity: 'goal',
          entity_id: goal.id,
          summary: 'Path changed',
          old_value: old.map((t) => ({ date: t.target_date, value: t.target_value })),
          new_value: points,
          effective_from: today,
          review_id: null,
          created_at: nowISO(),
        },
      ]),
    },
  ];
}

export function opsAddMilestone(goalId: string, title: string, due: ISODate, extra: { value?: number | null; prize?: string; count_action_id?: string | null } = {}): Op[] {
  return [
    {
      kind: 'insert',
      collection: 'milestones',
      rows: rows([{ id: newId(), goal_id: goalId, title: title.trim(), due_date: due, completed_at: null, value: extra.value ?? null, prize: extra.prize?.trim() ?? '', prize_claimed_at: null, count_action_id: extra.count_action_id ?? null }]),
    },
  ];
}

export function opsToggleMilestone(m: Milestone): Op[] {
  return [{ kind: 'update', collection: 'milestones', id: m.id, patch: { completed_at: m.completed_at ? null : nowISO() } }];
}

// ---------- Actions ----------

export function opsCreateAction(
  data: AppData,
  input: ActionInput,
  goalIds: string[],
  today: ISODate,
): { ops: Op[]; actionId: string } {
  const action: Action = {
    id: newId(),
    title: input.title.trim(),
    kind: input.kind,
    planned_minutes: input.planned_minutes,
    planned_count: input.planned_count,
    min_label: input.min_label.trim(),
    min_minutes: input.min_minutes,
    min_count: input.min_count,
    priority: input.priority,
    archived_at: null,
  };
  const schedule: ActionSchedule = {
    id: newId(),
    action_id: action.id,
    rule: input.rule,
    days: input.rule === 'days' ? input.days : [],
    per_week: input.rule === 'per_week' ? input.per_week : null,
    effective_from: today,
    effective_to: null,
  };
  const ops: Op[] = [
    { kind: 'insert', collection: 'actions', rows: rows([action]) },
    { kind: 'insert', collection: 'schedules', rows: rows([schedule]) },
    { kind: 'insert', collection: 'actionGoals', rows: rows(goalIds.map((g) => ({ id: newId(), action_id: action.id, goal_id: g }))) },
  ];
  const withAction: AppData = { ...data, actions: [...data.actions, action], schedules: [...data.schedules, schedule] };
  ops.push(...opsEnsureWeek(withAction, weekStart(today)));
  return { ops, actionId: action.id };
}

export function opsArchiveAction(action: Action, archived: boolean): Op[] {
  return [{ kind: 'update', collection: 'actions', id: action.id, patch: { archived_at: archived ? nowISO() : null } }];
}

// ---------- Measurements ----------

export function opsAddMeasurement(typeId: string, value: number, date: ISODate, note = ''): Op[] {
  return [{ kind: 'insert', collection: 'measurements', rows: rows([{ id: newId(), type_id: typeId, value, measured_on: date, source: 'manual', note }]) }];
}

export function opsDeleteMeasurement(id: string): Op[] {
  return [{ kind: 'delete', collection: 'measurements', id }];
}

export function opsAddMeasurementType(input: { name: string; unit: string; cadence_days: number; goal_id: string | null }): Op[] {
  return [{ kind: 'insert', collection: 'measurementTypes', rows: rows([{ id: newId(), ...input, archived_at: null }]) }];
}

// ---------- Profile and review ----------

export function opsProfile(patch: Partial<Profile>): Op[] {
  return [{ kind: 'profile', patch }];
}

export function opsCompleteReview(payload: ReviewPayload): Op[] {
  return [{ kind: 'review', payload }];
}

/** Record a file that was just uploaded for a session. */
export function opsAddAttachment(session: Session, file: { id: string; path: string; name: string; mime_type: string; size_bytes: number }): Op[] {
  const row: Attachment = { ...file, session_id: session.id, action_id: session.action_id, created_at: nowISO() };
  return [{ kind: 'insert', collection: 'attachments', rows: [row as unknown as Row] }];
}

export function opsRemoveAttachment(attachment: Attachment): Op[] {
  return [{ kind: 'delete', collection: 'attachments', id: attachment.id }];
}

/**
 * Delete a goal for good, with everything that only belongs to it: its own daily tasks with their
 * schedules, logs, sets and attachment records; its breakdown, path, milestones and its own
 * measurement (when nothing else uses it). Tasks it shares with other goals keep running for them.
 * Returns the ops and the storage paths of attachment files to remove.
 */
export function opsDeleteGoal(data: AppData, goal: Goal): { ops: Op[]; files: string[] } {
  const ops: Op[] = [];
  const del = (collection: CollectionKey, id: string) => ops.push({ kind: 'delete', collection, id });
  const links = data.actionGoals.filter((ag) => ag.goal_id === goal.id);
  const own = new Set(links.filter((ag) => data.actionGoals.filter((x) => x.action_id === ag.action_id).length === 1).map((ag) => ag.action_id));
  for (const ag of links) del('actionGoals', ag.id);
  const sessions = data.sessions.filter((s) => s.action_id && own.has(s.action_id));
  const sessionIds = new Set(sessions.map((s) => s.id));
  const attachments = data.attachments.filter((a) => sessionIds.has(a.session_id) || (a.action_id && own.has(a.action_id)));
  for (const a of attachments) del('attachments', a.id);
  for (const w of data.workoutSets.filter((w) => sessionIds.has(w.session_id))) del('workoutSets', w.id);
  for (const s of sessions) del('sessions', s.id);
  for (const s of data.schedules.filter((x) => own.has(x.action_id))) del('schedules', s.id);
  for (const id of own) del('actions', id);
  for (const pg of data.planGoals.filter((x) => x.goal_id === goal.id)) del('planGoals', pg.id);
  for (const st of data.planSteps.filter((x) => x.goal_id === goal.id)) del('planSteps', st.id);
  for (const t of data.goalTargets.filter((x) => x.goal_id === goal.id)) del('goalTargets', t.id);
  for (const m of data.milestones.filter((x) => x.goal_id === goal.id)) del('milestones', m.id);
  // Its change history (and its own tasks' and schedules') has nothing to point at any more.
  const gone = new Set<string>([goal.id, ...own, ...data.schedules.filter((x) => own.has(x.action_id)).map((x) => x.id)]);
  for (const c of data.changeLog.filter((x) => gone.has(x.entity_id))) del('changeLog', c.id);
  // Its own measurement goes too, unless another goal or a remaining task records it.
  const usedElsewhere = (typeId: string) =>
    data.goals.some((g) => g.id !== goal.id && g.measurement_type_id === typeId) || data.actions.some((a) => !own.has(a.id) && a.measurement_type_id === typeId);
  for (const t of data.measurementTypes.filter((x) => x.goal_id === goal.id || x.id === goal.measurement_type_id)) {
    if (usedElsewhere(t.id)) {
      if (t.goal_id === goal.id) ops.push({ kind: 'update', collection: 'measurementTypes', id: t.id, patch: { goal_id: null } });
    } else {
      for (const m of data.measurements.filter((x) => x.type_id === t.id)) del('measurements', m.id);
      del('measurementTypes', t.id);
    }
  }
  for (const idea of data.ideas.filter((i) => i.goal_id === goal.id)) ops.push({ kind: 'update', collection: 'ideas', id: idea.id, patch: { goal_id: null } });
  // Leaving its group first means a group left empty goes away too.
  ops.push(...opsRemoveFromGroup(data, goal.id));
  del('goals', goal.id);
  return { ops, files: attachments.map((a) => a.path) };
}
