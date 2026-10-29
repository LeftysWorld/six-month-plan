/**
 * Stretching plans: the stretch task type. Like a workout plan, the plan lives on the task; on the
 * day, the log lists each hold with its sets (one long hold, left and right, or 3 × 45 s), and a
 * timer counts each one down.
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
  /** Rest between sets, as written ("15 s", "30 s"). Defaults to 15 s. */
  rest?: string;
}

/** One set of a hold: timed (seconds) or counted (reps). */
export interface HoldSet {
  /** "1", "2", or "Left" / "Right" for a hold done on each side. */
  label: string;
  seconds: number | null;
  /** For counted sets: what to do, as written ("8–10", "8 each leg"). */
  reps: string | null;
  /** For counted sets: the number to log when you tick it as planned (the top of the range). */
  repsTarget: number | null;
}

const num = (s: string) => Number(s.replace(',', '.'));

/**
 * A hold's sets, read from its dose:
 * - "2.5 min", "3.5–4 min" → one timed set (the low end of a range: add time as you go)
 * - "1.5 min each leg" → Left and Right
 * - "3 × 45 s", "3 × 20–30 s" → three timed sets
 * - "2 × 8–10", "2 × 10 each leg" → counted sets
 * Anything else is one set to tick off.
 */
export function holdSets(hold: StretchHold): HoldSet[] {
  const dose = hold.dose.trim().toLowerCase();
  const each = /each (leg|side)/.test(dose);
  const timedSets = dose.match(/^(\d+)\s*[×x*]\s*(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(s|sec|secs|seconds|min|mins|minutes)\b/);
  if (timedSets) {
    const secs = Math.round(num(timedSets[2]!) * (timedSets[3]!.startsWith('m') ? 60 : 1));
    const count = Math.min(10, Math.max(1, Number(timedSets[1])));
    return Array.from({ length: count }, (_, i) => ({ label: String(i + 1), seconds: secs, reps: null, repsTarget: null }));
  }
  const timed = dose.match(/^(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(s|sec|secs|seconds|min|mins|minutes)\b/);
  if (timed) {
    const secs = Math.round(num(timed[1]!) * (timed[2]!.startsWith('m') ? 60 : 1));
    return each
      ? [
          { label: 'Left', seconds: secs, reps: null, repsTarget: null },
          { label: 'Right', seconds: secs, reps: null, repsTarget: null },
        ]
      : [{ label: '1', seconds: secs, reps: null, repsTarget: null }];
  }
  const counted = dose.match(/^(\d+)\s*[×x*]\s*(\d+)(?:\s*[–-]\s*(\d+))?/);
  if (counted) {
    const count = Math.min(10, Math.max(1, Number(counted[1])));
    const reps = `${counted[2]}${counted[3] ? `–${counted[3]}` : ''}${each ? ` each ${dose.includes('side') ? 'side' : 'leg'}` : ''}`;
    const target = Number(counted[3] ?? counted[2]);
    return Array.from({ length: count }, (_, i) => ({ label: String(i + 1), seconds: null, reps, repsTarget: target }));
  }
  return [{ label: '1', seconds: null, reps: null, repsTarget: null }];
}

/** Seconds of rest between a hold's sets (10 s to switch sides). */
export function holdRest(hold: StretchHold, next: HoldSet | undefined): number {
  if (next && (next.label === 'Right' || next.label === 'Left')) return 10;
  const m = hold.rest?.match(/(\d+(?:[.,]\d+)?)\s*(s|sec|min)?/i);
  if (!m) return 15;
  return Math.round(num(m[1]!) * (m[2]?.toLowerCase().startsWith('m') ? 60 : 1));
}

/**
 * Contract-relax cues inside a timed hold on a push day: settle in, then up to 3 rounds of
 * contract about 8 s / relax and sink about 27 s, then hold the new depth. A 90 s hold gets 2
 * rounds after 15 s; a 5 min side split does its rounds in the middle minutes.
 */
export function crCues(total: number): { at: number; cue: string; kind: 'settle' | 'contract' | 'relax' | 'hold' }[] {
  const rounds = Math.min(3, Math.floor((total - 15) / 35));
  if (rounds < 1) return [];
  const settle = Math.max(15, Math.round((total - rounds * 35) / 2));
  const out: { at: number; cue: string; kind: 'settle' | 'contract' | 'relax' | 'hold' }[] = [{ at: 0, cue: 'Settle in at 7 out of 10', kind: 'settle' }];
  for (let r = 0; r < rounds; r++) {
    out.push({ at: settle + r * 35, cue: `Contract ${r + 1} of ${rounds}: press at half effort, don't move`, kind: 'contract' });
    out.push({ at: settle + r * 35 + 8, cue: 'Relax, breathe out, sink deeper', kind: 'relax' });
  }
  if (settle + rounds * 35 < total) out.push({ at: settle + rounds * 35, cue: 'Hold the new depth', kind: 'hold' });
  return out;
}

/** 185 → "3:05". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What you typed for a time: "3:05", "3", "2.5" (minutes, up to 10) or "45" (seconds). Null when it isn't a time. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const mmss = t.match(/^(\d+):(\d{1,2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const n = num(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n <= 10 ? Math.round(n * 60) : Math.round(n);
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
      .map((h) => ({ ...h, name: h.name.trim(), dose: h.dose.trim(), how: h.how.trim(), push: h.push?.trim() || undefined, easy: h.easy?.trim() || undefined, rest: h.rest?.trim() || undefined })),
  };
}

export const blankHold = (part: 'daily' | 'focus' = 'daily'): StretchHold => ({ name: '', dose: '2 min', how: '', part });
export const blankStretchPlan = (): StretchPlan => ({ day: 'push', intensity: '7–8 out of 10', focus: '', holds: [blankHold()] });
