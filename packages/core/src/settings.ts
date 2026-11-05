/**
 * Settings that shape training: your limits, your gym, weight steps, your training week, and how
 * you log. Stored on your profile; the app uses them for weight suggestions and the workout log,
 * and the workout coach reads them as rules it can't break.
 */

export type EquipmentKind = 'dumbbell' | 'machine' | 'cable' | 'bodyweight';

export interface TrainingLimit {
  id: string;
  name: string;
  summary: string;
  /** Movement families left out (squat, lunge…), as the coach names them. */
  banned_patterns: string[];
  /** Exercises that bothered it before. */
  banned_exercises: string[];
  /** Rep caps it puts on exercises: { match: 'lateral raise', max: 12 } (match is a pattern on the name). */
  rep_caps?: { match: string; max: number }[];
  /** Ask for this limit's pain, 0–10, when you finish a workout. */
  pain_check?: boolean;
  /** The pain rule, shown with the check: "Up to 3/10 that's gone by morning is OK." */
  pain_rule?: string;
}

export interface TrainingRules {
  limits: TrainingLimit[];
  /** Equipment ids you have (see EQUIPMENT). */
  equipment: string[];
  one_cable_at_a_time: boolean;
  weights_only: boolean;
  /** Smallest jump per kind of equipment, in your units. */
  steps: { dumbbell: number; machine: number; cable: number };
  /** A jump bigger than this share of the current weight is never suggested (0.10 = 10%). */
  max_jump_pct: number;
  /** Smallest isolation step: 2.5 lb dumbbells if your gym has them, the smallest cable plate. 0 = none. */
  iso_steps: { dumbbell: number; cable: number };
  /** How much less assist per step on assisted pull-ups and dips. */
  assist_step: number;
  /** The program's first day: deload weeks count from here (the 8th week, or sooner when lifts stall). */
  program_start: string;
  /** Training days, 1 = Monday … 7 = Sunday. */
  days: number[];
  session_minutes: { min: number; max: number };
  exercises_per_workout: number;
}

export type EffortMode = 'each' | 'finish' | 'off';

export interface WorkoutPrefs {
  /** each: ask under each exercise · finish: only remind at the end · off: don't ask. */
  effort: EffortMode;
  /** Ask for a 1–10 for the whole workout when finishing. */
  workout_rating: boolean;
  /** Vibrate when rest ends. */
  rest_vibrate: boolean;
}

export interface BodyPrefs {
  /** Weekday for tape measurements, 1 = Monday … 7 = Sunday. */
  measure_day: number;
  /** A monthly photo reminder (front, side, back). */
  photo_reminder: boolean;
}

export const EQUIPMENT: { id: string; name: string }[] = [
  { id: 'dumbbells', name: 'Dumbbells' },
  { id: 'adjustable_bench', name: 'Adjustable bench' },
  { id: 'incline_bench', name: 'Incline bench' },
  { id: 'sit_up_bench', name: 'Sit-up bench' },
  { id: 'single_cable', name: 'Cable' },
  { id: 'lat_pulldown', name: 'Lat pulldown' },
  { id: 'seated_cable_row', name: 'Seated row' },
  { id: 'chest_press_machine', name: 'Chest press' },
  { id: 'hammer_strength_back_extension', name: 'Back extension' },
  { id: 'hammer_strength_glute_ham', name: 'Glute-ham' },
  { id: 'rear_delt_machine', name: 'Rear-delt machine' },
  { id: 'assist_machine', name: 'Assisted pull-up/dip' },
  { id: 'barbell', name: 'Barbell' },
  { id: 'pull_up_bar', name: 'Pull-up bar' },
  { id: 'kettlebells', name: 'Kettlebells' },
  { id: 'resistance_bands', name: 'Bands' },
];

/** Movement families a limit can leave out, in plain words, keyed as the coach names them. */
export const PATTERNS: { id: string; name: string }[] = [
  { id: 'squat', name: 'Squat' },
  { id: 'lunge', name: 'Lunge' },
  { id: 'leg_press', name: 'Leg press' },
  { id: 'leg_extension', name: 'Leg extension' },
  { id: 'leg_curl', name: 'Leg curl' },
  { id: 'step_up', name: 'Step-up' },
  { id: 'jump', name: 'Jump' },
  { id: 'deadlift', name: 'Deadlift' },
  { id: 'kettlebell_swing', name: 'Kettlebell swing' },
  { id: 'overhead_press', name: 'Overhead press' },
  { id: 'dip', name: 'Dip' },
  { id: 'pull_up', name: 'Pull-up' },
  { id: 'incline_press', name: 'Incline press' },
];

/** The left rotator cuff (Nov 2026): no overhead or incline pressing, lateral raises capped at 12, a pain check. */
export const LEFT_SHOULDER: TrainingLimit = {
  id: 'left_shoulder',
  name: 'Left shoulder',
  summary: 'Left rotator cuff: no overhead pressing, Arnold press or incline DB press until cleared. Lateral raises stop at 12 reps (more causes soreness). Flat DB press and dips are pain-free. After 2–3 pain-free weeks, a low incline (20° or less, neutral grip, 10 reps or fewer) first, overhead pressing last.',
  banned_patterns: ['overhead_press', 'incline_press'],
  banned_exercises: ['Arnold press', 'Seated DB Arnold Press', 'Seated DB Shoulder Press', 'Incline DB Press'],
  rep_caps: [{ match: 'lateral raise', max: 12 }],
  pain_check: true,
  pain_rule: "Up to about 3/10 during a lift that's gone by the next morning is OK. Sharper pain, or worse the next day: stop or swap the exercise.",
};

/** Your rules as they stood in the coach's profile when they moved into the app. */
export const DEFAULT_TRAINING_RULES: TrainingRules = {
  limits: [
    {
      id: 'knee',
      name: 'Knee',
      summary: 'No lower-body training. Anything that loads the knee is out.',
      banned_patterns: ['squat', 'lunge', 'leg_press', 'leg_extension', 'leg_curl', 'step_up', 'jump', 'deadlift', 'kettlebell_swing'],
      banned_exercises: ['Weighted crunch', 'Seated kettlebell twist', 'Hollow-body hold', 'Dead bug'],
    },
    LEFT_SHOULDER,
  ],
  equipment: ['dumbbells', 'adjustable_bench', 'incline_bench', 'sit_up_bench', 'single_cable', 'lat_pulldown', 'seated_cable_row', 'chest_press_machine', 'hammer_strength_back_extension', 'hammer_strength_glute_ham', 'rear_delt_machine', 'assist_machine'],
  one_cable_at_a_time: true,
  weights_only: true,
  steps: { dumbbell: 5, machine: 5, cable: 5 },
  max_jump_pct: 0.1,
  iso_steps: { dumbbell: 2.5, cable: 2.5 },
  assist_step: 5,
  program_start: '2026-10-26',
  days: [1, 2, 3, 4, 5],
  session_minutes: { min: 35, max: 45 },
  exercises_per_workout: 5,
};

export const DEFAULT_WORKOUT_PREFS: WorkoutPrefs = { effort: 'each', workout_rating: true, rest_vibrate: true };
export const DEFAULT_BODY_PREFS: BodyPrefs = { measure_day: 2, photo_reminder: true };

/** Saved rules over the defaults: a field never saved keeps its default. */
export function trainingRules(saved: Partial<TrainingRules> | null | undefined): TrainingRules {
  const d = DEFAULT_TRAINING_RULES;
  if (!saved) return d;
  return {
    ...d,
    ...saved,
    steps: { ...d.steps, ...(saved.steps ?? {}) },
    iso_steps: { ...d.iso_steps, ...(saved.iso_steps ?? {}) },
    session_minutes: { ...d.session_minutes, ...(saved.session_minutes ?? {}) },
    limits: saved.limits ?? d.limits,
    equipment: saved.equipment ?? d.equipment,
    days: saved.days ?? d.days,
  };
}
export const workoutPrefs = (saved: Partial<WorkoutPrefs> | null | undefined): WorkoutPrefs => ({ ...DEFAULT_WORKOUT_PREFS, ...(saved ?? {}) });
export const bodyPrefs = (saved: Partial<BodyPrefs> | null | undefined): BodyPrefs => ({ ...DEFAULT_BODY_PREFS, ...(saved ?? {}) });

/** What kind of equipment an exercise uses, from its name. */
export function equipmentKind(name: string, weightNote = ''): EquipmentKind {
  const n = `${name} ${weightNote}`.toLowerCase();
  if (/body ?weight|\bbw\b|push-?up|plank|crunch|sit-?up bench/.test(n)) return 'bodyweight';
  // A seated cable row is its own weight stack; any other "cable" move is the single cable.
  if (/seated cable row/.test(n)) return 'machine';
  if (/cable|pushdown|face pull|straight-arm/.test(n)) return 'cable';
  if (/machine|pulldown|seated row|chest press|pec deck|hammer strength|leg press|smith/.test(n)) return 'machine';
  return 'dumbbell';
}

/** The smallest weight step for an exercise, from your settings. */
export function stepFor(name: string, rules: TrainingRules, weightNote = ''): number {
  const k = equipmentKind(name, weightNote);
  return k === 'bodyweight' ? 0 : rules.steps[k];
}

/** Every rule as one line, for the settings home. */
export function rulesSummary(rules: TrainingRules, units: string): string {
  const limit = rules.limits[0] ? `${rules.limits[0].name}: ${rules.limits[0].summary.split('.')[0]!.toLowerCase()}` : 'No limits';
  const dumbbells = rules.equipment.includes('dumbbells') ? 'dumbbells' : null;
  const cables = rules.equipment.includes('single_cable') ? (rules.one_cable_at_a_time ? 'one cable' : 'cables') : null;
  const kit = [dumbbells, cables].filter(Boolean).join(', ') || `${rules.equipment.length} pieces of equipment`;
  return `${limit} · ${kit} · +${rules.steps.dumbbell} ${units} steps`;
}
