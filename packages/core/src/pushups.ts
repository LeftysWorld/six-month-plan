/**
 * Road to 100 Push-Ups. One max test a week (Saturday) sets the next week's numbers, so you always
 * train from your real current max:
 *
 * - Volume day (Monday): sub-max sets with short rest, by phase of your max.
 *     Phase 1, max under 60: 5 sets × 60% of max.
 *     Phase 2, max 60–79:   4 sets × 65% of max.
 *     Phase 3, max 80+:     3 sets × 70% of max, then 1 set to 2 short of max.
 *   Round down. Couldn't finish every set last Monday: the same numbers again.
 * - Max test (Saturday): 1 set, as many perfect reps as possible. Stop at the first rep that breaks form.
 * - Home practice (Wed and Sun, optional): 3 sets × 40% of max, an hour or more apart.
 * - Lighter week: Monday 3 sets × 50% of max, no test, no home practice.
 * - Same max two Saturdays in a row: skip home practice for a week, then retest.
 *
 * Push-ups are bodyweight lifts, so they're outside the rep cap.
 */

export type PushupRole = 'test' | 'volume';

/** "Push-Up Max Test" is the test; any other push-up (not assisted, not a pike or handstand) is the volume day. */
export function pushupRole(name: string): PushupRole | null {
  if (!/push[- ]?ups?\b/i.test(name) || /assisted|pike|handstand/i.test(name)) return null;
  return /max|test/i.test(name) ? 'test' : 'volume';
}

export interface PushupSets {
  phase: 1 | 2 | 3 | null;
  sets: number;
  reps: number;
  /** Phase 3's last set: 2 short of max. */
  extra: number | null;
}

/** Monday's sets for a max (round down). `deload`: the lighter week's 3 × 50%. */
export function pushupVolume(max: number, deload = false): PushupSets {
  const m = Math.max(1, Math.floor(max));
  if (deload) return { phase: null, sets: 3, reps: Math.max(1, Math.floor(m * 0.5)), extra: null };
  if (m < 60) return { phase: 1, sets: 5, reps: Math.max(1, Math.floor(m * 0.6)), extra: null };
  if (m < 80) return { phase: 2, sets: 4, reps: Math.floor(m * 0.65), extra: null };
  return { phase: 3, sets: 3, reps: Math.floor(m * 0.7), extra: m - 2 };
}

/** Home practice: 3 sets × 40% of max. */
export const pushupPractice = (max: number): number => Math.max(1, Math.floor(Math.floor(max) * 0.4));

export interface PushupHistory {
  /** Saturday tests before the day, oldest first: the best set of each. */
  tests: { date: string; max: number }[];
  /** The last volume day before the day: its date and the reps of each set. */
  lastVolume: { date: string; reps: number[] } | null;
}

/** The max in effect on `day`: the latest test before it, else the starting estimate. */
export function pushupMaxOn(tests: PushupHistory['tests'], day: string, estimate: number): number {
  return tests.filter((t) => t.date < day).at(-1)?.max ?? estimate;
}

export interface PushupTarget {
  role: PushupRole;
  max: number;
  sets: number;
  reps: number;
  extra: number | null;
  practice: number;
  /** Repeating last Monday's numbers because not every set reached them. */
  repeat: boolean;
  /** The same max two Saturdays running. */
  flat: boolean;
  deload: boolean;
  text: string;
  effort: string;
}

/** The push-up target for a day, from the tests and the last volume day. */
export function pushupTarget(role: PushupRole, day: string, h: PushupHistory, estimate: number, deload: boolean): PushupTarget {
  const max = pushupMaxOn(h.tests, day, estimate);
  const before = h.tests.filter((t) => t.date < day);
  const flat = before.length >= 2 && before.at(-1)!.max <= before.at(-2)!.max;
  const practice = pushupPractice(max);
  const flatNote = flat ? ' Same max two Saturdays running: skip the home practice this week and sleep well, then retest.' : '';

  if (role === 'test') {
    if (deload) return { role, max, sets: 1, reps: max, extra: null, practice, repeat: false, flat, deload, text: 'Lighter week: no test today. Test again next Saturday.', effort: '' };
    const last = before.at(-1);
    return {
      role,
      max,
      sets: 1,
      reps: max + 1,
      extra: null,
      practice,
      repeat: false,
      flat,
      deload,
      text: `One set, as many perfect reps as you can, right after the pull-ups. ${last ? `Last max: ${last.max}.` : `Starting estimate: ${max}.`} Stop at the first rep that breaks form: that number sets next week.${flatNote}`,
      effort: 'One set to the first broken rep.',
    };
  }

  let s = pushupVolume(max, deload);
  let repeat = false;
  // Couldn't finish every set at the target last Monday: keep the same numbers.
  if (!deload && h.lastVolume) {
    const thenMax = pushupMaxOn(h.tests, h.lastVolume.date, estimate);
    const then = pushupVolume(thenMax);
    const reps = h.lastVolume.reps;
    const done = reps.length >= then.sets && reps.slice(0, then.sets).every((r) => r >= then.reps);
    if (!done) {
      s = then;
      repeat = true;
    }
  }
  const sets = `${s.sets} × ${s.reps}${s.extra ? `, then 1 set of ${s.extra}` : ''}`;
  const text = deload
    ? `Lighter week: ${sets} (half your max of ${max}). No test Saturday, no home practice.`
    : repeat
      ? `Not every set reached ${s.reps} last time: the same ${sets} again. Max ${max}.${flatNote}`
      : `Max ${max} → phase ${s.phase}: ${sets}, 90 s rest. Stop each set with 2–3 good reps left. Home practice Wed and Sun (optional): 3 × ${practice}.${flatNote}`;
  return { role, max, sets: s.sets, reps: s.reps, extra: s.extra, practice, repeat, flat, deload, text, effort: deload ? 'Easy: 3–4 reps left on every set.' : 'Stop each set with 2–3 good reps left.' };
}
