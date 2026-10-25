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
  /** plan: from the plan; last: what you used last time; up: you hit the top of the range on every set. */
  why: 'plan' | 'last' | 'up';
}

/**
 * The weight to start with: the plan's on the first time, then last time's weight, plus `step`
 * once every planned set reached the top of the rep range (double progression).
 */
export function suggestWeight(ex: PlannedExercise, last: DoneSet[] | null, step = 5): WeightSuggestion {
  const used = (last ?? []).filter((s) => s.done && s.weight != null);
  if (!used.length) return { weight: ex.weight, why: 'plan' };
  const top = Math.max(...used.map((s) => s.weight!));
  const atTop = used.filter((s) => s.weight === top);
  if (atTop.length >= ex.sets && atTop.every((s) => (s.reps ?? 0) >= ex.reps_max)) return { weight: top + step, why: 'up' };
  return { weight: top, why: 'last' };
}
