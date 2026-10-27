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
  /** Someone who gets your weekly digest by email (blank = no one). */
  partner_email?: string | null;
  /** Sunday-evening push: "two minutes to review". Default on. */
  review_reminder?: boolean;
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
  /** When work on it starts, if later than its window's start (set on the roadmap). Missing on older databases. */
  start_date?: ISODate | null;
  /** Your own words from the Then vs now page. Missing on older databases. */
  reflection?: string;
  /** The Odyssey path this goal is a bet on. Missing on older databases. */
  path_id?: string | null;
  /** The treat for finishing this goal, in your words ("a weekend away"). Blank = none. Missing on older databases. */
  prize?: string;
  /** The extra treat for finishing by the target date it had when the prize was set. */
  prize_on_time?: string;
  /** The target date the on-time bonus is judged against (fixed when the bonus is set, so moving the date later can't move the bonus). */
  target_date_at_set?: ISODate | null;
  prize_claimed_at?: string | null;
  prize_on_time_claimed_at?: string | null;
  /** Hand-set position among its siblings (its group, or the loose goals) on the Goals page. Missing on older databases. */
  sort_order?: number | null;
}

/** A named group of goals that work together, made by dragging one goal onto another (like a phone folder). */
export interface GoalGroup {
  id: string;
  name: string;
  created_at: string;
  /** The treat for the whole group landing (enough of its goals finished by season end). Missing on older databases. */
  prize?: string;
  /** Share of the group's goals that must finish for the prize, 0–1 (default 0.85). */
  prize_threshold?: number | null;
  prize_claimed_at?: string | null;
  /** The group's one-line week goal ("250 applications and prereqs done"), and the Monday it's for. */
  week_goal?: string;
  week_goal_for?: ISODate | null;
  /** Hand-set position among groups on the Goals page. Missing on older databases. */
  sort_order?: number | null;
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
  /** For a number goal: the reading that marks this date hit (184.2). A reading at or past it completes the milestone by itself. Missing on older databases. */
  value?: number | null;
  /** The treat for hitting it ("a nice burr grinder"). Blank = none. */
  prize?: string;
  prize_claimed_at?: string | null;
  /** A running total: the count task whose logs add up to `value` ("250 applications" from "Apply to 25 jobs"). Missing on older databases. */
  count_action_id?: string | null;
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
  /** A workout task's plan: each exercise with sets, reps and a target weight. Missing on older databases. */
  workout_plan?: import('./workout.ts').PlannedExercise[] | null;
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
  /**
   * The window (batch or own clock) a month, 3-month or retrospective review belongs to. Weekly
   * reviews cover every goal and leave it null. Rows from before the review-fixes migration have none.
   */
  plan_id?: string | null;
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
  /** The weekly digest as text, written when the review is saved; mailed to the partner by send-digests. */
  digest?: string;
  digest_sent_at?: string | null;
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
export type IdeaStatus = 'backlog' | 'started' | 'discarded';

/** A goal you might want: written down in a line, ordered by importance, pulled in when there's room. */
export interface GoalIdea {
  id: string;
  title: string;
  /** Why it matters. */
  note: string;
  /** What done looks like in six months, in a line. Missing on older databases. */
  done_means?: string;
  status: IdeaStatus;
  /** Order within its column: lower comes first (more important). */
  rank: number;
  /** The goal it became, once started. */
  goal_id: string | null;
  created_at: string;
  started_at: string | null;
  /** The Odyssey path this idea belongs to. Missing on older databases. */
  path_id?: string | null;
}

// ---------- Odyssey paths ----------

/** The four gauges from Designing Your Life, each 1–5. */
export interface PathGauges {
  /** Time, money, skill, contacts: do you have what this life needs? */
  resources: number;
  /** How much do you like this version of your life? */
  likability: number;
  /** How confident are you that you could pull it off? */
  confidence: number;
  /** Does it fit who you are and what you believe? */
  coherence: number;
}

export const GAUGE_KEYS: (keyof PathGauges)[] = ['resources', 'likability', 'confidence', 'coherence'];

export interface PathQuestion {
  id: string;
  text: string;
  /** What you learned once a prototype answered it. */
  answer: string;
  answered_at: string | null;
}

/**
 * An Odyssey path: one of the five-year lives you could live (Plan A: where you're heading; Plan B:
 * if A vanished; Plan C: if money and image didn't matter). Goals and ideas point at a path, so its
 * progress is measured, not guessed.
 */
/**
 * A path experiment: a small, dated thing that answers one of a path's questions ("call one
 * glamping owner and ask what they sold for", by Nov 20). It shows on Today when due and on the
 * path; finishing it writes the result, and the answer, onto the question.
 */
export interface PathExperiment {
  id: string;
  path_id: string;
  /** The question it answers (one of the path's), or null for a free experiment. */
  question_id: string | null;
  title: string;
  due_date: ISODate;
  note: string;
  /** What you learned, written when it's done. */
  result: string;
  completed_at: string | null;
  created_at: string;
}

export interface Path {
  id: string;
  name: string;
  /** The six-word version of this life. */
  headline: string;
  why: string;
  color: string;
  /** Lower first: A, B, C. */
  rank: number;
  horizon_years: number;
  /** One line per year. */
  years: string[];
  gauges: Partial<PathGauges>;
  gauge_log: { on: ISODate; gauges: Partial<PathGauges> }[];
  questions: PathQuestion[];
  /** What each season taught you about this path. */
  notes: { on: ISODate; text: string }[];
  archived_at: string | null;
  created_at: string;
}

