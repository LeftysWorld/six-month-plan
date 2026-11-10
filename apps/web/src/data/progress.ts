import {
  addDays,
  deloadPlan,
  equipmentKind,
  exerciseClass,
  isStalled,
  isWeightType,
  nextTarget,
  phaseSwitchDue,
  repCap,
  rollingAverage,
  stepFor,
  trainingRules,
  trainingState,
  weekStart,
  type DeloadPlan,
  type ExerciseSession,
  type ISODate,
  type PlannedExercise,
  type ProgressionSteps,
  type Session,
  type Target,
  type TrainingLimit,
  type TrainingState,
  pushupRole,
  pushupTarget,
  type PushupHistory,
  type PushupRole,
  type PushupTarget,
} from '@six/core';
import type { AppData, Op } from './model.ts';

/**
 * The progression rules (core/progression.ts) on your data: each exercise's past sessions from
 * your logs, deload weeks, stalls, the shoulder pain check and the cut's end.
 */

const logged = (s: Session) => s.status !== 'planned' && s.status !== 'skipped' && s.status !== 'moved';
const dayOf = (s: Session) => s.date ?? s.week_start;

/** Past sessions of one exercise, oldest first: in one workout (`actionId`), or in every other one. */
function sessionsOf(data: AppData, name: string, before: ISODate, opts: { actionId?: string | null; notActionId?: string | null }, deloads: Set<ISODate>): ExerciseSession[] {
  const key = name.toLowerCase();
  const byId = new Map(
    data.sessions
      .filter((s) => logged(s) && dayOf(s) < before && (opts.actionId == null || s.action_id === opts.actionId) && (opts.notActionId == null || s.action_id !== opts.notActionId))
      .map((s) => [s.id, s] as const),
  );
  const out = new Map<string, ExerciseSession>();
  for (const w of data.workoutSets) {
    const s = byId.get(w.session_id);
    if (!s || w.exercise.toLowerCase() !== key) continue;
    const e = out.get(s.id) ?? { date: dayOf(s), sets: [], deload: deloads.has(weekStart(dayOf(s))) };
    e.sets.push({ weight: w.weight == null ? null : Number(w.weight), reps: w.reps, done: w.done, rir: w.rir ?? null });
    out.set(s.id, e);
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Every workout's planned exercises, for counting stalls. */
function plannedLifts(data: AppData): { actionId: string; ex: PlannedExercise }[] {
  return data.actions.filter((a) => !a.archived_at && a.kind === 'workout' && a.workout_plan?.length).flatMap((a) => a.workout_plan!.map((ex) => ({ actionId: a.id, ex })));
}

/** How many lifts were stalled going into the week of `monday` (each workout's exercises separately). */
export function stalledBefore(data: AppData, monday: ISODate): number {
  return plannedLifts(data).filter(({ actionId, ex }) => !pushupRole(ex.name) && isStalled(sessionsOf(data, ex.name, monday, { actionId }, new Set()), exerciseClass(ex))).length;
}

/** Deload weeks from the program's start to `monday` (the 8th week, or sooner when 3+ lifts stall). */
export function deloadFor(data: AppData, monday: ISODate): DeloadPlan {
  const rules = trainingRules(data.profile.training_rules);
  const state = trainingState(data.profile.training_state);
  return deloadPlan(rules.program_start, monday, (m) => stalledBefore(data, m), state.deload_skipped);
}

/** Your limits' rep caps (lateral raises at 12). */
export function repCaps(data: AppData): { match: string; max: number }[] {
  return trainingRules(data.profile.training_rules).limits.flatMap((l) => l.rep_caps ?? []);
}

/** The steps for one exercise: compound from your weight steps, isolation from the small steps, assist. */
function stepsFor(data: AppData, ex: PlannedExercise): ProgressionSteps {
  const rules = trainingRules(data.profile.training_rules);
  const kind = equipmentKind(ex.name, ex.weight_note);
  const iso = kind === 'cable' ? rules.iso_steps.cable : kind === 'machine' ? rules.steps.machine : rules.iso_steps.dumbbell;
  return { compound: stepFor(ex.name, rules, ex.weight_note) || rules.steps.dumbbell, isolation: iso > 0 ? iso : null, assist: rules.assist_step, max_isolation_jump: 0.25 };
}

/**
 * The plan's range under your rep cap (Settings → Training): bodyweight lifts are left alone; a range
 * that reaches past the cap ends at it and starts 2 below (12–15 → 10–12, 15 → 10–12).
 */
export function capPlan(ex: PlannedExercise, maxReps: number): PlannedExercise {
  if (!maxReps || maxReps <= 0 || ex.reps_max <= maxReps || exerciseClass(ex) === 'bodyweight') return ex;
  return { ...ex, reps_max: maxReps, reps_min: Math.max(1, Math.min(ex.reps_min, maxReps - 2)) };
}

export interface ExerciseTarget extends Target {
  stalled: boolean;
  cap: number | null;
  /** Road to 100 Push-Ups: the day's numbers from Saturday's max. */
  pushup?: PushupTarget;
}

/** Push-up tests and the last volume day before `day` (every workout; the program runs across days). */
function pushupHistory(data: AppData, day: ISODate): PushupHistory {
  const tests: PushupHistory['tests'] = [];
  let lastVolume: PushupHistory['lastVolume'] = null;
  const byName = new Map<string, PushupRole>();
  for (const w of data.workoutSets) {
    if (!byName.has(w.exercise)) byName.set(w.exercise, pushupRole(w.exercise) as PushupRole);
  }
  for (const [name, role] of byName) {
    if (!role) continue;
    for (const s of sessionsOf(data, name, day, {}, new Set())) {
      const reps = s.sets.filter((x) => x.done && (x.reps ?? 0) > 0).map((x) => x.reps ?? 0);
      if (!reps.length) continue;
      if (role === 'test') tests.push({ date: s.date, max: Math.max(...reps) });
      else if (!lastVolume || s.date > lastVolume.date) lastVolume = { date: s.date, reps };
    }
  }
  tests.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { tests, lastVolume };
}

/** The starting max before the first test: the test's planned reps, else the volume day's reps ÷ 60%. */
function pushupEstimate(data: AppData): number {
  const all = plannedLifts(data).map((p) => p.ex);
  const test = all.find((e) => pushupRole(e.name) === 'test');
  if (test) return test.reps_max;
  const vol = all.find((e) => pushupRole(e.name) === 'volume');
  return vol ? Math.round(vol.reps_max / 0.6) : 10;
}

/** Next targets for a workout's exercises on its day, with stall flags. */
export function targetsFor(data: AppData, session: Session, plan: PlannedExercise[]): { targets: ExerciseTarget[]; deload: DeloadPlan } {
  const day = dayOf(session);
  const deload = deloadFor(data, weekStart(day));
  const deloads = new Set(deload.weeks);
  const caps = repCaps(data);
  const maxReps = trainingRules(data.profile.training_rules).max_reps;
  const targets = plan.map((planned): ExerciseTarget => {
    const role = pushupRole(planned.name);
    if (role) {
      const p = pushupTarget(role, day, pushupHistory(data, day), pushupEstimate(data), deload.now);
      return { cls: 'bodyweight', weight: null, sets: p.sets, reps_min: p.reps, reps_max: role === 'test' ? p.reps : p.reps, why: 'pushups', text: p.text, effort: p.effort, cap: null, stalled: false, pushup: p };
    }
    const ex = capPlan(planned, maxReps);
    const history = sessionsOf(data, ex.name, day, { actionId: session.action_id }, deloads);
    const others = sessionsOf(data, ex.name, day, { notActionId: session.action_id }, deloads).filter((s) => !s.deload);
    const cap = repCap(ex.name, caps);
    const lastOwn = history.filter((h) => !h.deload).at(-1);
    const planWeightThen = lastOwn ? planWeightOn(data, session.action_id, ex.name, lastOwn.date) : undefined;
    const t = nextTarget({ ex, history, elsewhere: others.at(-1) ?? null, steps: stepsFor(data, ex), cap, deload: deload.now, planWeightThen });
    return { ...t, cap, stalled: !deload.now && isStalled(history, t.cls) };
  });
  return { targets, deload };
}

/**
 * The plan's weight for an exercise as it stood on `date` (the version in effect that day), so a
 * weight you changed in the plan since then wins. Undefined when there's no version or no such exercise.
 */
function planWeightOn(data: AppData, actionId: string | null | undefined, name: string, date: ISODate): number | null | undefined {
  const versions = data.planVersions
    .filter((v) => v.action_id === actionId && v.effective_on <= date)
    .sort((a, b) => (a.effective_on !== b.effective_on ? (a.effective_on < b.effective_on ? -1 : 1) : (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1));
  const plan = versions.at(-1)?.plan as PlannedExercise[] | undefined;
  const ex = plan?.find((e) => e.name.toLowerCase() === name.toLowerCase());
  return ex ? ex.weight : undefined;
}

/** "Not this week": the deload moves to next week (one undo). */
export function opsSkipDeload(data: AppData, monday: ISODate): { ops: Op[]; undo: Op[] } {
  const before = data.profile.training_state ?? null;
  const state = trainingState(before);
  const next: TrainingState = { ...state, deload_skipped: [...new Set([...state.deload_skipped, monday])] };
  return {
    ops: [{ kind: 'profile', patch: { training_state: next } } as Op],
    undo: [{ kind: 'profile', patch: { training_state: before } } as Op],
  };
}

/** The limit that asks for a pain check when you finish a workout (the left shoulder), if any. */
export function painCheck(data: AppData): TrainingLimit | null {
  return trainingRules(data.profile.training_rules).limits.find((l) => l.pain_check) ?? null;
}

/** Body weight: the latest reading and the 7-day average, from the weight measurement. */
export function bodyWeight(data: AppData, today: ISODate): { latest: number | null; average: number | null } {
  const type = data.measurementTypes.find((t) => !t.archived_at && isWeightType(t));
  if (!type) return { latest: null, average: null };
  const readings = data.measurements.filter((m) => m.type_id === type.id && m.measured_on <= today).sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1));
  return { latest: readings.length ? Number(readings.at(-1)!.value) : null, average: rollingAverage(readings, today) };
}

/** Rule 7: the cut reached its target (7-day average): Today asks to switch to build. */
export function phasePrompt(data: AppData, today: ISODate): { average: number; target: number } | null {
  const state = trainingState(data.profile.training_state);
  const { average } = bodyWeight(data, today);
  return phaseSwitchDue(state, average, today) && average != null ? { average, target: state.target } : null;
}

export function opsPhase(data: AppData, change: { build: true; today: ISODate } | { snooze: ISODate }): { ops: Op[]; undo: Op[] } {
  const before = data.profile.training_state ?? null;
  const state = trainingState(before);
  const next: TrainingState = 'build' in change ? { ...state, phase: 'build', switched_on: change.today, snoozed_until: null } : { ...state, snoozed_until: change.snooze };
  return { ops: [{ kind: 'profile', patch: { training_state: next } } as Op], undo: [{ kind: 'profile', patch: { training_state: before } } as Op] };
}

export const nextWeek = (monday: ISODate) => addDays(monday, 7);
