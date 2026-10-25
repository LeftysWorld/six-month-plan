import {
  addDays,
  currentTargets,
  missingSessionsForWeek,
  scheduleForWeek,
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
import type { AppData, Op, ReviewPayload } from './model.ts';

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
  milestones: { title: string; due_date: ISODate }[];
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
      rows: rows(ms.map((m): Milestone => ({ id: newId(), goal_id: goalId, title: m.title.trim(), due_date: m.due_date, completed_at: null }))),
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

export function opsAddMilestone(goalId: string, title: string, due: ISODate): Op[] {
  return [{ kind: 'insert', collection: 'milestones', rows: rows([{ id: newId(), goal_id: goalId, title: title.trim(), due_date: due, completed_at: null }]) }];
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

export function opsUpdateAction(action: Action, patch: Partial<Action>): Op[] {
  return [{ kind: 'update', collection: 'actions', id: action.id, patch }];
}

/** Change how often an action happens, from next Monday. History stays intact. */
export function opsChangeSchedule(
  data: AppData,
  action: Action,
  next: { rule: 'days' | 'per_week'; days: number[]; per_week: number | null },
  today: ISODate,
): Op[] {
  const from = addDays(weekStart(today), 7);
  const current = scheduleForWeek(data.schedules, action.id, from);
  const fresh: ActionSchedule = {
    id: newId(),
    action_id: action.id,
    rule: next.rule,
    days: next.rule === 'days' ? next.days : [],
    per_week: next.rule === 'per_week' ? next.per_week : null,
    effective_from: from,
    effective_to: null,
  };
  const ops: Op[] = [];
  if (current && current.effective_from >= from) {
    // Already changed for next week: adjust that pending change instead of stacking another.
    ops.push({
      kind: 'update',
      collection: 'schedules',
      id: current.id,
      patch: { rule: fresh.rule, days: fresh.days, per_week: fresh.per_week },
    });
  } else {
    if (current) {
      ops.push({ kind: 'update', collection: 'schedules', id: current.id, patch: { effective_to: addDays(from, -1) } });
    }
    ops.push({ kind: 'insert', collection: 'schedules', rows: rows([fresh]) });
  }
  ops.push({
    kind: 'insert',
    collection: 'changeLog',
    rows: rows([
      {
        id: newId(),
        entity: 'action_schedule',
        entity_id: action.id,
        summary: `${action.title}: schedule changed`,
        old_value: current ? { rule: current.rule, days: current.days, per_week: current.per_week } : null,
        new_value: { rule: fresh.rule, days: fresh.days, per_week: fresh.per_week },
        effective_from: from,
        review_id: null,
        created_at: nowISO(),
      },
    ]),
  });
  return ops;
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
