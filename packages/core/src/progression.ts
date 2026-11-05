/**
 * Progression and effort rules: what each exercise asks for next time, by its class.
 *
 * Rule 1, classes: every exercise is compound, isolation, assisted or bodyweight (from its name,
 * or set on the plan). Rule 2, progression by class:
 * - compound: reps, then load. Every set at the top of the range, then the smallest standard step
 *   (+5 lb a dumbbell, one plate on a machine or cable), back to the bottom of the range.
 * - isolation: reps, then a set (up to 4), then the smallest load step (2.5 lb), back to the
 *   original sets. No small enough step (10 → 15 lb is +50%): tempo instead (3 s down, 1 s pause).
 * - assisted: every set at the top, 5 lb less assist. Logged as the assist; lower is harder.
 * - bodyweight: every set at the top, add a plate.
 * Shared: a lift on more than one day carries a load increase to the other days (assisted keeps
 * its per-day assist); a jump that drops the first set below the range goes back to the old load.
 * Rule 3, effort targets by class. Rule 4, a stall (no more reps or load 2 sessions in a row) and the
 * deload week (every 8 weeks, or sooner when several lifts stall): half the sets, same loads, 3–4 RIR.
 * Rule 7, the cut ends at a 7-day average of 175 lb (the app asks before switching to build).
 */
import { addDays, daysBetween, weekStart, type ISODate } from './dates.ts';
import type { PlannedExercise } from './workout.ts';

export type ExerciseClass = 'compound' | 'isolation' | 'assisted' | 'bodyweight';

export const CLASS_WORDS: Record<ExerciseClass, string> = {
  compound: 'Compound',
  isolation: 'Isolation',
  assisted: 'Assisted',
  bodyweight: 'Bodyweight',
};

const ISOLATION = /curl|pushdown|push-down|kick-?back|triceps|tricep|extension(?!.*back)|raise|fly|flye|rear[- ]delt|straight[- ]arm|external rotation|internal rotation|face pull|shrug|pullover/i;
const BODYWEIGHT = /crunch|sit-?up|back extension|hip extension|glute[- /]?ham|plank|hanging leg|leg raise/i;
const COMPOUND = /press|row|pull-?down|pull-?up|chin-?up|dip|squat|deadlift|lunge/i;

/**
 * An exercise's class: the plan's own setting when it has one, else from the name. Assisted
 * first (an assisted pull-up is assisted, not compound), then bodyweight moves, then isolation
 * patterns (so a chest-supported rear-delt row or a straight-arm pulldown is isolation), then
 * compound patterns; anything else is isolation, the cautious default.
 */
export function exerciseClass(ex: Pick<PlannedExercise, 'name' | 'weight_note'> & { class?: ExerciseClass | null }): ExerciseClass {
  if (ex.class) return ex.class;
  const n = ex.name;
  if (/assisted/i.test(n)) return 'assisted';
  if (BODYWEIGHT.test(n) || (/body ?weight|^bw$/i.test(ex.weight_note ?? '') && !COMPOUND.test(n))) return 'bodyweight';
  if (ISOLATION.test(n)) return 'isolation';
  if (COMPOUND.test(n)) return 'compound';
  return 'isolation';
}

/** One set as logged, with its reps in reserve when given. */
export interface LoggedSet {
  weight: number | null;
  reps: number | null;
  done: boolean;
  rir?: number | null;
}

/** One past session of an exercise: its day, its sets, and whether it was a deload week. */
export interface ExerciseSession {
  date: ISODate;
  sets: LoggedSet[];
  deload?: boolean;
}

export interface ProgressionSteps {
  /** The smallest standard step for a compound lift (a dumbbell 5 lb, a plate on a machine or cable). */
  compound: number;
  /** The smallest step for an isolation lift (2.5 lb dumbbells, the smallest cable plate); null when there's none. */
  isolation: number | null;
  /** How much less assist per step. */
  assist: number;
  /** Above this share of the current weight, the isolation step is too big: tempo instead (0.25 = 25%). */
  max_isolation_jump: number;
}

export const DEFAULT_STEPS: ProgressionSteps = { compound: 5, isolation: 2.5, assist: 5, max_isolation_jump: 0.25 };

export type TargetWhy =
  | 'plan' // first time: the plan's weight
  | 'hold' // same weight, chase reps
  | 'add_set' // isolation: every set at the top, one more set
  | 'load_up' // more weight (or a plate on a bodyweight move)
  | 'assist_down' // assisted: less assist
  | 'tempo' // isolation with no small enough step
  | 'failed_jump' // the last jump dropped set 1 below the range: back to the old load
  | 'carry' // the same lift went up on another day
  | 'deload'; // deload week

export interface Target {
  cls: ExerciseClass;
  /** Weight to start with (the assist, for an assisted lift); null for bodyweight or "find it". */
  weight: number | null;
  sets: number;
  reps_min: number;
  /** The top of the range, capped by a limit (lateral raises at 12). */
  reps_max: number;
  why: TargetWhy;
  /** One line on why, for the log: "All sets at 12: add a 4th set today." */
  text: string;
  /** The effort to aim for, in reps in reserve. */
  effort: string;
  /** Hold the same load and slow it down: 3 s lowering, 1 s pause at the stretch. */
  tempo?: boolean;
}

const fmtW = (n: number) => String(Math.round(n * 100) / 100);
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** The top weight used in a session, and its sets (the working sets). */
function working(s: ExerciseSession): { weight: number | null; sets: LoggedSet[] } {
  const done = s.sets.filter((x) => x.done && (x.reps ?? 0) > 0);
  if (!done.length) return { weight: null, sets: [] };
  const weights = done.map((x) => x.weight).filter((w): w is number => w != null);
  if (!weights.length) return { weight: null, sets: done };
  return { weight: Math.max(...weights), sets: done.filter((x) => x.weight === Math.max(...weights)) };
}

/** An assisted lift's working sets are at its lowest assist, not its highest. */
function workingAssisted(s: ExerciseSession): { weight: number | null; sets: LoggedSet[] } {
  const done = s.sets.filter((x) => x.done && (x.reps ?? 0) > 0);
  const weights = done.map((x) => x.weight).filter((w): w is number => w != null);
  if (!weights.length) return { weight: null, sets: done };
  const w = Math.min(...weights);
  return { weight: w, sets: done.filter((x) => x.weight === w) };
}

/** Effort to aim for, by class (Rule 3). Capped lateral raises: failure between 8 and the cap. */
export function effortTarget(cls: ExerciseClass, cap: number | null, deload = false): string {
  if (deload) return '3–4 reps left on every set (deload week).';
  if (cap != null) return `Pick a weight where failure lands between 8 and ${cap} reps. Never go past ${cap}.`;
  if (cls === 'isolation') return '1–2 reps left on early sets, 0–1 on the last set (no clean rep left, no swinging).';
  return '1–2 reps left on every set.';
}

/** The rep cap a limit puts on an exercise (lateral raises at 12), or null. */
export function repCap(name: string, caps: { match: string; max: number }[]): number | null {
  const hit = caps.filter((c) => c.match && new RegExp(c.match, 'i').test(name));
  return hit.length ? Math.min(...hit.map((c) => c.max)) : null;
}

export interface TargetInput {
  ex: PlannedExercise & { class?: ExerciseClass | null };
  /** This workout's past sessions of the exercise, oldest first. */
  history: ExerciseSession[];
  /** The newest session of the same lift on another day (for carrying a load increase). */
  elsewhere?: ExerciseSession | null;
  steps?: ProgressionSteps;
  /** A cap on reps from a limit (lateral raises: 12). */
  cap?: number | null;
  deload?: boolean;
  /**
   * The plan's weight for this exercise when it was last done (undefined: not known). When you've
   * changed the plan's weight since, the plan wins until you've done it at least once.
   */
  planWeightThen?: number | null;
}

/**
 * What to do next time (Rule 2): weight, sets and range, with a line on why. Deload weeks halve
 * the plan's sets at the same load. Everything judges the last non-deload session.
 */
export function nextTarget({ ex, history, elsewhere = null, steps = DEFAULT_STEPS, cap = null, deload = false, planWeightThen }: TargetInput): Target {
  const cls = exerciseClass(ex);
  const reps_max = cap != null ? Math.min(ex.reps_max, cap) : ex.reps_max;
  const reps_min = Math.min(ex.reps_min, reps_max);
  const base = { cls, sets: ex.sets, reps_min, reps_max, effort: effortTarget(cls, cap, deload) };
  const real = history.filter((h) => !h.deload && working(h).sets.length);
  const assisted = cls === 'assisted';
  const work = (s: ExerciseSession) => (assisted ? workingAssisted(s) : working(s));
  const last = real.at(-1);

  if (deload) {
    const w = last ? work(last).weight : ex.weight;
    return { ...base, weight: w ?? ex.weight, sets: Math.max(1, Math.ceil(ex.sets / 2)), why: 'deload', text: `Deload week: ${Math.max(1, Math.ceil(ex.sets / 2))} sets at the same ${assisted ? 'assist' : 'weight'}, 3–4 reps left on every set.` };
  }

  let t: Target;
  if (!last) {
    t = { ...base, weight: ex.weight, why: 'plan', text: '' };
  } else if (!assisted && ex.weight != null && planWeightThen !== undefined && planWeightThen !== ex.weight) {
    // You changed the plan's weight since you last did it: the plan wins this time.
    t = { ...base, weight: ex.weight, why: 'plan', text: `Your plan: ${fmtW(ex.weight)} (changed since last time${planWeightThen != null ? `, from ${fmtW(planWeightThen)}` : ''}).` };
  } else {
    const { weight: W, sets: atW } = work(last);
    const n = atW.length;
    const allTop = n >= ex.sets && atW.every((s) => (s.reps ?? 0) >= reps_max);
    const prev = real.at(-2);
    const prevW = prev ? work(prev).weight : null;
    // Failed jump: the load went up (assist down) last time and set 1 fell below the range.
    const jumped = W != null && prevW != null && (assisted ? W < prevW : W > prevW);
    const firstReps = work(last).sets[0]?.reps ?? last.sets.find((s) => s.done)?.reps ?? 0;
    if (jumped && firstReps < reps_min) {
      const setStep = cls === 'isolation' && ex.sets < 4;
      t = {
        ...base,
        weight: prevW,
        sets: setStep ? ex.sets + 1 : ex.sets,
        why: 'failed_jump',
        tempo: cls === 'isolation' && !setStep,
        text: `Back to ${fmtW(prevW!)}${assisted ? ' assist' : ''}: the jump to ${fmtW(W!)} dropped set 1 to ${firstReps} reps.${cls === 'isolation' ? (setStep ? ' Add a set there instead.' : ' Slow the tempo there instead (3 s down, 1 s pause).') : ' Build reps there first.'}`,
      };
    } else if (assisted && !allTop && W != null && last.sets.filter((x) => x.done && (x.reps ?? 0) > 0).every((x) => (x.reps ?? 0) >= reps_max)) {
      // Assist lowered set by set, every set at the top: start every set at the lowest assist used.
      t = { ...base, weight: W, why: 'assist_down', text: `Every set reached ${reps_max}+ while you lowered the assist: start all ${ex.sets} sets at ${fmtW(W)}.` };
    } else if (!allTop) {
      // Isolation keeps a set it added (the session before had the plan's sets, all at the top, at
      // this weight) until the load goes up. Extra sets from an older, longer plan don't count.
      const prevWork = prev ? work(prev) : null;
      const added = cls === 'isolation' && n === ex.sets + 1 && prevWork != null && prevWork.weight === W && prevWork.sets.length === ex.sets && prevWork.sets.every((x) => (x.reps ?? 0) >= reps_max);
      const what = cls === 'bodyweight' && W == null ? 'Get' : `Same ${assisted ? 'assist' : 'weight'}: get`;
      t = { ...base, weight: W ?? ex.weight, sets: added ? n : ex.sets, why: 'hold', text: `${what} every set to ${reps_max}.` };
    } else if (cls === 'compound') {
      t = W == null
        ? { ...base, weight: null, why: 'hold', text: `Every set at ${reps_max}: add load.` }
        : { ...base, weight: W + steps.compound, why: 'load_up', text: `Every set at ${reps_max} last time: up to ${fmtW(W + steps.compound)}, aim for ${reps_min}+ reps.` };
    } else if (cls === 'assisted') {
      const next = Math.max(0, (W ?? 0) - steps.assist);
      t = { ...base, weight: W == null ? null : next, why: 'assist_down', text: `Every set at ${reps_max} last time: ${steps.assist} lb less assist${W == null ? '' : ` (${fmtW(next)})`}.` };
    } else if (cls === 'bodyweight') {
      const plate = /crunch|sit-?up/i.test(ex.name) ? 'hold a 5 lb plate on your chest' : /back extension/i.test(ex.name) ? 'hold a plate on your chest' : 'add a plate';
      t = W != null && W > 0
        ? { ...base, weight: W + 5, why: 'load_up', text: `Every set at ${reps_max} with ${fmtW(W)}: up to ${fmtW(W + 5)}.` }
        : { ...base, weight: null, why: 'load_up', text: `Every set at ${reps_max}: ${plate} now.` };
    } else {
      // Isolation: a set first (up to 4), then the smallest load step, back to the plan's sets.
      if (n <= ex.sets && n < 4) {
        t = { ...base, weight: W ?? ex.weight, sets: n + 1, why: 'add_set', text: `Every set at ${reps_max}: add a ${ordinal(n + 1)} set today, same weight.` };
      } else if (W == null) {
        t = { ...base, weight: null, why: 'hold', text: `Every set at ${reps_max}: add load.` };
      } else if (steps.isolation != null && steps.isolation / W <= steps.max_isolation_jump) {
        t = { ...base, weight: W + steps.isolation, why: 'load_up', text: `All ${n} sets at ${reps_max}+: up to ${fmtW(W + steps.isolation)}, back to ${ex.sets} sets from ${reps_min} reps.` };
      } else {
        t = { ...base, weight: W, sets: Math.min(4, n), why: 'tempo', tempo: true, text: `All sets at ${reps_max}, but the next weight is too big a jump. Same weight, slower: 3 s down, 1 s pause at the stretch. Or move it to a cable for finer steps.` };
      }
    }
  }

  // Shared rule: the same lift went up on another day since this workout last did it (not assisted).
  if (!assisted && elsewhere && t.weight != null && t.why !== 'failed_jump') {
    const ew = working(elsewhere).weight;
    const lastDate = last?.date ?? '';
    if (ew != null && ew > t.weight && elsewhere.date > lastDate) {
      t = { ...t, weight: ew, sets: ex.sets, why: 'carry', tempo: false, text: `Up to ${fmtW(ew)}: it went up on another day. Aim for ${reps_min}+ reps.` };
    }
  }
  return t;
}

/**
 * Stall (Rule 4): no more reps or load for 2 sessions in a row. Compares the last three
 * non-deload sessions: neither of the last two beat the best before it on load (assist: lower)
 * or, at the same load, on total reps or sets.
 */
export function isStalled(history: ExerciseSession[], cls: ExerciseClass): boolean {
  const real = history.filter((h) => !h.deload && h.sets.some((s) => s.done && (s.reps ?? 0) > 0));
  if (real.length < 3) return false;
  const pick = cls === 'assisted' ? workingAssisted : working;
  const score = (s: ExerciseSession) => {
    const w = pick(s);
    return { w: w.weight, reps: w.sets.reduce((a, x) => a + (x.reps ?? 0), 0), n: w.sets.length };
  };
  const better = (a: ReturnType<typeof score>, b: ReturnType<typeof score>) => {
    if (a.w != null && b.w != null && a.w !== b.w) return cls === 'assisted' ? b.w < a.w : b.w > a.w;
    return b.reps > a.reps || b.n > a.n;
  };
  const [a, b, c] = real.slice(-3).map(score) as [ReturnType<typeof score>, ReturnType<typeof score>, ReturnType<typeof score>];
  // Each session against the best before it: matching an old best after a dip isn't progress.
  const best = better(a, b) ? b : a;
  return !better(a, b) && !better(best, c);
}

export interface DeloadPlan {
  /** Mondays of deload weeks, oldest first, from the program's start up to `monday`. */
  weeks: ISODate[];
  /** Whether `monday`'s week is a deload week. */
  now: boolean;
  /** Why this week is one: "8 weeks since the last one" or "4 lifts stalled last week". */
  reason: string | null;
  /** The next week that will be one at the latest (the 8th week since the last deload). */
  dueBy: ISODate;
}

/**
 * Deload weeks (Rule 4): the 8th week after the start or the last deload, or sooner (from the
 * 4th week) when `stallTrigger` lifts were stalled going into the week. Weeks you said no to
 * (`skipped`) aren't deloads; the next week is then due.
 */
export function deloadPlan(start: ISODate, monday: ISODate, stalledBefore: (monday: ISODate) => number, skipped: ISODate[] = [], every = 8, stallTrigger = 3): DeloadPlan {
  const first = weekStart(start);
  const weeks: ISODate[] = [];
  let since = first;
  let reason: string | null = null;
  for (let w = first; w <= monday; w = addDays(w, 7)) {
    const n = Math.round(daysBetween(since, w) / 7) + 1; // this is the n-th week of the block
    const stalled = n >= 4 ? stalledBefore(w) : 0;
    const due = n >= every || stalled >= stallTrigger;
    if (due && !skipped.includes(w)) {
      weeks.push(w);
      if (w === monday) reason = n >= every ? `${every} weeks since ${since === first ? 'you started' : 'the last deload'}` : `${stalled} lifts stalled going into this week`;
      since = addDays(w, 7);
    }
  }
  return { weeks, now: weeks.at(-1) === monday, reason, dueBy: addDays(since, (every - 1) * 7) };
}

export interface PhaseState {
  phase: 'cut' | 'build';
  /** The 7-day average that ends the cut. */
  target: number;
  /** When it switched to build. */
  switched_on?: ISODate | null;
  /** "Not yet" on the switch prompt, until this day. */
  snoozed_until?: ISODate | null;
}

export const DEFAULT_PHASE: PhaseState = { phase: 'cut', target: 175 };

/** Saved on the profile (profiles.training_state). */
export interface TrainingState extends PhaseState {
  /** Mondays of deload weeks you said no to. */
  deload_skipped: ISODate[];
}

export function trainingState(saved: Partial<TrainingState> | null | undefined): TrainingState {
  return { ...DEFAULT_PHASE, deload_skipped: [], ...(saved ?? {}) } as TrainingState;
}

/** Rule 7: the cut is done when the 7-day average reaches the target; ask then (unless snoozed). */
export function phaseSwitchDue(state: PhaseState, average: number | null, today: ISODate): boolean {
  if (state.phase !== 'cut' || average == null) return false;
  if (state.snoozed_until && today <= state.snoozed_until) return false;
  return average <= state.target;
}
