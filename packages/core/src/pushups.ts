/**
 * Road to 100 Push-Ups (the Armstrong program adapted to push-ups), on every lifting day:
 *
 * - Monday · Test + Max Sets: after 1 easy warm-up set of 10, 5 all-out sets with 90 s rest. Set 1
 *   is the weekly test; the total of all 5 is the volume score.
 * - Tuesday · Paused Push-Ups and Friday · Close-Grip Push-Ups (strength, after dips): 3 × 8–12,
 *   stopping 1–2 reps short. All 3 sets at 12 → 3 × 15; all 3 at 15 → add a vest or a plate and drop
 *   back to 8–12.
 * - Thursday · Training Sets: sets of half the Monday test (rounded down), 60 s rest, as many sets
 *   as you can with perfect form, up to 10. All 10 done → 1 more rep per set next week.
 * - Saturday · Density Pyramid: 1 rep, rest 10 s; 2 reps, rest 20 s; … until you can't finish a
 *   step; then rest 2 min and do 1 all-out set. Each step is a set (1, 2, 3 … reps), and the last
 *   set is the final all-out set.
 * - Lighter week: Monday the test set only, Thursday 5 training sets, Tue/Fri 2 sets, no pyramid.
 *
 * Push-ups are bodyweight lifts, so they're outside the rep cap.
 */

export type PushupRole = 'test' | 'strength' | 'training' | 'pyramid';

/**
 * Which part of the program a push-up is: "Push-Up Max Sets" / "… Test" (Monday), "Training Sets"
 * (Thursday), "Density Pyramid" (Saturday), and any other push-up, like "Paused" or "Close-Grip",
 * a strength day. Assisted, pike and handstand push-ups aren't part of it.
 */
export function pushupRole(name: string): PushupRole | null {
  if (!/push[- ]?ups?\b/i.test(name) || /assisted|pike|handstand/i.test(name)) return null;
  if (/max|test/i.test(name)) return 'test';
  if (/pyramid|density/i.test(name)) return 'pyramid';
  if (/training|volume/i.test(name)) return 'training';
  return 'strength';
}

/** One logged push-up workout: the day, which part of the program, and the reps (and any added weight) of each set. */
export interface PushupLog {
  date: string;
  role: PushupRole;
  name: string;
  reps: number[];
  weight: number | null;
}

export interface PushupTarget {
  role: PushupRole;
  /** The latest Monday test (set 1), or the starting estimate. */
  test: number;
  sets: number;
  reps_min: number;
  reps_max: number;
  /** Added weight (a vest or a plate) on a strength day; null for bodyweight. */
  weight: number | null;
  /** Saturday: the last top step. */
  step: number | null;
  /** Each set's own reps when they differ: the pyramid's steps (1, 2, 3 …) and then its final set. */
  set_reps?: number[];
  deload: boolean;
  /** Up from last time (more reps, more weight, the next stage). */
  up: boolean;
  /** Nothing to do today (the lighter week's pyramid). */
  skip: boolean;
  text: string;
  effort: string;
}

const byDate = (a: PushupLog, b: PushupLog) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const before = (logs: PushupLog[], day: string, f: (l: PushupLog) => boolean) => logs.filter((l) => l.date < day && l.reps.length > 0 && f(l)).sort(byDate);

/**
 * A logged pyramid: the steps are the leading sets of 1, 2, 3 … reps, the final set is the last one.
 * ([1, 2, 3, 4, 5, 6, 7, 8, 22] → step 8, final 22.)
 */
export function pyramidResult(reps: number[]): { step: number | null; final: number | null } {
  let k = 0;
  while (k < reps.length - 1 && reps[k] === k + 1) k++;
  return { step: k || null, final: reps.length > k ? reps.at(-1)! : null };
}

/** The latest Monday test (set 1 of the max sets) before `day`, else the estimate. */
export function pushupTest(logs: PushupLog[], day: string, estimate: number): number {
  return before(logs, day, (l) => l.role === 'test').at(-1)?.reps[0] ?? estimate;
}

/** The push-up target for a day, from everything logged before it. */
export function pushupTarget(role: PushupRole, name: string, day: string, logs: PushupLog[], estimate: number, deload: boolean): PushupTarget {
  const test = pushupTest(logs, day, estimate);
  const base = { role, test, weight: null as number | null, step: null as number | null, deload, up: false, skip: false };

  if (role === 'test') {
    const last = before(logs, day, (l) => l.role === 'test').at(-1);
    const total = last ? last.reps.slice(0, 5).reduce((a, b) => a + b, 0) : null;
    if (deload) return { ...base, sets: 1, reps_min: test, reps_max: test + 1, text: `Lighter week: the test set only. Warm up with 1 easy set of 10, then 1 all-out set. Last test: ${test}.`, effort: 'One all-out set.' };
    return {
      ...base,
      sets: 5,
      reps_min: Math.max(1, Math.floor(test / 2)),
      reps_max: test + 1,
      text: `Warm up with 1 easy set of 10, then 5 all-out sets with 90 s rest. Set 1 is your weekly test: ${last ? `beat ${test}` : `your first one (estimate ${test})`}.${total ? ` Last week's 5-set total: ${total}; beat it.` : ''} Each set ends at the first rep that breaks form.`,
      effort: 'All-out: every set to the first broken rep.',
    };
  }

  if (role === 'training') {
    const half = Math.max(1, Math.floor(test / 2));
    const last = before(logs, day, (l) => l.role === 'training').at(-1);
    let reps = half;
    let note = `half your test of ${test}`;
    if (last) {
      const lastTarget = last.reps[0]!;
      const done10 = last.reps.length >= 10 && last.reps.slice(0, 10).every((r) => r >= lastTarget);
      if (done10 && lastTarget + 1 > reps) {
        reps = lastTarget + 1;
        note = 'you finished all 10 last week: 1 more rep';
      } else if (!done10 && lastTarget > reps) {
        reps = lastTarget;
        note = "last week's number: aim to finish all 10";
      }
    }
    return {
      ...base,
      sets: deload ? 5 : 10,
      reps_min: reps,
      reps_max: reps,
      up: !!last && reps > last.reps[0]!,
      text: deload
        ? `Lighter week: 5 training sets of ${reps}, 60 s rest.`
        : `Sets of ${reps} (${note}), 60 s rest, as many sets as you can with perfect form, up to 10. Finish all 10 and next week goes up by 1.`,
      effort: 'Perfect form; stop when a set would break it.',
    };
  }

  if (role === 'pyramid') {
    const last = before(logs, day, (l) => l.role === 'pyramid').at(-1);
    const { step, final } = last ? pyramidResult(last.reps) : { step: null, final: null };
    if (deload) return { ...base, sets: 1, reps_min: 1, reps_max: 1, skip: true, text: 'Lighter week: no pyramid today. Skip it.', effort: '' };
    // One set per step up to one past your best (10 the first time), then the final set.
    const steps = step ? step + 1 : 10;
    const finalTarget = final ? final + 1 : Math.max(1, Math.floor(test / 2));
    const set_reps = [...Array.from({ length: steps }, (_, i) => i + 1), finalTarget];
    return {
      ...base,
      sets: set_reps.length,
      reps_min: 1,
      reps_max: finalTarget,
      step,
      set_reps,
      text: `Each set is a step: 1 push-up, rest 10 s; 2, rest 20 s; 3, rest 30 s; and so on. Tick each step you finish and stop at the first one you can't. Then rest 2 min and do the last set, your final all-out set (type what you got).${step ? ` Last time: step ${step}${final ? `, final set ${final}` : ''}. Reach step ${step + 1}.` : ' Sets 1–10 are the steps; go as far as you can.'} Steps you don't reach: delete them or leave them unticked. If another workout was clearly this week's hardest, you can repeat it instead.`,
      effort: 'The final set all-out.',
    };
  }

  // Strength (Tue paused, Fri close-grip): 3 × 8–12 → 3 × 15 → add weight and drop back to 8–12.
  const last = before(logs, day, (l) => l.role === 'strength' && l.name.toLowerCase() === name.toLowerCase()).at(-1);
  const sets = deload ? 2 : 3;
  const style = /paus/i.test(name) ? ' 3 s down, 2 s pause just above the floor, press up.' : /close/i.test(name) ? ' Hands just inside shoulder width, elbows brushing your sides.' : '';
  const effort = '1–2 good reps left on each set.';
  if (!last) return { ...base, sets, reps_min: 8, reps_max: 12, text: `${sets} × 8–12, stopping each set with 1–2 good reps left.${style} If your left shoulder complains, these are the first push-ups to drop.`, effort };
  const reps = last.reps.slice(0, 3);
  const weight = last.weight && last.weight > 0 ? last.weight : null;
  const on = (w: number | null) => (w ? ` with ${w} lb on` : '');
  const full = reps.length >= 3;
  if (full && reps.every((r) => r >= 15)) {
    const next = (weight ?? 0) + 10;
    return { ...base, sets, reps_min: 8, reps_max: 12, weight: next, up: true, text: `All 3 sets at 15${on(weight)}: add a weight vest or a plate on your back (about ${next} lb) and drop back to 8–12.${style}`, effort };
  }
  if (reps.some((r) => r > 12)) return { ...base, sets, reps_min: 15, reps_max: 15, weight, text: `Keep at ${sets} × 15${on(weight)}: get every set to 15.${style}`, effort };
  if (full && reps.every((r) => r >= 12)) return { ...base, sets, reps_min: 15, reps_max: 15, weight, up: true, text: `All 3 sets at 12: now ${sets} × 15${on(weight)}.${style}`, effort };
  return { ...base, sets, reps_min: 8, reps_max: 12, weight, text: `${sets} × 8–12${on(weight)}: get every set to 12.${style}`, effort };
}
