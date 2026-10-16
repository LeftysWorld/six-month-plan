import type { ISODate } from './dates.ts';

/** Row shapes shared by the web app and the database. Field names match the SQL columns. */

export type GoalType = 'number' | 'practice' | 'finish';
export type ActionKind = 'check' | 'count' | 'minutes' | 'workout' | 'study';
export type SessionStatus = 'planned' | 'done' | 'partial' | 'minimum' | 'skipped' | 'moved';
export type SessionOrigin = 'scheduled' | 'oneoff' | 'unplanned';
export type ReviewKind = 'weekly' | 'block' | 'quarter' | 'retro';
export type PaceLabel = 'ahead' | 'on_track' | 'behind' | 'none';

export interface Profile {
  user_id?: string;
  display_name: string;
  timezone: string;
  units: 'lb' | 'kg';
  /** Minutes available per weekday, Monday first (7 numbers). */
  available_minutes: number[];
  welcome_dismissed_on: ISODate | null;
}

export interface Plan {
  id: string;
  name: string;
  start_date: ISODate;
  end_date: ISODate;
  block_days: number;
  archived_at: string | null;
}

export interface Goal {
  id: string;
  title: string;
  type: GoalType;
  why: string;
  done_means: string;
  unit: string | null;
  baseline_value: number | null;
  baseline_date: ISODate | null;
  target_value: number | null;
  target_date: ISODate | null;
  color: string;
  measurement_type_id: string | null;
  archived_at: string | null;
}

export interface PlanGoal {
  id: string;
  plan_id: string;
  goal_id: string;
}

export interface GoalTarget {
  id: string;
  goal_id: string;
  target_date: ISODate;
  target_value: number;
  effective_from: ISODate;
  superseded_at: string | null;
}

export interface Milestone {
  id: string;
  goal_id: string;
  title: string;
  due_date: ISODate;
  completed_at: string | null;
}

export interface Action {
  id: string;
  title: string;
  kind: ActionKind;
  planned_minutes: number;
  planned_count: number | null;
  min_label: string;
  min_minutes: number | null;
  min_count: number | null;
  priority: boolean;
  archived_at: string | null;
}

export interface ActionGoal {
  id: string;
  action_id: string;
  goal_id: string;
}

export interface ActionSchedule {
  id: string;
  action_id: string;
  rule: 'days' | 'per_week';
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  days: number[];
  per_week: number | null;
  effective_from: ISODate;
  effective_to: ISODate | null;
}

export interface Session {
  id: string;
  action_id: string | null;
  week_start: ISODate;
  slot: number;
  /** null = not placed on a day yet. */
  date: ISODate | null;
  title: string;
  priority: boolean;
  planned_minutes: number;
  planned_count: number | null;
  status: SessionStatus;
  actual_minutes: number | null;
  actual_count: number | null;
  note: string;
  obstacles: string[];
  origin: SessionOrigin;
  source: string;
  moved_from: string | null;
  logged_at: string | null;
}

export interface WorkoutSet {
  id: string;
  session_id: string;
  exercise: string;
  set_no: number;
  weight: number | null;
  reps: number | null;
  done: boolean;
}

export interface MeasurementType {
  id: string;
  name: string;
  unit: string;
  cadence_days: number;
  goal_id: string | null;
  archived_at: string | null;
}

export interface Measurement {
  id: string;
  type_id: string;
  value: number;
  measured_on: ISODate;
  source: string;
  note: string;
}

export interface WeekPlan {
  id: string;
  week_start: ISODate;
  available_minutes: number;
  planned_minutes: number;
  saved_at: string;
}

export interface Review {
  id: string;
  kind: ReviewKind;
  period_start: ISODate;
  period_end: ISODate;
  status: 'draft' | 'done';
  went_well: string;
  got_in_way: string;
  change_next: string;
  obstacles: string[];
  actions_done: number;
  actions_planned: number;
  completed_at: string | null;
}

export interface ChangeLogEntry {
  id: string;
  entity: string;
  entity_id: string;
  summary: string;
  old_value: unknown;
  new_value: unknown;
  effective_from: ISODate;
  review_id: string | null;
  created_at: string;
}
