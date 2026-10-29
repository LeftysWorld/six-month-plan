/**
 * Stretching plans: the stretch task type. Like a workout plan, the plan lives on the task; on the
 * day, the log lists each hold to tick off. No timers: the plan says how long, you do it.
 */

export interface StretchHold {
  name: string;
  /** How long or how many, as written: "2.5 min", "3 × 45 s", "2 × 8 each leg". */
  dose: string;
  /** Contract-relax rounds on push days. */
  cr?: boolean;
  /** Mind the knee: folded mat under it, get in slowly, sharp or pinching pain means raise the blocks or skip it. */
  knee?: boolean;
  /** How to do it. */
  how: string;
  /** Extra instructions on a push day (contract-relax rounds, the cobra). */
  push?: string;
  /** What changes on an easy day. */
  easy?: string;
  /** One of the holds done every session, or the day's focus slot. */
  part: 'daily' | 'focus';
}

export interface StretchPlan {
  /** Push days are 7–8 out of 10 with contract-relax; easy days are passive at 5–6. */
  day: 'push' | 'easy';
  /** "7–8 out of 10" */
  intensity: string;
  /** The day's focus slot: "Hamstrings", "Backbend (big)". */
  focus: string;
  holds: StretchHold[];
  /** A last line for the day ("Finish with 30 seconds hugging both knees to your chest"). */
  finish?: string;
}

/** The instructions for a hold on the day, with the push or easy variation when there is one. */
export function holdSteps(hold: StretchHold, day: 'push' | 'easy'): string[] {
  const out = [hold.how];
  if (day === 'push' && hold.push) out.push(`Push day: ${hold.push}`);
  if (day === 'easy' && hold.easy) out.push(`Easy day: ${hold.easy}`);
  return out;
}

/** A plan as saved: named holds only, trimmed. */
export function cleanStretchPlan(plan: StretchPlan): StretchPlan {
  return {
    ...plan,
    focus: plan.focus.trim(),
    intensity: plan.intensity.trim(),
    finish: plan.finish?.trim() || undefined,
    holds: plan.holds
      .filter((h) => h.name.trim())
      .map((h) => ({ ...h, name: h.name.trim(), dose: h.dose.trim(), how: h.how.trim(), push: h.push?.trim() || undefined, easy: h.easy?.trim() || undefined })),
  };
}

export const blankHold = (part: 'daily' | 'focus' = 'daily'): StretchHold => ({ name: '', dose: '2 min', how: '', part });
export const blankStretchPlan = (): StretchPlan => ({ day: 'push', intensity: '7–8 out of 10', focus: '', holds: [blankHold()] });
