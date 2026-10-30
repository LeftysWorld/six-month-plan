import type {
  Action,
  ActionGoal,
  ActionSchedule,
  Attachment,
  ChangeLogEntry,
  Goal,
  GoalGroup,
  GoalIdea,
  GoalTarget,
  Measurement,
  MeasurementType,
  Milestone,
  Path,
  PathExperiment,
  Plan,
  PlanGoal,
  PlanStep,
  Profile,
  Review,
  Session,
  StretchHoldLog,
  WeekPlan,
  WorkoutSet,
  WorkoutExerciseLog,
} from '@six/core';

/** Everything the app holds in memory. One person's data is small enough to load whole. */
export interface AppData {
  profile: Profile;
  plans: Plan[];
  goals: Goal[];
  planGoals: PlanGoal[];
  goalTargets: GoalTarget[];
  planSteps: PlanStep[];
  milestones: Milestone[];
  actions: Action[];
  actionGoals: ActionGoal[];
  schedules: ActionSchedule[];
  sessions: Session[];
  workoutSets: WorkoutSet[];
  workoutExercises: WorkoutExerciseLog[];
  /** Holds ticked off in logged stretching sessions. */
  stretchHolds: StretchHoldLog[];
  measurementTypes: MeasurementType[];
  measurements: Measurement[];
  weekPlans: WeekPlan[];
  reviews: Review[];
  changeLog: ChangeLogEntry[];
  /** The goal backlog: ideas, selected for next commitment, started, discarded. */
  ideas: GoalIdea[];
  /** Photos and files attached to logged tasks (the files themselves are in file storage). */
  attachments: Attachment[];
  /** Named groups of goals. A goal points at its group with group_id. */
  groups: GoalGroup[];
  /** Odyssey paths: the five-year lives goals and ideas are bets on. */
  paths: Path[];
  /** Small dated experiments that answer a path's questions. */
  experiments: PathExperiment[];
}

export type CollectionKey = Exclude<keyof AppData, 'profile'>;

/** Collection name in the app → table name in Postgres. */
export const TABLES: Record<CollectionKey, string> = {
  plans: 'plans',
  goals: 'goals',
  planGoals: 'plan_goals',
  goalTargets: 'goal_targets',
  planSteps: 'plan_steps',
  milestones: 'milestones',
  actions: 'actions',
  actionGoals: 'action_goals',
  schedules: 'action_schedules',
  sessions: 'sessions',
  workoutSets: 'workout_sets',
  workoutExercises: 'workout_exercises',
  stretchHolds: 'stretch_holds',
  measurementTypes: 'measurement_types',
  measurements: 'measurements',
  weekPlans: 'week_plans',
  reviews: 'reviews',
  changeLog: 'change_log',
  ideas: 'goal_ideas',
  attachments: 'attachments',
  groups: 'goal_groups',
  paths: 'paths',
  experiments: 'path_experiments',
};

export const COLLECTIONS = Object.keys(TABLES) as CollectionKey[];

/** Colours retired from the palette, shown as their replacement (the olive-yellow became teal). */
const RETIRED_COLORS: Record<string, string> = { '#c9a227': '#3FB6C9' };

/** Tidy loaded data for display: retired goal colours are swapped for their replacement. */
export function normalizeData(data: AppData): AppData {
  if (!data.goals.some((g) => RETIRED_COLORS[g.color?.toLowerCase()])) return data;
  return { ...data, goals: data.goals.map((g) => (RETIRED_COLORS[g.color?.toLowerCase()] ? { ...g, color: RETIRED_COLORS[g.color.toLowerCase()]! } : g)) };
}

export function defaultProfile(): Profile {
  return {
    display_name: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    units: 'lb',
    available_minutes: [150, 150, 150, 150, 150, 180, 60],
    welcome_dismissed_on: null,
  };
}

export function emptyData(): AppData {
  return {
    profile: defaultProfile(),
    plans: [],
    goals: [],
    planGoals: [],
    goalTargets: [],
    planSteps: [],
    milestones: [],
    actions: [],
    actionGoals: [],
    schedules: [],
    sessions: [],
    workoutSets: [],
    workoutExercises: [],
    stretchHolds: [],
    measurementTypes: [],
    measurements: [],
    weekPlans: [],
    reviews: [],
    changeLog: [],
    ideas: [],
    attachments: [],
    groups: [],
    paths: [],
    experiments: [],
  };
}

type AnyRow = { id: string } & Record<string, unknown>;

/** A change to persist. Ops are applied to memory immediately and queued for the database. */
export type Op =
  | { kind: 'insert'; collection: CollectionKey; rows: AnyRow[] }
  /** Insert rows whose slot already exists are skipped (used for generated sessions). */
  | { kind: 'insertIgnore'; collection: 'sessions'; rows: AnyRow[] }
  | { kind: 'update'; collection: CollectionKey; id: string; patch: Record<string, unknown> }
  | { kind: 'delete'; collection: CollectionKey; id: string }
  | { kind: 'profile'; patch: Partial<Profile> }
  | { kind: 'review'; payload: ReviewPayload };

export interface ReviewPayload {
  review: Review;
  measurements: Measurement[];
  schedule_changes: {
    end_schedule_id: string;
    end_on: string;
    /** The task the change is for. */
    action_id: string;
    /** null pauses the task from the day after end_on. */
    new_schedule: ActionSchedule | null;
    summary: string;
    old_value: unknown;
    new_value: unknown;
  }[];
  action_changes: {
    action_id: string;
    min_label: string;
    min_minutes: number | null;
    min_count: number | null;
    summary: string;
    old_value: unknown;
    new_value: unknown;
  }[];
  /** Only the weekly review plans a week. */
  week_plan?: WeekPlan | null;
  /** Next week's sessions; status 'moved' takes a session out of the week. */
  sessions: Session[];
}

function sessionKey(s: Pick<Session, 'action_id' | 'week_start' | 'origin' | 'slot'>): string {
  return `${s.action_id}|${s.week_start}|${s.origin}|${s.slot}`;
}

/** Apply one op to in-memory data and return the new data (never mutates the input). */
export function applyOp(data: AppData, op: Op): AppData {
  switch (op.kind) {
    case 'insert': {
      const list = data[op.collection] as unknown as AnyRow[];
      const ids = new Set(op.rows.map((r) => r.id));
      return { ...data, [op.collection]: [...list.filter((r) => !ids.has(r.id)), ...op.rows] };
    }
    case 'insertIgnore': {
      const taken = new Set(data.sessions.filter((s) => s.action_id).map(sessionKey));
      const fresh = (op.rows as unknown as Session[]).filter((r) => !r.action_id || !taken.has(sessionKey(r)));
      return { ...data, sessions: [...data.sessions, ...fresh] };
    }
    case 'update': {
      const list = data[op.collection] as unknown as AnyRow[];
      return {
        ...data,
        [op.collection]: list.map((r) => (r.id === op.id ? { ...r, ...op.patch } : r)),
      };
    }
    case 'delete': {
      const list = data[op.collection] as unknown as AnyRow[];
      return { ...data, [op.collection]: list.filter((r) => r.id !== op.id) };
    }
    case 'profile':
      return { ...data, profile: { ...data.profile, ...op.patch } };
    case 'review':
      return applyReviewPayload(data, op.payload);
  }
}

/** The weekly review's effects, mirroring the complete_weekly_review SQL function. */
export function applyReviewPayload(data: AppData, p: ReviewPayload): AppData {
  const now = new Date().toISOString();
  // One reading per measurement per day: a review reading replaces the day's earlier one.
  const replaced = new Set(p.measurements.map((m) => `${m.type_id}|${m.measured_on}`));
  let next: AppData = {
    ...data,
    reviews: [...data.reviews.filter((r) => r.id !== p.review.id), { ...p.review, status: 'done', completed_at: now }],
    measurements: [...data.measurements.filter((m) => !replaced.has(`${m.type_id}|${m.measured_on}`)), ...p.measurements],
  };
  for (const c of p.schedule_changes) {
    next = {
      ...next,
      schedules: [
        ...next.schedules.map((s) => (s.id === c.end_schedule_id ? { ...s, effective_to: c.end_on } : s)),
        ...(c.new_schedule ? [c.new_schedule] : []),
      ],
      changeLog: [
        ...next.changeLog,
        {
          id: crypto.randomUUID(),
          entity: 'action_schedule',
          entity_id: c.new_schedule?.action_id ?? c.action_id,
          summary: c.summary,
          old_value: c.old_value,
          new_value: c.new_value,
          effective_from: c.new_schedule?.effective_from ?? addOneDay(c.end_on),
          review_id: p.review.id,
          created_at: now,
        },
      ],
    };
  }
  for (const c of p.action_changes) {
    next = {
      ...next,
      actions: next.actions.map((a) =>
        a.id === c.action_id ? { ...a, min_label: c.min_label, min_minutes: c.min_minutes, min_count: c.min_count } : a,
      ),
      changeLog: [
        ...next.changeLog,
        {
          id: crypto.randomUUID(),
          entity: 'action',
          entity_id: c.action_id,
          summary: c.summary,
          old_value: c.old_value,
          new_value: c.new_value,
          effective_from: p.review.period_end,
          review_id: p.review.id,
          created_at: now,
        },
      ],
    };
  }
  if (p.week_plan) {
    const plan = p.week_plan;
    next = { ...next, weekPlans: [...next.weekPlans.filter((w) => w.week_start !== plan.week_start), plan] };
  }
  const byKey = new Map(next.sessions.filter((s) => s.action_id).map((s) => [sessionKey(s), s]));
  const updated = [...next.sessions];
  for (const s of p.sessions) {
    const existing = s.action_id ? byKey.get(sessionKey(s)) : undefined;
    if (existing) {
      if (existing.status === 'planned') {
        const i = updated.indexOf(existing);
        const removed = s.status === 'moved';
        updated[i] = { ...existing, date: s.date, planned_minutes: s.planned_minutes, planned_count: s.planned_count, status: removed ? 'moved' : 'planned', note: removed ? s.note : existing.note };
      }
    } else {
      updated.push({ ...s, status: s.status === 'moved' ? 'moved' : 'planned' });
    }
  }
  return { ...next, sessions: updated };
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
