import type { ISODate } from './dates.ts';

/** Row shapes shared by the web app and the database. Field names match the SQL columns. */

export type GoalType = 'number' | 'practice' | 'finish';
/** measure: logging it records a number (e.g. the day's weight); photo: logging it takes a photo. */
export type ActionKind = 'check' | 'count' | 'minutes' | 'workout' | 'study' | 'measure' | 'photo';
export type SessionStatus = 'planned' | 'done' | 'partial' | 'minimum' | 'skipped' | 'moved';
export type SessionOrigin = 'scheduled' | 'oneoff' | 'unplanned';
export type ReviewKind = 'weekly' | 'block' | 'quarter' | 'retro';
export type PaceLabel = 'ahead' | 'on_track' | 'behind' | 'none';
export type StepLevel = 'quarter' | 'month' | 'week';

export interface Profile {
  user_id?: string;
  display_name: string;
  timezone: string;
  units: 'lb' | 'kg';
  /** Minutes available per weekday, Monday first (7 numbers). */
  available_minutes: number[];
  welcome_dismissed_on: ISODate | null;
  /** Morning reminder time, "HH:MM" (the database may return "HH:MM:SS"). */
  reminder_time?: string;
  /** Evening "streak saver" reminder at 21:00 if nothing is logged. */
  evening_reminder?: boolean;
  /** Secret token for the read-only calendar feed. */
  calendar_token?: string | null;
}

/**
 * A plan is a window of time goals live in. A batch (solo false) is shared: several goals,
 * one set of checkpoints, and a goal can join part-way through. An own clock (solo true)
 * belongs to one goal and starts the day it was committed.
 */
export interface Plan {
  id: string;
  name: string;
  start_date: ISODate;
  end_date: ISODate;
  block_days: number;
  archived_at: string | null;
  /** True for a goal's own clock. Missing on older databases (treated as a batch). */
  solo?: boolean;
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
  /** When the goal was finished (it then lives under Completed). Missing on older databases. */
  completed_at?: string | null;
  /** How it ended, in your words. */
  completion_note?: string;
  /** The group it's in (a goal is in one group at most). Missing on older databases. */
  group_id?: string | null;
}

/** A named group of goals that work together, made by dragging one goal onto another (like a phone folder). */
export interface GoalGroup {
  id: string;
  name: string;
  created_at: string;
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

/**
 * One level of a goal's breakdown: a 3-month stage, a month, or a week.
 * The 6-month level is the goal itself.
 */
export interface PlanStep {
  id: string;
  goal_id: string;
  plan_id: string;
  parent_id: string | null;
  level: StepLevel;
  /** Position among its siblings, 0-based. */
  idx: number;
  title: string;
  start_date: ISODate;
  end_date: ISODate;
  /** For "reach a number" goals: where the value should be by end_date. */
  target_value: number | null;
  /** What this stage should look like, in your own words. */
  target_note: string;
  completed_at: string | null;
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
  /** The breakdown step (usually a week) this task was planned in; null for ongoing actions. */
  step_id?: string | null;
  /** An "after ___, at ___" cue that says when the task happens (optional). */
  cue?: string;
  /** For a measure task: the measurement it records (e.g. Weight). Missing on older databases. */
  measurement_type_id?: string | null;
  /** What the task involves, in your words: a workout's exercises, a study plan. Shown when you log it. */
  details?: string;
  archived_at: string | null;
}

/** Two goals you connected by hand (e.g. Work out and Lose weight). Order of the pair doesn't matter. */
export interface GoalLink {
  id: string;
  goal_a: string;
  goal_b: string;
  /** How they're connected, in your words (optional). */
  note: string;
  created_at: string;
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

/** A photo or any other file attached to a logged task. The bytes live in file storage; this row says where. */
export interface Attachment {
  id: string;
  session_id: string;
  action_id: string | null;
  /** Where the file lives in storage. */
  path: string;
  /** The file name as picked. */
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
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
  /** Shown in Today's numbers for a daily entry. Unset: on for a goal's main number, off for the rest. */
  on_today?: boolean | null;
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

export type CommitmentAnswer = 'yes' | 'partly' | 'no';
export type GoalResult = 'hit' | 'partly' | 'missed';
export type GoalDecision = 'keep' | 'adjust' | 'drop';

/** How one goal's period goal (week, month, 3 months or the whole plan) turned out. */
export interface ReviewGoalResult {
  goal_id: string;
  /** 'plan' = the 6-month goal itself (retrospective). */
  level: StepLevel | 'plan';
  step_id: string | null;
  /** The goal as it was written for the period. */
  note: string;
  result: GoalResult;
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
  // Added by the review overhaul. Older rows (or a database without the migration) may not have them.
  /** Did last review's "change next" happen? */
  commitment_kept?: CommitmentAnswer | null;
  goal_results?: ReviewGoalResult[];
  /** 3-month checkpoint: what was decided for each goal. */
  goal_decisions?: { goal_id: string; decision: GoalDecision }[];
  /** Retrospective: what carries into the next plan. */
  carry_forward?: string;
  minutes_planned?: number;
  minutes_done?: number;
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

/** Where a goal idea is in the backlog: waiting, selected for the next commitment, started as a goal, or let go. */
export type IdeaStatus = 'backlog' | 'selected' | 'started' | 'discarded';

/** A goal you might want: written down in a line, ordered by importance, pulled in when there's room. */
export interface GoalIdea {
  id: string;
  title: string;
  /** Why it matters (needed to select it). */
  note: string;
  /** What done looks like in six months, in a line (needed to select it). Missing on older databases. */
  done_means?: string;
  /** The plan prepared while it's selected (its chain and first daily task); committing turns it into a goal. */
  prep?: IdeaPrep;
  status: IdeaStatus;
  /** Order within its column: lower comes first (more important). */
  rank: number;
  /** The goal it became, once started. */
  goal_id: string | null;
  created_at: string;
  selected_at: string | null;
  started_at: string | null;
}

/**
 * What gets prepared for a selected idea before it's committed as a goal. Saved on the idea,
 * so preparing never creates the goal: committing does, as a separate step.
 */
export interface IdeaPrep {
  type?: GoalType;
  unit?: string;
  measure_name?: string;
  baseline?: number | null;
  target?: number | null;
  target_date?: ISODate;
  path_edits?: Record<string, number>;
  milestones?: { title: string; due_date: ISODate }[];
  quarter?: string;
  month?: string;
  week?: string;
  /** Start of the 3-month stage, month and week each note was written for (a note goes stale when its period ends). */
  quarter_of?: ISODate;
  month_of?: ISODate;
  week_of?: ISODate;
  task?: { title: string; days: number[]; minutes: number };
  /** Goals to connect this one to when it's committed. */
  connect?: string[];
  /** Existing daily tasks (action ids) this goal will share when it's committed. */
  reuse?: string[];
  /** Timing: its own clock starting the day it's committed, or joining a batch (plan_id). */
  clock?: 'own' | 'batch';
  /** Length of its own clock, in months (3 or 6). */
  months?: number;
  plan_id?: string;
  prepared_at?: string;
}
