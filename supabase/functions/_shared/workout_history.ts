/**
 * Workout history: one snapshot of everything about your workouts up to a date, and the report you
 * read, made from that same snapshot so the two can never disagree.
 *
 * Used by the app (Workout report page, built from the data already on the device) and by the
 * workout-agent Edge Function (GET /history, which the coach agent reads). Pure TypeScript with no
 * imports, so it runs unchanged in the browser, in Deno and in the tests.
 *
 * The snapshot is a pure function of the data and the as-of date: nothing is appended to an old
 * report. Edit a past log and the next report reflects it. "What's new since the last report" is
 * worked out by comparing against the last coach report's date.
 *
 * Contract: SCHEMA_VERSION. The agent repo (workout-coach) validates against the same shape; bump
 * the version for any breaking change and update coach/snapshot.py there.
 */

export const SCHEMA_VERSION = '1';

// ---------- Input rows (the subset of each table this needs) ----------

export interface WHExercise {
  name: string;
  sets: number;
  reps_min: number;
  reps_max: number;
  per_side?: boolean;
  weight: number | null;
  weight_note?: string;
  rest?: string;
  note?: string;
}

export interface WHAction {
  id: string;
  title: string;
  kind: string;
  planned_minutes: number;
  archived_at: string | null;
  workout_plan?: WHExercise[] | null;
  details?: string;
}

export interface WHSchedule {
  action_id: string;
  rule: 'days' | 'per_week';
  days: number[];
  per_week: number | null;
  effective_from: string;
  effective_to: string | null;
}

export interface WHSession {
  id: string;
  action_id: string | null;
  date: string | null;
  week_start: string;
  title: string;
  status: string;
  planned_minutes: number;
  actual_minutes: number | null;
  note: string;
  origin?: string;
}

export interface WHSet {
  session_id: string;
  exercise: string;
  set_no: number;
  weight: number | null;
  reps: number | null;
  done: boolean;
  rir?: number | null;
  pain?: boolean | null;
}

export interface WHPlanVersion {
  action_id: string;
  plan: WHExercise[];
  details?: string;
  effective_on: string;
  source?: string;
  reason?: string;
  created_at?: string;
}

export interface WHMeasurementType {
  id: string;
  name: string;
  unit: string;
  archived_at?: string | null;
}

export interface WHMeasurement {
  type_id: string;
  value: number;
  measured_on: string;
}

/** A coach report as stored in workout_reports. */
export interface WHReport {
  id: string;
  as_of: string;
  created_at?: string;
  recommendation?: string;
  change_level?: number;
  decision?: Decision | Record<string, unknown> | null;
  user_status?: 'applied' | 'partly' | 'declined' | null;
  user_note?: string;
  model?: string;
  prompt_version?: string;
}

export interface WHProfile {
  units: string;
  timezone: string;
  coach_share_bodyweight?: boolean | null;
}

export interface HistoryInput {
  profile: WHProfile;
  actions: WHAction[];
  schedules: WHSchedule[];
  sessions: WHSession[];
  sets: WHSet[];
  planVersions: WHPlanVersion[];
  measurementTypes: WHMeasurementType[];
  measurements: WHMeasurement[];
  reports: WHReport[];
}

// ---------- The coach's decision (what the agent writes, what the report reads back) ----------

export type ChangeType = 'reps' | 'load' | 'sets' | 'swap' | 'add' | 'remove' | 'deload' | 'program' | 'rest' | 'other';

export interface DecisionChange {
  /** The workout's title ("Mon: Upper A"), and its task id when known. */
  workout: string;
  action_id?: string | null;
  type: ChangeType;
  exercise: string;
  /** The exercise as planned now, and as it should be (only the fields that change). */
  from?: Partial<WHExercise> | null;
  to?: Partial<WHExercise> | null;
  reason: string;
}

export interface Decision {
  recommendation: 'hold' | 'change' | 'none';
  /** 0 hold · 1 reps · 2 load · 3 sets · 4 swap one · 5 deload week · 6 new program. */
  change_level: number;
  summary: string;
  changes: DecisionChange[];
  rationale?: string[];
  would_change_mind?: string[];
  block?: { number: number; week: number } | null;
}

// ---------- Output ----------

export interface SnapshotSet {
  exercise: string;
  set_no: number;
  weight: number | null;
  reps: number | null;
  done: boolean;
  rir: number | null;
  pain: boolean;
}

export interface SnapshotSession {
  date: string;
  week_start: string;
  action_id: string | null;
  workout: string;
  /** done · partial · minimum · skipped · missed (planned and the day has passed) · planned (today or later) */
  status: string;
  minutes: number | null;
  note: string;
  sets: SnapshotSet[];
}

export interface ExerciseWeek {
  week_start: string;
  exercise: string;
  sets_done: number;
  best_weight: number | null;
  best_reps: number | null;
  e1rm: number | null;
  volume: number;
  avg_rir: number | null;
  pain: boolean;
}

export interface ExerciseMetrics {
  exercise: string;
  workouts: string[];
  planned: { sets: number; reps_min: number; reps_max: number; weight: number | null } | null;
  sessions: number;
  first_seen: string | null;
  last_seen: string | null;
  last_weight: number | null;
  /** Best estimated one-rep max (Epley) in the last 14 days, and in the 14 days ending 3 weeks ago. */
  e1rm_now: number | null;
  e1rm_3w_ago: number | null;
  e1rm_trend_pct: number | null;
  /** Whole weeks since the estimated max last went up (null with too little data). */
  weeks_since_gain: number | null;
  stalled: boolean;
  /** Sessions in a row (most recent first) where every planned set reached the top of the range at the same weight. */
  top_of_range_streak: number;
  avg_rir_2w: number | null;
  pain_flags_4w: number;
  /** The next 5 lb (or 2.5 kg) step as a share of the current weight: 0.4 means a 40% jump. */
  next_step_pct: number | null;
}

export interface Snapshot {
  meta: {
    schema_version: string;
    as_of: string;
    months: number;
    from: string;
    units: string;
    timezone: string;
    fingerprint: string;
  };
  program: {
    workouts: {
      action_id: string;
      title: string;
      days: number[];
      planned_minutes: number;
      estimated_minutes: number;
      details: string;
      exercises: WHExercise[];
      current_since: string | null;
      versions: { effective_on: string; source: string; reason: string; exercises: WHExercise[] }[];
    }[];
    workouts_per_week: number;
    /** When the program last changed shape (an exercise added, removed or swapped), and how many whole weeks ago. */
    last_structural_change_on: string | null;
    program_age_weeks: number | null;
    /** When any weight, set or rep target last changed. */
    last_target_change_on: string | null;
  };
  sessions: SnapshotSession[];
  history: ExerciseWeek[];
  metrics: {
    exercises: ExerciseMetrics[];
    attendance_4w: number | null;
    attendance_8w: number | null;
    workouts_done_4w: number;
    workouts_planned_4w: number;
    set_completion_4w: number | null;
    avg_session_minutes_4w: number | null;
    weekly_sets: { week_start: string; sets: number }[];
  };
  comments: { date: string | null; source: 'plan_note' | 'details' | 'session_note'; workout: string; exercise: string | null; text: string }[];
  bodyweight: { shared: false } | { shared: true; unit: string; latest: { date: string; value: number } | null; weekly: { week_start: string; avg: number }[]; trend_per_week: number | null };
  decisions: {
    id: string;
    as_of: string;
    recommendation: string;
    change_level: number;
    summary: string;
    changes: DecisionChange[];
    user_status: string | null;
    inferred_status: 'applied' | 'partly' | 'not_applied' | 'pending' | 'nothing_to_apply';
    user_note: string;
  }[];
  since_last: { last_report_as_of: string | null; sessions: string[]; sets: number; plan_changes: string[]; comments: number } | null;
}

// ---------- Dates (ISO strings, UTC arithmetic) ----------

const DAY = 86_400_000;
const parse = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fmtISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmtISO(parse(d) + n * DAY);
const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY);
const isoWeekday = (d: string) => {
  const w = new Date(parse(d)).getUTCDay();
  return w === 0 ? 7 : w;
};
export const mondayOf = (d: string) => addDays(d, 1 - isoWeekday(d));
const addMonths = (d: string, n: number) => {
  const dt = new Date(parse(d));
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return fmtISO(dt.getTime());
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const dayName = (d: string) => WEEKDAYS[isoWeekday(d) - 1]!;

// ---------- Small helpers ----------

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const key = (s: string) => s.trim().toLowerCase();
const DONE = new Set(['done', 'partial', 'minimum']);

/** Epley estimate of a one-rep max. Null for bodyweight sets and sets past 15 reps (the estimate stops meaning much). */
export function e1rm(weight: number | null, reps: number | null): number | null {
  if (weight == null || reps == null || weight <= 0 || reps <= 0 || reps > 15) return null;
  return round(weight * (1 + reps / 30), 1);
}

/** Minutes a workout takes: each set about 45 seconds of work plus its rest, plus 5 minutes to warm up. */
export function estimateMinutes(plan: WHExercise[]): number {
  let seconds = 5 * 60;
  for (const ex of plan) seconds += ex.sets * (45 + restSeconds(ex.rest ?? '', 90));
  return Math.round(seconds / 60);
}

function restSeconds(rest: string, fallback: number): number {
  const m = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(min|m\b|minutes?|s\b|sec|seconds?)?/i.exec(rest);
  if (!m) return fallback;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const mins = /^m/i.test(m[3] ?? '') || (!m[3] && hi <= 5);
  return Math.round(((lo + hi) / 2) * (mins ? 60 : 1));
}

/** A short, stable fingerprint (FNV-1a, 2 × 32 bits) of the snapshot's content, for "has anything changed". */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function isWorkoutAction(a: WHAction | undefined): boolean {
  return !!a && (a.kind === 'workout' || (Array.isArray(a.workout_plan) && a.workout_plan.length > 0));
}

/** The schedule a task runs on at a date. */
function scheduleOn(schedules: WHSchedule[], actionId: string, date: string): WHSchedule | null {
  return (
    schedules
      .filter((s) => s.action_id === actionId && s.effective_from <= date && (s.effective_to == null || s.effective_to >= date))
      .sort((x, y) => (x.effective_from < y.effective_from ? 1 : -1))[0] ?? null
  );
}

/** The structure of a plan: its exercise names in order. A change here is a program change; anything else is a target change. */
const shape = (plan: WHExercise[]) => plan.map((e) => key(e.name)).join('|');
const targets = (plan: WHExercise[]) => plan.map((e) => `${key(e.name)}:${e.sets}:${e.reps_min}-${e.reps_max}:${e.weight ?? ''}`).join('|');

/** Plan versions per workout, oldest first, one per day (the last edit of a day wins), with the current plan as a fallback. */
function versionsOf(input: HistoryInput, action: WHAction, asOf: string): { effective_on: string; source: string; reason: string; exercises: WHExercise[] }[] {
  const byDay = new Map<string, WHPlanVersion>();
  const own = input.planVersions
    .filter((v) => v.action_id === action.id && v.effective_on <= asOf && Array.isArray(v.plan))
    .sort((x, y) => (x.effective_on === y.effective_on ? (x.created_at ?? '').localeCompare(y.created_at ?? '') : x.effective_on < y.effective_on ? -1 : 1));
  for (const v of own) byDay.set(v.effective_on, v);
  const out = [...byDay.values()].map((v) => ({ effective_on: v.effective_on, source: v.source ?? 'app', reason: v.reason ?? '', exercises: v.plan }));
  // Drop versions that changed nothing (an edit that saved the same plan).
  const dedup = out.filter((v, i) => i === 0 || targets(v.exercises) !== targets(out[i - 1]!.exercises));
  if (dedup.length === 0 && action.workout_plan?.length) {
    const first = input.schedules.filter((s) => s.action_id === action.id).map((s) => s.effective_from).sort()[0] ?? null;
    return [{ effective_on: first ?? asOf, source: 'current', reason: 'No plan history recorded yet: the plan as it is now', exercises: action.workout_plan }];
  }
  return dedup;
}

// ---------- The snapshot ----------

export interface SnapshotOptions {
  asOf: string;
  /** How far back to look, in months (1–24). Default 6. */
  months?: number;
  /** Weeks of full set-by-set detail; older weeks are summarised per exercise. Default 8. */
  detailWeeks?: number;
}

export function buildSnapshot(input: HistoryInput, opts: SnapshotOptions): Snapshot {
  const asOf = opts.asOf;
  const months = Math.min(24, Math.max(1, Math.round(opts.months ?? 6)));
  const from = addMonths(asOf, -months);
  const detailFrom = mondayOf(addDays(asOf, -7 * ((opts.detailWeeks ?? 8) - 1)));
  const actionById = new Map(input.actions.map((a) => [a.id, a]));

  // ----- Program -----
  const workoutActions = input.actions.filter((a) => isWorkoutAction(a) && !a.archived_at && scheduleOn(input.schedules, a.id, asOf));
  const workouts = workoutActions
    .map((a) => {
      const versions = versionsOf(input, a, asOf);
      const current = versions.at(-1)?.exercises ?? a.workout_plan ?? [];
      const schedule = scheduleOn(input.schedules, a.id, asOf);
      return {
        action_id: a.id,
        title: a.title,
        days: schedule?.rule === 'days' ? [...schedule.days].sort((x, y) => x - y) : [],
        planned_minutes: a.planned_minutes,
        estimated_minutes: estimateMinutes(current),
        details: (a.details ?? '').trim(),
        exercises: current,
        current_since: versions.at(-1)?.effective_on ?? null,
        versions,
      };
    })
    .sort((x, y) => (x.days[0] ?? 9) - (y.days[0] ?? 9) || x.title.localeCompare(y.title));
  const perWeek = workoutActions.reduce((n, a) => {
    const s = scheduleOn(input.schedules, a.id, asOf);
    return n + (s ? (s.rule === 'days' ? new Set(s.days).size : s.per_week ?? 0) : 0);
  }, 0);
  let lastShape: string | null = null;
  let lastTargets: string | null = null;
  for (const w of workouts) {
    for (let i = 1; i < w.versions.length; i++) {
      const prev = w.versions[i - 1]!;
      const v = w.versions[i]!;
      if (shape(prev.exercises) !== shape(v.exercises) && (!lastShape || v.effective_on > lastShape)) lastShape = v.effective_on;
      if (targets(prev.exercises) !== targets(v.exercises) && (!lastTargets || v.effective_on > lastTargets)) lastTargets = v.effective_on;
    }
  }
  // With no shape change on record, the program began when the oldest current workout began.
  const programStart = lastShape ?? workouts.map((w) => w.versions[0]?.effective_on).filter((d): d is string => !!d).sort()[0] ?? null;

  // ----- Sessions -----
  const workoutSessions = input.sessions.filter(
    (s) => s.date && s.date >= from && s.date <= asOf && s.status !== 'moved' && (isWorkoutAction(actionById.get(s.action_id ?? '')) || input.sets.some((x) => x.session_id === s.id)),
  );
  const setsBySession = new Map<string, WHSet[]>();
  for (const x of input.sets) {
    const list = setsBySession.get(x.session_id) ?? [];
    list.push(x);
    setsBySession.set(x.session_id, list);
  }
  const statusOf = (s: WHSession) => (s.status === 'planned' ? (s.date! < asOf ? 'missed' : 'planned') : s.status);
  const allSessions: SnapshotSession[] = workoutSessions
    .map((s) => ({
      date: s.date!,
      week_start: mondayOf(s.date!),
      action_id: s.action_id,
      workout: s.title,
      status: statusOf(s),
      minutes: s.actual_minutes,
      note: (s.note ?? '').trim(),
      sets: (setsBySession.get(s.id) ?? [])
        .slice()
        .sort((x, y) => x.exercise.localeCompare(y.exercise) || x.set_no - y.set_no)
        .map((x) => ({ exercise: x.exercise, set_no: x.set_no, weight: x.weight == null ? null : Number(x.weight), reps: x.reps, done: x.done, rir: x.rir ?? null, pain: !!x.pain })),
    }))
    .sort((x, y) => (x.date === y.date ? x.workout.localeCompare(y.workout) : x.date < y.date ? -1 : 1));
  const sessions = allSessions.filter((s) => s.date >= detailFrom);

  // ----- Weekly history per exercise (every week in range; the recent ones repeat the detail in summary) -----
  const weekly = new Map<string, ExerciseWeek & { rirs: number[]; name: string }>();
  for (const s of allSessions) {
    for (const x of s.sets) {
      if (!x.done) continue;
      const k = `${s.week_start}|${key(x.exercise)}`;
      let w = weekly.get(k);
      if (!w) {
        w = { week_start: s.week_start, exercise: x.exercise, name: x.exercise, sets_done: 0, best_weight: null, best_reps: null, e1rm: null, volume: 0, avg_rir: null, pain: false, rirs: [] };
        weekly.set(k, w);
      }
      w.sets_done += 1;
      w.volume += (x.weight ?? 0) * (x.reps ?? 0);
      const est = e1rm(x.weight, x.reps);
      if (est != null && (w.e1rm == null || est > w.e1rm)) w.e1rm = est;
      if (x.weight != null && (w.best_weight == null || x.weight > w.best_weight || (x.weight === w.best_weight && (x.reps ?? 0) > (w.best_reps ?? 0)))) {
        w.best_weight = x.weight;
        w.best_reps = x.reps;
      } else if (w.best_weight == null && x.weight == null && (x.reps ?? 0) > (w.best_reps ?? 0)) {
        w.best_reps = x.reps;
      }
      if (x.rir != null) w.rirs.push(x.rir);
      if (x.pain) w.pain = true;
    }
  }
  const history: ExerciseWeek[] = [...weekly.values()]
    .map(({ rirs, name: _n, ...w }) => ({ ...w, volume: round(w.volume, 0), avg_rir: rirs.length ? round(rirs.reduce((a, b) => a + b, 0) / rirs.length, 1) : null }))
    .sort((x, y) => (x.week_start === y.week_start ? x.exercise.localeCompare(y.exercise) : x.week_start < y.week_start ? -1 : 1));

  // ----- Metrics per exercise -----
  const plannedByName = new Map<string, { ex: WHExercise; workout: string }[]>();
  for (const w of workouts) for (const ex of w.exercises) plannedByName.set(key(ex.name), [...(plannedByName.get(key(ex.name)) ?? []), { ex, workout: w.title }]);
  const names = new Map<string, string>();
  for (const w of workouts) for (const ex of w.exercises) names.set(key(ex.name), ex.name);
  for (const s of allSessions) for (const x of s.sets) if (!names.has(key(x.exercise))) names.set(key(x.exercise), x.exercise);
  const step = input.profile.units === 'kg' ? 2.5 : 5;
  const exercises: ExerciseMetrics[] = [...names.entries()]
    .map(([k, name]) => {
      const planned = plannedByName.get(k)?.[0]?.ex ?? null;
      const mine = allSessions.filter((s) => s.sets.some((x) => key(x.exercise) === k && x.done));
      const best = (lo: string, hi: string) => {
        let top: number | null = null;
        for (const s of mine) {
          if (s.date < lo || s.date > hi) continue;
          for (const x of s.sets) {
            if (key(x.exercise) !== k || !x.done) continue;
            const est = e1rm(x.weight, x.reps);
            if (est != null && (top == null || est > top)) top = est;
          }
        }
        return top;
      };
      const now = best(addDays(asOf, -13), asOf);
      const before = best(addDays(asOf, -34), addDays(asOf, -21));
      // Weeks since the estimated max last went up: walk the weekly bests.
      const weeks = history.filter((w) => key(w.exercise) === k && w.e1rm != null);
      let weeksSinceGain: number | null = null;
      if (weeks.length >= 2) {
        let peak = -Infinity;
        let peakWeek = weeks[0]!.week_start;
        for (const w of weeks) {
          if (w.e1rm! > peak + 0.01) {
            peak = w.e1rm!;
            peakWeek = w.week_start;
          }
        }
        weeksSinceGain = Math.floor(daysBetween(peakWeek, mondayOf(asOf)) / 7);
      }
      // Sessions in a row at the top of the range on every planned set, at one weight.
      let streak = 0;
      if (planned) {
        for (const s of [...mine].reverse()) {
          const done = s.sets.filter((x) => key(x.exercise) === k && x.done);
          const weightsUsed = new Set(done.map((x) => x.weight));
          if (done.length >= planned.sets && weightsUsed.size === 1 && done.every((x) => (x.reps ?? 0) >= planned.reps_max)) streak += 1;
          else break;
        }
      }
      const recentRir = mine
        .filter((s) => s.date >= addDays(asOf, -13))
        .flatMap((s) => s.sets.filter((x) => key(x.exercise) === k && x.done && x.rir != null).map((x) => x.rir!));
      const pain = mine.filter((s) => s.date >= addDays(asOf, -27) && s.sets.some((x) => key(x.exercise) === k && x.pain)).length;
      const lastSession = mine.at(-1);
      const lastWeights = lastSession?.sets.filter((x) => key(x.exercise) === k && x.done && x.weight != null).map((x) => x.weight!) ?? [];
      const lastWeight = lastWeights.length ? Math.max(...lastWeights) : planned?.weight ?? null;
      const exposures = mine.length;
      return {
        exercise: name,
        workouts: (plannedByName.get(k) ?? []).map((p) => p.workout),
        planned: planned ? { sets: planned.sets, reps_min: planned.reps_min, reps_max: planned.reps_max, weight: planned.weight } : null,
        sessions: exposures,
        first_seen: mine[0]?.date ?? null,
        last_seen: lastSession?.date ?? null,
        last_weight: lastWeight,
        e1rm_now: now,
        e1rm_3w_ago: before,
        e1rm_trend_pct: now != null && before != null && before > 0 ? round(((now - before) / before) * 100, 1) : null,
        weeks_since_gain: weeksSinceGain,
        stalled: weeksSinceGain != null && weeksSinceGain >= 3 && exposures >= 3,
        top_of_range_streak: streak,
        avg_rir_2w: recentRir.length ? round(recentRir.reduce((a, b) => a + b, 0) / recentRir.length, 1) : null,
        pain_flags_4w: pain,
        next_step_pct: lastWeight && lastWeight > 0 ? round(step / lastWeight, 3) : null,
      };
    })
    .sort((x, y) => (y.planned ? 1 : 0) - (x.planned ? 1 : 0) || x.exercise.localeCompare(y.exercise));

  // ----- Attendance -----
  const counted = (s: SnapshotSession) => s.action_id && s.status !== 'planned';
  const windowStats = (days: number) => {
    const lo = addDays(asOf, -(days - 1));
    // Today's workout counts once it's logged; an open one today isn't a miss yet.
    const list = allSessions.filter((s) => s.date >= lo && counted(s));
    const done = list.filter((s) => DONE.has(s.status)).length;
    return { planned: list.length, done, rate: list.length ? round(done / list.length, 2) : null };
  };
  const w4 = windowStats(28);
  const w8 = windowStats(56);
  const recentDone = allSessions.filter((s) => s.date >= addDays(asOf, -27) && DONE.has(s.status));
  const plannedSets = recentDone.reduce((n, s) => n + s.sets.length, 0);
  const doneSets = recentDone.reduce((n, s) => n + s.sets.filter((x) => x.done).length, 0);
  const minutes = recentDone.map((s) => s.minutes).filter((m): m is number => m != null && m > 0);
  const weeklySets = new Map<string, number>();
  for (const s of allSessions) weeklySets.set(s.week_start, (weeklySets.get(s.week_start) ?? 0) + s.sets.filter((x) => x.done).length);

  // ----- Comments -----
  const comments: Snapshot['comments'] = [];
  for (const w of workouts) {
    if (w.details) comments.push({ date: w.current_since, source: 'details', workout: w.title, exercise: null, text: w.details });
    for (const ex of w.exercises) if (ex.note?.trim()) comments.push({ date: w.current_since, source: 'plan_note', workout: w.title, exercise: ex.name, text: ex.note.trim() });
  }
  for (const s of allSessions) if (s.note) comments.push({ date: s.date, source: 'session_note', workout: s.workout, exercise: null, text: s.note });

  // ----- Body weight -----
  let bodyweight: Snapshot['bodyweight'] = { shared: false };
  if (input.profile.coach_share_bodyweight !== false) {
    const type =
      input.measurementTypes.find((t) => !t.archived_at && /^(body\s*)?weight$/i.test(t.name.trim())) ??
      input.measurementTypes.find((t) => !t.archived_at && /weight/i.test(t.name) && /^(lb|lbs|kg)$/i.test(t.unit.trim()));
    if (type) {
      const readings = input.measurements.filter((m) => m.type_id === type.id && m.measured_on >= from && m.measured_on <= asOf).sort((x, y) => (x.measured_on < y.measured_on ? -1 : 1));
      const byWeek = new Map<string, number[]>();
      for (const r of readings) byWeek.set(mondayOf(r.measured_on), [...(byWeek.get(mondayOf(r.measured_on)) ?? []), Number(r.value)]);
      const weekly = [...byWeek.entries()].map(([week_start, v]) => ({ week_start, avg: round(v.reduce((a, b) => a + b, 0) / v.length, 1) }));
      // Trend: least-squares slope over the last 4 weeks of readings, per week.
      const recent = readings.filter((r) => r.measured_on >= addDays(asOf, -27));
      let trend: number | null = null;
      if (recent.length >= 3) {
        const xs = recent.map((r) => daysBetween(recent[0]!.measured_on, r.measured_on));
        const ys = recent.map((r) => Number(r.value));
        const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
        const my = ys.reduce((a, b) => a + b, 0) / ys.length;
        const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        if (den > 0) trend = round((xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / den) * 7, 2);
      }
      const last = readings.at(-1);
      bodyweight = { shared: true, unit: type.unit, latest: last ? { date: last.measured_on, value: Number(last.value) } : null, weekly, trend_per_week: trend };
    }
  }

  // ----- Coach decisions and what became of them -----
  const pastReports = input.reports.filter((r) => r.as_of <= asOf).sort((x, y) => (x.as_of < y.as_of ? -1 : 1));
  const decisions: Snapshot['decisions'] = pastReports.slice(-12).map((r) => {
    const d = (r.decision ?? {}) as Partial<Decision>;
    const changes = Array.isArray(d.changes) ? (d.changes as DecisionChange[]) : [];
    return {
      id: r.id,
      as_of: r.as_of,
      recommendation: d.recommendation ?? r.recommendation ?? 'hold',
      change_level: Number(d.change_level ?? r.change_level ?? 0),
      summary: d.summary ?? '',
      changes,
      user_status: r.user_status ?? null,
      inferred_status: inferStatus(changes, r.as_of, asOf, workouts),
      user_note: r.user_note ?? '',
    };
  });

  // ----- Since the last report -----
  const lastReport = pastReports.at(-1) ?? null;
  const since_last = lastReport
    ? {
        last_report_as_of: lastReport.as_of,
        sessions: allSessions.filter((s) => s.date > lastReport.as_of && s.status !== 'planned').map((s) => `${s.date} ${s.workout} (${s.status})`),
        sets: allSessions.filter((s) => s.date > lastReport.as_of).reduce((n, s) => n + s.sets.filter((x) => x.done).length, 0),
        plan_changes: workouts.flatMap((w) => w.versions.filter((v) => v.effective_on > lastReport.as_of).map((v) => `${v.effective_on} ${w.title}`)),
        comments: comments.filter((c) => c.date && c.date > lastReport.as_of).length,
      }
    : null;

  const body: Omit<Snapshot, 'meta'> = {
    program: {
      workouts,
      workouts_per_week: perWeek,
      last_structural_change_on: lastShape,
      program_age_weeks: programStart ? Math.floor(daysBetween(programStart, asOf) / 7) : null,
      last_target_change_on: lastTargets,
    },
    sessions,
    history,
    metrics: {
      exercises,
      attendance_4w: w4.rate,
      attendance_8w: w8.rate,
      workouts_done_4w: w4.done,
      workouts_planned_4w: w4.planned,
      set_completion_4w: plannedSets ? round(doneSets / plannedSets, 2) : null,
      avg_session_minutes_4w: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
      weekly_sets: [...weeklySets.entries()].sort().map(([week_start, sets]) => ({ week_start, sets })),
    },
    comments,
    bodyweight,
    decisions,
    since_last,
  };
  return {
    meta: {
      schema_version: SCHEMA_VERSION,
      as_of: asOf,
      months,
      from,
      units: input.profile.units,
      timezone: input.profile.timezone,
      fingerprint: fingerprint(JSON.stringify(body)),
    },
    ...body,
  };
}

/**
 * Did a coach report's changes make it into the plan? Compares each change's target fields with the
 * plan in force now. A week's grace before "not applied".
 */
function inferStatus(changes: DecisionChange[], reportAsOf: string, asOf: string, workouts: Snapshot['program']['workouts']): Snapshot['decisions'][number]['inferred_status'] {
  const real = changes.filter((c) => c.to && Object.keys(c.to).length > 0);
  if (real.length === 0) return 'nothing_to_apply';
  const plans = workouts.map((w) => ({ title: key(w.title), id: w.action_id, exercises: w.exercises }));
  let hits = 0;
  for (const c of real) {
    const target = plans.find((p) => (c.action_id && p.id === c.action_id) || p.title === key(c.workout));
    const pool = target ? target.exercises : plans.flatMap((p) => p.exercises);
    const wantName = key(String(c.to!.name ?? c.exercise));
    const ex = pool.find((e) => key(e.name) === wantName);
    if (c.type === 'remove') {
      if (!pool.some((e) => key(e.name) === key(c.exercise))) hits += 1;
      continue;
    }
    if (!ex) continue;
    const fields = (['sets', 'reps_min', 'reps_max', 'weight'] as const).filter((f) => c.to![f] !== undefined);
    if (fields.every((f) => ex[f] === c.to![f])) hits += 1;
  }
  if (hits === real.length) return 'applied';
  if (hits > 0) return 'partly';
  return daysBetween(reportAsOf, asOf) >= 7 ? 'not_applied' : 'pending';
}

// ---------- The report you read ----------

const num = (n: number | null | undefined, digits = 1) => (n == null ? '–' : Number.isInteger(round(n, digits)) ? String(round(n, digits)) : round(n, digits).toFixed(digits));
const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100)}%`);
const signed = (n: number | null | undefined, unit = '') => (n == null ? '–' : `${n > 0 ? '+' : ''}${num(n)}${unit}`);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const weightText = (w: number | null, units: string, note?: string) => (w == null ? (note && note.trim() ? note.trim() : 'bodyweight') : `${num(w)} ${units}`);
const repsText = (e: { reps_min: number; reps_max: number; per_side?: boolean }) => `${e.reps_min === e.reps_max ? e.reps_min : `${e.reps_min}–${e.reps_max}`}${e.per_side ? '/side' : ''}`;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function setsLine(sets: SnapshotSet[]): string {
  const done = sets.filter((x) => x.done);
  if (!done.length) return 'not done';
  const weights = new Set(done.map((x) => x.weight));
  const reps = done.map((x) => `${x.reps ?? '?'}${x.rir != null ? ` @${x.rir}` : ''}`);
  const base = weights.size === 1 ? `${done[0]!.weight == null ? 'BW' : num(done[0]!.weight)} × ${reps.join(', ')}` : done.map((x, i) => `${x.weight == null ? 'BW' : num(x.weight)}×${reps[i]}`).join(', ');
  const skipped = sets.length - done.length;
  return `${base}${skipped ? ` (${skipped} not done)` : ''}${sets.some((x) => x.pain) ? ' · ⚠ pain' : ''}`;
}

function statusWord(m: ExerciseMetrics): string {
  if (m.pain_flags_4w > 0) return `⚠ pain (${m.pain_flags_4w}× in 4 wks)`;
  if (m.sessions < 3) return 'new · too early to tell';
  if (m.top_of_range_streak >= 2) return 'ready to move up';
  if (m.stalled) return `stalled ${m.weeks_since_gain} wks`;
  if ((m.e1rm_trend_pct ?? 0) > 0) return 'progressing';
  return 'holding';
}

/** The snapshot as a report a person reads (Markdown). */
export function renderReport(s: Snapshot): string {
  const u = s.meta.units;
  const out: string[] = [];
  out.push(`# Workout history`);
  out.push(`As of **${dayName(s.meta.as_of)} ${shortDate(s.meta.as_of)}, ${s.meta.as_of.slice(0, 4)}** · the last ${s.meta.months} months (from ${shortDate(s.meta.from)}) · ${u}`);
  out.push('');

  // At a glance
  const m = s.metrics;
  out.push('## At a glance');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Workouts, last 4 weeks | ${m.workouts_done_4w} of ${m.workouts_planned_4w} (${pct(m.attendance_4w)}) |`);
  out.push(`| Workouts, last 8 weeks | ${pct(m.attendance_8w)} |`);
  out.push(`| Sets completed, last 4 weeks | ${pct(m.set_completion_4w)} |`);
  out.push(`| Average workout | ${m.avg_session_minutes_4w == null ? '–' : `${m.avg_session_minutes_4w} min`} |`);
  out.push(`| Program | ${s.program.workouts.length} workouts, ${s.program.workouts_per_week} a week · ${s.program.program_age_weeks == null ? 'age unknown' : `${s.program.program_age_weeks} weeks old`} |`);
  out.push(`| Last change to the program | ${s.program.last_structural_change_on ? shortDate(s.program.last_structural_change_on) : 'none on record'} (exercises) · ${s.program.last_target_change_on ? shortDate(s.program.last_target_change_on) : 'none on record'} (weights, sets or reps) |`);
  if (s.bodyweight.shared) {
    const b = s.bodyweight;
    out.push(`| Body weight | ${b.latest ? `${num(b.latest.value)} ${b.unit} on ${shortDate(b.latest.date)}` : 'no readings'} · ${b.trend_per_week == null ? 'trend –' : `${signed(b.trend_per_week)} ${b.unit}/week over 4 weeks`} |`);
  }
  out.push('');

  if (s.since_last) {
    out.push(`## New since the last coach report (${shortDate(s.since_last.last_report_as_of!)})`);
    if (!s.since_last.sessions.length && !s.since_last.plan_changes.length && !s.since_last.comments) out.push('Nothing new.');
    else {
      if (s.since_last.sessions.length) out.push(`- ${s.since_last.sessions.length} workout${s.since_last.sessions.length === 1 ? '' : 's'} logged, ${s.since_last.sets} sets: ${s.since_last.sessions.map((x) => { const [d, ...rest] = x.split(' '); return `${shortDate(d!)} ${rest.join(' ')}`; }).join('; ')}`);
      if (s.since_last.plan_changes.length) out.push(`- Plan changes: ${s.since_last.plan_changes.map((x) => { const [d, ...rest] = x.split(' '); return `${shortDate(d!)} ${rest.join(' ')}`; }).join('; ')}`);
      if (s.since_last.comments) out.push(`- ${s.since_last.comments} new note${s.since_last.comments === 1 ? '' : 's'}`);
    }
    out.push('');
  }

  // The program now
  out.push('## The program now');
  for (const w of s.program.workouts) {
    const days = w.days.length ? w.days.map((d) => DAY_NAMES[d - 1]).join(', ') : 'any day';
    out.push(`### ${w.title} · ${days} · planned ${w.planned_minutes} min, estimated ${w.estimated_minutes} min`);
    out.push(`Current version since ${w.current_since ? shortDate(w.current_since) : '–'}.`);
    out.push('');
    out.push('| Exercise | Sets × reps | Weight | Rest | Note |');
    out.push('|---|---|---|---|---|');
    for (const e of w.exercises) out.push(`| ${cell(e.name)} | ${e.sets} × ${repsText(e)} | ${cell(weightText(e.weight, u, e.weight_note))} | ${cell(e.rest ?? '')} | ${cell(e.note ?? '')} |`);
    out.push('');
  }

  // Exercise by exercise
  out.push('## Exercise by exercise');
  out.push(`Estimated max is the Epley estimate from weight × reps; "@2" means 2 reps left in the tank.`);
  out.push('');
  out.push('| Exercise | Last weight | Est. max now | 3 wks ago | Change | Wks since gain | Top of range | Effort (2 wks) | Next step | Status |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const e of m.exercises) {
    out.push(
      `| ${cell(e.exercise)} | ${e.last_weight == null ? 'BW' : num(e.last_weight)} | ${num(e.e1rm_now)} | ${num(e.e1rm_3w_ago)} | ${e.e1rm_trend_pct == null ? '–' : signed(e.e1rm_trend_pct, '%')} | ${e.weeks_since_gain ?? '–'} | ${e.top_of_range_streak ? `${e.top_of_range_streak} in a row` : '–'} | ${e.avg_rir_2w == null ? '–' : `@${num(e.avg_rir_2w)}`} | ${e.next_step_pct == null ? '–' : `+${Math.round(e.next_step_pct * 100)}%`} | ${statusWord(e)} |`,
    );
  }
  out.push('');

  // Recent workouts
  out.push(`## Workouts, set by set (since ${s.sessions[0] ? shortDate(s.sessions[0].week_start) : '–'})`);
  if (!s.sessions.length) out.push('No workouts in this stretch.');
  let week = '';
  for (const sess of [...s.sessions].reverse()) {
    if (sess.week_start !== week) {
      week = sess.week_start;
      out.push('');
      out.push(`**Week of ${shortDate(week)}**`);
      out.push('');
    }
    out.push(`- **${dayName(sess.date)} ${shortDate(sess.date)} · ${sess.workout}** · ${sess.status}${sess.minutes ? ` · ${sess.minutes} min` : ''}`);
    const byEx = new Map<string, SnapshotSet[]>();
    for (const x of sess.sets) byEx.set(x.exercise, [...(byEx.get(x.exercise) ?? []), x]);
    for (const [ex, sets] of byEx) out.push(`  - ${ex}: ${setsLine(sets)}`);
    if (sess.note) out.push(`  - Note: “${sess.note}”`);
  }
  out.push('');

  // Earlier weeks
  const older = s.history.filter((h) => !s.sessions.length || h.week_start < s.sessions[0]!.week_start);
  if (older.length) {
    out.push('## Earlier weeks (best set each week)');
    const byEx = new Map<string, ExerciseWeek[]>();
    for (const h of older) byEx.set(h.exercise, [...(byEx.get(h.exercise) ?? []), h]);
    for (const [ex, weeks] of byEx) out.push(`- **${ex}**: ${weeks.map((w) => `${shortDate(w.week_start)} ${w.best_weight == null ? 'BW' : num(w.best_weight)}×${w.best_reps ?? '?'}${w.pain ? ' ⚠' : ''}`).join(' · ')}`);
    out.push('');
  }

  // Plan history
  const changes = s.program.workouts.flatMap((w) => w.versions.map((v, i) => ({ w, v, prev: w.versions[i - 1] ?? null }))).filter((x) => x.prev);
  out.push('## Plan changes');
  if (!changes.length) out.push('None on record in this stretch.');
  for (const { w, v, prev } of changes.sort((a, b) => (a.v.effective_on < b.v.effective_on ? 1 : -1))) {
    out.push(`- ${shortDate(v.effective_on)} · ${w.title}: ${describePlanChange(prev!.exercises, v.exercises, u)}${v.reason ? ` (${v.reason})` : ''}`);
  }
  out.push('');

  // Notes
  if (s.comments.length) {
    out.push('## Your notes');
    for (const c of s.comments) {
      const where = c.source === 'session_note' ? 'after the workout' : c.source === 'plan_note' ? `plan note on ${c.exercise}` : 'warm-up and notes';
      out.push(`- ${c.date ? shortDate(c.date) : ''} · ${c.workout} · ${where}: “${c.text.replace(/\s+/g, ' ').slice(0, 400)}”`);
    }
    out.push('');
  }

  // Coach decisions
  out.push('## Coach decisions so far');
  if (!s.decisions.length) out.push('None yet.');
  for (const d of [...s.decisions].reverse()) {
    const status = d.user_status ? `you marked it ${d.user_status}` : `looks ${d.inferred_status.replace(/_/g, ' ')}`;
    out.push(`- ${shortDate(d.as_of)} · ${d.recommendation === 'change' ? `change (level ${d.change_level})` : d.recommendation} · ${d.summary || '–'} · ${status}${d.user_note ? ` · “${d.user_note}”` : ''}`);
  }
  out.push('');
  out.push(`<sub>Snapshot ${s.meta.fingerprint} · schema ${s.meta.schema_version}</sub>`);
  return out.join('\n');
}

/** "Lat Pulldown 100 → 105 lb; Face Pull added; Crunch removed" */
export function describePlanChange(before: WHExercise[], after: WHExercise[], units: string): string {
  const parts: string[] = [];
  const old = new Map(before.map((e) => [key(e.name), e]));
  const now = new Map(after.map((e) => [key(e.name), e]));
  for (const [k, e] of now) {
    const p = old.get(k);
    if (!p) {
      parts.push(`${e.name} added`);
      continue;
    }
    const bits: string[] = [];
    if (p.weight !== e.weight) bits.push(`${p.weight ?? 'BW'} → ${e.weight ?? 'BW'} ${units}`);
    if (p.sets !== e.sets) bits.push(`${p.sets} → ${e.sets} sets`);
    if (p.reps_min !== e.reps_min || p.reps_max !== e.reps_max) bits.push(`${repsText(p)} → ${repsText(e)} reps`);
    if (bits.length) parts.push(`${e.name} ${bits.join(', ')}`);
  }
  for (const [k, e] of old) if (!now.has(k)) parts.push(`${e.name} removed`);
  return parts.join('; ') || 'notes or order changed';
}
