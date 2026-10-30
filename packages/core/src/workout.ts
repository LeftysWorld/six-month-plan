/**
 * Workout plans: what a workout task plans for each exercise (sets, a rep range, a target
 * weight, rest), read from plain text, and the weight to suggest next time (double progression).
 */

export interface PlannedExercise {
  name: string;
  sets: number;
  reps_min: number;
  /** Top of the rep range; equal to reps_min for a fixed number. */
  reps_max: number;
  /** Reps are per arm or per side. */
  per_side?: boolean;
  /** Target weight in your units; null for bodyweight or "find the weight". */
  weight: number | null;
  /** The weight as written when it isn't a single number: "bodyweight", "light", "20–25 lb". */
  weight_note: string;
  rest: string;
  note: string;
  /** What it looks like, when you chose one (a library exercise, a video link, your own photo or video). */
  demo?: import('./demo.ts').ExerciseDemo | null;
}

/** One set as logged. */
export interface DoneSet {
  weight: number | null;
  reps: number | null;
  done: boolean;
}

const num = (s: string | undefined) => (s == null ? NaN : Number(s.replace(',', '.')));

function parseWeight(raw: string | undefined): { weight: number | null; weight_note: string } {
  const w = (raw ?? '').trim();
  if (!w) return { weight: null, weight_note: '' };
  const single = /^(\d+(?:[.,]\d+)?)\s*(lb|lbs|kg)?$/i.exec(w);
  if (single) return { weight: num(single[1]), weight_note: '' };
  const range = /^(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)\s*(lb|lbs|kg)?$/i.exec(w);
  if (range) return { weight: num(range[1]), weight_note: w };
  return { weight: null, weight_note: w };
}

const LINE =
  /^(.+?):\s*(\d+)\s*[×x]\s*(\d+)(?:\s*[–-]\s*(\d+))?(\s*per\s+(?:side|arm))?(?:\s*@\s*([^·(]+?))?\s*(?:·\s*rest\s*([^()]+?))?\s*(?:\((.+)\))?\s*$/i;
const SUPERSET = /^(.*?superset[^:,]*?)(?:,\s*(\d+)\s*rounds?)?:\s*(.+?)(?:\s*·\s*rest\s*(.+))?$/i;

/** One exercise line, e.g. "Flat DB Bench Press: 3×8–12 @ 50 lb · rest 2–3 min (note)". */
function parseLine(line: string): PlannedExercise[] {
  const text = line.replace(/^\s*(?:[•*\-–]|\d+[.)])\s*/, '').trim();
  const ss = SUPERSET.exec(text);
  if (ss && /\+/.test(ss[3] ?? '')) {
    const rounds = Number(ss[2] ?? 1) || 1;
    const parts = (ss[3] ?? '').split(/\s*\+\s*/);
    const names = parts.map((p) => p.replace(/\s*\d+(?:\s*[–-]\s*\d+)?\s*$/, '').trim());
    return parts.map((p, i) => {
      const r = /(\d+)(?:\s*[–-]\s*(\d+))?\s*$/.exec(p);
      const lo = r ? Number(r[1]) : 10;
      const hi = r?.[2] ? Number(r[2]) : lo;
      const other = names.filter((_, j) => j !== i).join(' + ');
      return { name: names[i] || p, sets: rounds, reps_min: lo, reps_max: hi, weight: null, weight_note: '', rest: (ss[4] ?? '').trim(), note: `Superset with ${other}` };
    });
  }
  const m = LINE.exec(text);
  if (!m) return [];
  const lo = Number(m[3]);
  return [
    {
      name: m[1]!.trim(),
      sets: Number(m[2]),
      reps_min: lo,
      reps_max: m[4] ? Number(m[4]) : lo,
      ...(m[5] ? { per_side: true } : {}),
      ...parseWeight(m[6]),
      rest: (m[7] ?? '').trim(),
      note: (m[8] ?? '').trim(),
    },
  ];
}

/**
 * Read a plan from text. With a "WORKOUT" heading only the lines under it count (so a warm-up
 * above it isn't taken as exercises); otherwise every line that reads like "Name: 3×8–12 …".
 */
export function parseWorkoutPlan(text: string): PlannedExercise[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*workout\s*:?\s*$/i.test(l));
  let body = lines;
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^\s*[A-Z][A-Z -]{2,}:?\s*$/.test(l));
    body = end >= 0 ? rest.slice(0, end) : rest;
  }
  return body.flatMap(parseLine);
}

/** "8–12" or "10", with "per side" when it applies. */
export function repsText(ex: PlannedExercise): string {
  return `${ex.reps_min === ex.reps_max ? ex.reps_min : `${ex.reps_min}–${ex.reps_max}`}${ex.per_side ? ' per side' : ''}`;
}

/** "3 × 8–12 @ 50 lb", "3 × 12–15 · bodyweight". */
export function targetText(ex: PlannedExercise, unit = 'lb'): string {
  const w = ex.weight_note || (ex.weight != null ? `${ex.weight} ${unit}` : '');
  return `${ex.sets} × ${repsText(ex)}${w ? (ex.weight != null && !ex.weight_note ? ` @ ${w}` : ` · ${w}`) : ''}`;
}

export interface WeightSuggestion {
  weight: number | null;
  /**
   * plan: from the plan; last: what you used last time; up: you hit the top of the range on every
   * set; allout: you hit it, but rated it 10 (nothing left), so the weight stays.
   */
  why: 'plan' | 'last' | 'up' | 'allout';
}

/**
 * The weight to start with: the plan's on the first time, then last time's weight, plus `step`
 * once every planned set reached the top of the rep range (double progression).
 */
export function suggestWeight(ex: PlannedExercise, last: DoneSet[] | null, step = 5, lastEffort: number | null = null): WeightSuggestion {
  const used = (last ?? []).filter((s) => s.done && s.weight != null);
  if (!used.length) return { weight: ex.weight, why: 'plan' };
  const top = Math.max(...used.map((s) => s.weight!));
  const atTop = used.filter((s) => s.weight === top);
  if (atTop.length >= ex.sets && atTop.every((s) => (s.reps ?? 0) >= ex.reps_max)) {
    // Every rep, but nothing left: earn it once more before the weight goes up.
    if (lastEffort != null && lastEffort >= 10) return { weight: top, why: 'allout' };
    return { weight: top + step, why: 'up' };
  }
  return { weight: top, why: 'last' };
}

// ---------- Effort: 1–10 per exercise ----------

/**
 * The effort scale, by reps left on the last set (the lifting version of the 1–10 scale: 10 = no
 * reps left, 9 = one, 8 = two…). Labelled every time so an 8 means the same thing each week.
 */
export const EFFORT_WORDS = ['', 'Very easy', 'Easy', 'Easy', 'Comfortable', 'Moderate', 'Working', 'Hard', 'Hard', 'Very hard', 'Max'] as const;
export const EFFORT_LEFT = ['', '6+ reps left', '6+ reps left', '6+ reps left', '6+ reps left', '5 reps left', '4 reps left', '3 reps left', '2 reps left', '1 rep left', 'No reps left'] as const;
/** Most sets should land here. */
export const EFFORT_TARGET = { min: 7, max: 9 } as const;

export type EffortZone = 'easy' | 'moderate' | 'target' | 'max';
export function effortZone(n: number): EffortZone {
  if (n <= 4) return 'easy';
  if (n <= 6) return 'moderate';
  if (n <= 9) return 'target';
  return 'max';
}

/** A whole number 1–10, or null. */
export function cleanEffort(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  const r = Math.round(v);
  return r >= 1 && r <= 10 ? r : null;
}

/**
 * What the rating means for next time. `allTop`: every set done reached the top of the range.
 * `weight`: the weight used (null for bodyweight).
 */
export function effortHint(effort: number, ctx: { allTop: boolean; weight: number | null; unit: string }): string {
  const w = ctx.weight == null ? 'the same' : `${short(ctx.weight)} ${ctx.unit}`;
  if (effort >= 10) return `All-out. Keep ${w} next time and watch your form on the last reps.`;
  if (effort === 9) return `Right at the edge of your target. Keep ${w} next time.`;
  if (effort >= 7) return ctx.allTop ? 'Top of your range at a hard effort: ready to move up next time.' : 'Right in your target. Same weight next time, chase one more rep.';
  if (effort >= 5) return ctx.allTop ? 'Top of your range with reps to spare: move up next time.' : 'Some left in the tank. Push for one more rep a set next time.';
  return ctx.allTop ? 'Felt easy at the top of your range: move up next time.' : 'Felt easy. Push for more reps next time, then more weight.';
}

const short = (n: number) => String(Math.round(n * 100) / 100);

/** "55 × 12, 12, 11" when every set used one weight; "55×12, 50×10" when it changed; "BW × 15, 14" without weight. */
export function setsText(sets: { weight: number | null; reps: number | null }[]): string {
  if (!sets.length) return '';
  const weights = new Set(sets.map((s) => s.weight));
  const reps = sets.map((s) => (s.reps == null ? '?' : String(s.reps)));
  if (weights.size === 1) {
    const w = sets[0]!.weight;
    return `${w == null ? 'BW' : short(w)} × ${reps.join(', ')}`;
  }
  return sets.map((s) => `${s.weight == null ? 'BW' : short(s.weight)}×${s.reps ?? '?'}`).join(', ');
}

/** A rest like "2–3 min", "90 s" or "60s" in seconds (a range takes its middle); null when there's none. */
export function restSeconds(rest: string): number | null {
  const m = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(min|m\b|minutes?|s\b|sec|seconds?)?/i.exec(rest);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const mins = /^m/i.test(m[3] ?? '') || (!m[3] && hi <= 5);
  return Math.round(((lo + hi) / 2) * (mins ? 60 : 1));
}
