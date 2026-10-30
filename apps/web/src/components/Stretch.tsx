import { useEffect, useRef, useState } from 'react';
import { blankHold, clockText, crCues, holdRest, holdSets, holdSteps, parseClock, weekdayName, type HoldSet, type Session, type StretchHold, type StretchHoldLog, type StretchPlan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { opsLogSession, opsRestoreSession, opsSaveStretch, type StretchSetInput } from '../data/ops.ts';
import type { AppData, Op } from '../data/model.ts';
import { Icon, Sheet, useToast } from './ui.tsx';
import { DemoButton } from './ExerciseDemo.tsx';
import { LinkToGoal, needsGoalLink } from './LinkToGoal.tsx';
import { MoveDayPicker, moveDatesFor } from './MoveDayPicker.tsx';
import { SessionFiles } from './Attachments.tsx';
import { useView } from '../data/useView.ts';

/**
 * The stretching task type, laid out like the workout log. The day's holds live on the task (the
 * Daily Eight, then the focus slot), push or easy. Each hold has its sets: one long hold, Left and
 * Right, 3 × 45 s, or a counted set like 2 × 8–10. Tap ▶ and the timer counts the set down (with the
 * contract-relax cues on a push day), ticks it, rests or switches sides, and carries on to the next.
 */

type Mode = 'push' | 'easy';

// ---------- On the Today card ----------

/** Before: the day's holds and how long. After: what you held, hold by hold. Same layout as a workout. */
export function StretchCardPlan({ session, plan }: { session: Session; plan: StretchPlan }) {
  const { data } = useStore();
  const logged = data.stretchHolds.filter((h) => h.session_id === session.id);
  if (session.status !== 'planned' && logged.length) {
    const holdsDone = plan.holds.filter((h, i) => holdDone(logged, h, i)).length;
    return (
      <span className="workout-card-plan">
        <span className="workout-card-sum">
          {holdsDone} of {plan.holds.length} holds done{logged.some((h) => h.pain) ? ' · ⚠ something hurt' : ''}
        </span>
        {plan.holds.map((h, i) => {
          const mine = setsOf(logged, h, i).filter((x) => x.done);
          return (
            <span key={i} className="workout-card-ex">
              <span className="workout-card-name">{h.name}</span>
              <span className="num">{mine.length ? mine.map((x) => setText(x, holdSets(h))).join(' · ') : 'skipped'}</span>
            </span>
          );
        })}
      </span>
    );
  }
  if (session.status !== 'planned') return null;
  return (
    <span className="workout-card-plan">
      <span className="workout-card-ex">
        <span className="workout-card-name muted">{plan.day === 'push' ? 'Push day' : 'Easy day'} · {plan.intensity}</span>
      </span>
      {plan.holds.map((h, i) => (
        <span key={i} className="workout-card-ex">
          <span className="workout-card-name">{h.name}</span>
          <span className="num">{h.dose}</span>
        </span>
      ))}
    </span>
  );
}

/** A hold's logged rows in set order. Matches by place in the plan, then by name. */
function setsOf(logged: StretchHoldLog[], hold: StretchHold, position: number): StretchHoldLog[] {
  const byPlace = logged.filter((x) => x.position === position && x.hold === hold.name);
  const mine = byPlace.length ? byPlace : logged.filter((x) => x.hold.toLowerCase() === hold.name.toLowerCase());
  return [...mine].sort((a, b) => (a.set_no ?? 1) - (b.set_no ?? 1));
}

function holdDone(logged: StretchHoldLog[], hold: StretchHold, position: number): boolean {
  const mine = setsOf(logged, hold, position);
  return mine.length > 0 && mine.every((x) => x.done);
}

/** "3:00", "L 1:30", "10" — one logged set, short. */
function setText(x: StretchHoldLog, plan: HoldSet[]): string {
  const label = plan[(x.set_no ?? 1) - 1]?.label;
  const side = label === 'Left' ? 'L ' : label === 'Right' ? 'R ' : '';
  if (x.seconds != null) return `${side}${clockText(x.seconds)}`;
  if (x.reps != null) return `${side}${x.reps}`;
  return `${side}✓`;
}

// ---------- Logging a session ----------

interface Row {
  /** What you typed: a time ("3:00") for a timed set, reps for a counted one. Empty means the plan. */
  value: string;
  done: boolean;
}
interface Draft {
  rows: Row[][];
  pain: boolean[];
  easy: boolean;
}
const draftKey = (id: string) => `six.stretch.${id}`;
const HANDS_FREE = 'six.stretch.handsfree';
const SOUND = 'six.stretch.sound';
/** Seconds to get into the next hold when hands-free is on. */
const GET_IN = 20;

function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft> & { done?: boolean[] };
    // Drafts from before sets were a hold's ticks only: no use now.
    return Array.isArray(parsed.rows) ? (parsed as Draft) : null;
  } catch {
    return null;
  }
}
const readFlag = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const writeFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // storage blocked
  }
};

/** The sets of this task's last logged session before `session`, by hold name. */
function lastTime(data: AppData, session: Session): Map<string, StretchHoldLog[]> {
  const earlier = data.sessions
    .filter((s) => s.action_id === session.action_id && s.id !== session.id && s.status !== 'planned' && s.status !== 'skipped' && (s.date ?? s.week_start) <= (session.date ?? session.week_start))
    .sort((a, b) => ((a.date ?? a.week_start) < (b.date ?? b.week_start) ? 1 : -1));
  for (const s of earlier) {
    const sets = data.stretchHolds.filter((w) => w.session_id === s.id && (w.seconds != null || w.reps != null));
    if (!sets.length) continue;
    const by = new Map<string, StretchHoldLog[]>();
    for (const w of [...sets].sort((a, b) => (a.set_no ?? 1) - (b.set_no ?? 1))) by.set(w.hold.toLowerCase(), [...(by.get(w.hold.toLowerCase()) ?? []), w]);
    return by;
  }
  return new Map();
}

/** The running timer: holding a set, resting before the next set, or getting into the next hold. */
interface Timer {
  hold: number;
  set: number;
  phase: 'hold' | 'rest' | 'next';
  /** When it reaches zero (ms). Null while waiting for you to tap Start. */
  end: number | null;
  /** Length of this phase in seconds (changes with −15 s / +15 s). */
  total: number;
  /** Time left (ms) while paused. */
  paused: number | null;
}

/** Keep the screen on while the timer runs (where the browser allows it). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const get = () =>
      nav.wakeLock
        ?.request('screen')
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    void get();
    // The lock is dropped when the page is hidden; take it again when it's back.
    const onVisible = () => document.visibilityState === 'visible' && void get();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}

/** Beeps for the timer. Started from a tap (Start), so phones let it play. */
function useBeeper(enabled: boolean) {
  const ctx = useRef<AudioContext | null>(null);
  const unlock = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx.current ??= new AC();
      void ctx.current.resume();
    } catch {
      // no sound on this device
    }
  };
  const beep = (pattern: 'tick' | 'cue' | 'end') => {
    navigator.vibrate?.(pattern === 'end' ? [250, 120, 250] : pattern === 'cue' ? [120] : [30]);
    const c = ctx.current;
    if (!enabled || !c) return;
    try {
      const notes = pattern === 'end' ? [880, 1175] : pattern === 'cue' ? [660] : [440];
      notes.forEach((freq, n) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.value = freq;
        o.connect(g);
        g.connect(c.destination);
        const t = c.currentTime + n * 0.22;
        const len = pattern === 'tick' ? 0.08 : 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.start(t);
        o.stop(t + len + 0.02);
      });
    } catch {
      // no sound on this device
    }
  };
  return { unlock, beep };
}

/**
 * The stretching log, laid out like the workout log: one hold open at a time, a row per set
 * (set · previous · time · ▶ · ✓). Times start at the plan in grey: tick a set you held as planned,
 * type over it when you held it longer or shorter, or tap ▶ to have the timer count it. The timer
 * sits at the bottom like the rest timer, ticks the set when it's done, rests or switches sides,
 * and opens the next hold. Progress is kept on this device until you finish.
 */
export function StretchSheet({ session, plan, onClose, onGeneral }: { session: Session; plan: StretchPlan; onClose: () => void; onGeneral?: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const day = session.date ?? today;
  const future = day > today;
  const saved = data.stretchHolds.filter((h) => h.session_id === session.id);
  const last = lastTime(data, session);
  const sets = plan.holds.map(holdSets);
  const [draft] = useState<Draft | null>(() => readDraft(session.id));
  const fits = (r: Row[][] | undefined) => !!r && r.length === sets.length && r.every((x, i) => x.length === sets[i]!.length);

  const [rows, setRows] = useState<Row[][]>(() => {
    if (fits(draft?.rows)) return draft!.rows;
    return plan.holds.map((h, i) => {
      const mine = setsOf(saved, h, i);
      return sets[i]!.map((plannedSet, k) => {
        const s = mine.find((x) => (x.set_no ?? 1) === k + 1);
        if (!s) return { value: '', done: false };
        const value = s.seconds != null ? clockText(s.seconds) : s.reps != null ? String(s.reps) : '';
        // Rows saved before sets were kept: one row for the whole hold.
        return { value: plannedSet.seconds != null && s.seconds == null ? '' : value, done: s.done };
      });
    });
  });
  const [pain, setPain] = useState<boolean[]>(() => (draft?.pain?.length === plan.holds.length ? draft.pain : plan.holds.map((h, i) => setsOf(saved, h, i).some((x) => x.pain))));
  const [easy, setEasy] = useState<boolean>(() => draft?.easy ?? /ran as an easy day/i.test(session.note));
  const firstOpen = (r: Row[][]) => r.findIndex((x) => x.some((y) => !y.done));
  const [open, setOpen] = useState<number>(() => (future ? -1 : Math.max(0, firstOpen(rows))));
  const [note, setNote] = useState(session.note);
  const [moving, setMoving] = useState(false);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [handsFree, setHandsFree] = useState(() => readFlag(HANDS_FREE, true));
  const [sound, setSound] = useState(() => readFlag(SOUND, true));
  const { unlock, beep } = useBeeper(sound);
  const mode: Mode = easy ? 'easy' : plan.day;
  const anyKnee = plan.holds.some((h) => h.knee);
  const lastCue = useRef<string>('');
  const lastTick = useRef<number>(-1);

  useEffect(() => {
    if (future) return;
    try {
      localStorage.setItem(draftKey(session.id), JSON.stringify({ rows, pain, easy } satisfies Draft));
    } catch {
      // storage blocked: the draft just isn't kept
    }
  }, [rows, pain, easy, future, session.id]);

  useWakeLock(timer != null && timer.paused == null);

  // ---- what a set counts as ----
  /** A set as logged: what you typed, or the plan. */
  const actual = (i: number, k: number): { seconds: number | null; reps: number | null } => {
    const s = sets[i]![k]!;
    const v = rows[i]![k]!.value;
    if (s.seconds != null) return { seconds: parseClock(v) ?? s.seconds, reps: null };
    if (s.reps != null) {
      const n = Number(v);
      return { seconds: null, reps: v.trim() !== '' && Number.isFinite(n) ? n : s.repsTarget };
    }
    return { seconds: null, reps: null };
  };
  const planned = (i: number, k: number) => {
    const s = sets[i]![k]!;
    return s.seconds != null ? clockText(s.seconds) : s.repsTarget != null ? String(s.repsTarget) : '';
  };

  /** Where to go after hold i set k: the next set of the hold, else the first hold with sets left. */
  const nextAfter = (r: Row[][], i: number, k: number): { hold: number; set: number } | null => {
    const inHold = r[i]!.findIndex((y, z) => z > k && !y.done);
    if (inHold >= 0) return { hold: i, set: inHold };
    for (let step = 1; step <= r.length; step++) {
      const j = (i + step) % r.length;
      const z = r[j]!.findIndex((y) => !y.done);
      if (z >= 0) return { hold: j, set: z };
    }
    return null;
  };

  /** Tick a set (with what you held), then fold the hold if it's done and open the next. */
  function complete(i: number, k: number, value?: string): Row[][] {
    const a = actual(i, k);
    const v = value ?? (a.seconds != null ? clockText(a.seconds) : a.reps != null ? String(a.reps) : '');
    const next = rows.map((x, a2) => (a2 === i ? x.map((y, b) => (b === k ? { value: v, done: true } : y)) : x));
    setRows(next);
    if (next[i]!.every((y) => y.done)) setOpen(firstOpen(next));
    return next;
  }

  const tick = (i: number, k: number) => {
    if (rows[i]![k]!.done) {
      setRows((all) => all.map((x, a) => (a === i ? x.map((y, b) => (b === k ? { ...y, done: false } : y)) : x)));
      return;
    }
    if (timer && timer.hold === i && timer.set === k) setTimer(null);
    complete(i, k);
  };

  // ---- the timer ----
  const start = (i: number, k: number) => {
    unlock();
    const s = sets[i]![k]!;
    setOpen(i);
    lastCue.current = '';
    lastTick.current = -1;
    if (s.seconds == null) {
      setTimer(null);
      return;
    }
    const secs = actual(i, k).seconds ?? s.seconds;
    const t = Date.now();
    setNow(t);
    setTimer({ hold: i, set: k, phase: 'hold', end: t + secs * 1000, total: secs, paused: null });
  };

  /** What comes after a finished set: rest or switch sides, get into the next hold, or done. */
  const afterSet = (r: Row[][], i: number, k: number) => {
    const n = nextAfter(r, i, k);
    if (!n) {
      setTimer(null);
      beep('end');
      return;
    }
    const t = Date.now();
    setNow(t);
    if (n.hold === i) {
      const rest = holdRest(plan.holds[i]!, sets[i]![n.set]);
      setTimer({ hold: n.hold, set: n.set, phase: 'rest', end: t + rest * 1000, total: rest, paused: null });
    } else {
      setOpen(n.hold);
      setTimer({ hold: n.hold, set: n.set, phase: 'next', end: handsFree && sets[n.hold]![n.set]!.seconds != null ? t + GET_IN * 1000 : null, total: GET_IN, paused: null });
    }
  };

  // Counts to a time (not by ticks), so it stays right after the phone sleeps.
  useEffect(() => {
    if (!timer || timer.end == null || timer.paused != null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [timer]);

  useEffect(() => {
    if (!timer || timer.end == null || timer.paused != null) return;
    const left = Math.ceil((timer.end - now) / 1000);
    // Cues inside a contract-relax hold.
    if (timer.phase === 'hold') {
      const hold = plan.holds[timer.hold]!;
      if (hold.cr && mode === 'push') {
        const elapsed = timer.total - (timer.end - now) / 1000;
        const cue = [...crCues(timer.total)].reverse().find((c) => c.at <= elapsed);
        if (cue && cue.cue !== lastCue.current) {
          if (lastCue.current) beep('cue');
          lastCue.current = cue.cue;
        }
      }
    }
    // The last 3 seconds of any countdown.
    if (left <= 3 && left >= 1 && left !== lastTick.current) {
      lastTick.current = left;
      beep('tick');
    }
    if (now < timer.end) return;
    lastTick.current = -1;
    if (timer.phase === 'hold') {
      beep('end');
      const r = complete(timer.hold, timer.set, clockText(timer.total));
      afterSet(r, timer.hold, timer.set);
    } else {
      beep('cue');
      start(timer.hold, timer.set);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, timer]);

  const left = timer?.end != null ? Math.max(0, Math.ceil(((timer.paused ?? timer.end - now) as number) / 1000)) : 0;
  const pause = () => setTimer((t) => (t && t.end != null && t.paused == null ? { ...t, paused: Math.max(0, t.end - Date.now()) } : t));
  const resume = () => {
    unlock();
    setTimer((t) => (t && t.paused != null ? { ...t, end: Date.now() + t.paused, paused: null } : t));
  };
  const adjust = (by: number) =>
    setTimer((t) => {
      if (!t || t.end == null) return t;
      if (t.paused != null) {
        const p = Math.max(1000, t.paused + by * 1000);
        return { ...t, paused: p, total: Math.max(1, t.total + by) };
      }
      return { ...t, end: Math.max(Date.now() + 1000, t.end + by * 1000), total: Math.max(1, t.total + by) };
    });
  /** Stop the hold now and log what you held so far. */
  const doneEarly = () => {
    if (!timer || timer.phase !== 'hold' || timer.end == null) return;
    const remaining = timer.paused ?? Math.max(0, timer.end - Date.now());
    const held = Math.max(1, Math.round(timer.total - remaining / 1000));
    const r = complete(timer.hold, timer.set, clockText(held));
    afterSet(r, timer.hold, timer.set);
  };

  // ---- saving ----
  const doneSets = rows.flat().filter((r) => r.done).length;
  const totalSets = rows.flat().length;
  const holdsDone = rows.filter((r) => r.every((y) => y.done)).length;

  function finish() {
    const before = session;
    setTimer(null);
    const out: StretchSetInput[] = plan.holds.flatMap((h, i) => rows[i]!.map((r, k) => ({ hold: h.name, position: i, set_no: k + 1, ...actual(i, k), done: r.done, pain: !!pain[i] })));
    const { ops, undo } = opsSaveStretch(data, session.id, out);
    const status = doneSets >= totalSets ? 'done' : 'partial';
    const flagged = plan.holds.filter((_, i) => pain[i]).map((h) => h.name);
    const extra = [easy && plan.day === 'push' ? 'Ran as an easy day.' : '', flagged.length ? `Hurt: ${flagged.join(', ')}.` : ''].filter(Boolean);
    const cleaned = note.replace(/\s*Ran as an easy day\.|\s*Hurt: [^.]*\./g, '').trim();
    const finalNote = [cleaned, ...extra].filter(Boolean).join(' ');
    commit([...ops, ...opsLogSession(session, { status, note: finalNote, on: today })]);
    try {
      localStorage.removeItem(draftKey(session.id));
    } catch {
      // nothing to clear
    }
    toast(`${session.title}: ${holdsDone} of ${plan.holds.length} holds`, () => commit([...undo, ...opsRestoreSession(before)] as Op[]));
    onClose();
  }

  const timing = timer ? plan.holds[timer.hold]! : null;
  const timingSet = timer ? sets[timer.hold]![timer.set]! : null;
  const cue =
    timer?.phase === 'hold' && timing?.cr && mode === 'push'
      ? [...crCues(timer.total)].reverse().find((c) => c.at <= timer.total - (timer.paused ?? (timer.end ?? now) - now) / 1000)
      : undefined;

  return (
    <Sheet title={session.title} onClose={onClose}>
      {needsGoalLink(data, session) && <LinkToGoal session={session} />}
      <div className="stack-sm" style={{ marginTop: -8, gap: 8 }}>
        <div className="row-between small muted">
          <span>
            {easy && plan.day === 'push' ? 'Easy day · 5–6 out of 10, passive' : `${plan.day === 'push' ? 'Push day' : 'Easy day'} · ${plan.intensity}`}
            <br />
            {future ? `${plan.holds.length} holds · ${totalSets} sets` : `${holdsDone} of ${plan.holds.length} holds`}
            {session.planned_minutes ? ` · about ${session.planned_minutes} min` : ''}
          </span>
          {!future && doneSets > 0 && (
            <button type="button" className="btn small primary" onClick={finish}>
              {session.status === 'planned' ? 'Finish' : 'Save'}
            </button>
          )}
        </div>
        {!future && (
          <span className="workout-progress" aria-hidden="true">
            <i style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }} />
          </span>
        )}
      </div>
      {future && <div className="banner info">This is {weekdayName(day)}’s session. On {weekdayName(day)}, open it from Today to time each hold and tick it off.</div>}

      {plan.day === 'push' && !future && (
        <label className="check-row small">
          <input type="checkbox" checked={easy} onChange={(e) => setEasy(e.target.checked)} />
          <span>Sore or tweaky? Run it as an easy day: same holds, passive, no contract-relax.</span>
        </label>
      )}
      {mode === 'push' && (
        <details className="task-details">
          <summary>Contract-relax (C-R)</summary>
          <div className="task-details-body">
            Inside the stretch, press the stretched muscle into the floor, block or band at about half effort for 5–10 seconds without moving. Then relax and sink a little deeper for 20–30 seconds. 3 rounds per hold. The timer calls out each round. Breathe slowly the whole time; if you can't breathe calmly, back off a little.
          </div>
        </details>
      )}
      {anyKnee && (
        <details className="task-details">
          <summary>Protect your knee</summary>
          <div className="task-details-body">
            Folded mat or towel under your knees. Hips supported on blocks in the front splits. Into the frog slowly, then stay still. Sharp or pinching knee pain: raise the blocks or skip that hold today. Same for bridges and butterfly.
          </div>
        </details>
      )}

      <div className="stack-sm" style={{ gap: 8 }}>
        {plan.holds.map((h, i) => {
          const mine = rows[i]!;
          const hs = sets[i]!;
          const done = mine.filter((r) => r.done).length;
          const finished = done >= mine.length;
          const isOpen = open === i;
          const prev = last.get(h.name.toLowerCase());
          const timed = hs.some((s) => s.seconds != null);
          const counted = hs.some((s) => s.reps != null);
          const firstFocus = h.part === 'focus' && plan.holds.findIndex((x) => x.part === 'focus') === i;
          return (
            <div key={i} className="stack-sm" style={{ gap: 8 }}>
              {firstFocus && <span className="label" style={{ marginTop: 4 }}>Focus · {plan.focus || 'today'}</span>}
              {i === 0 && h.part === 'daily' && <span className="label">The daily holds</span>}
              <section className={`workout-ex${isOpen ? ' open' : ''}${pain[i] ? ' pain' : ''}`} aria-label={h.name}>
                <button type="button" className="workout-ex-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
                  <span className={`workout-ex-badge${finished && !future ? ' done' : ''}`}>{finished && !future ? <Icon name="check" size={13} stroke={3} /> : i + 1}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <b className="workout-ex-name">{h.name}</b>
                    {done > 0 && !isOpen ? (
                      <span className="workout-did">
                        {mine.map((r, k) =>
                          r.done ? (
                            <span key={k} className="workout-chip">
                              {hs[k]!.label === 'Left' ? 'L ' : hs[k]!.label === 'Right' ? 'R ' : ''}
                              {hs[k]!.seconds != null ? clockText(actual(i, k).seconds ?? 0) : hs[k]!.reps != null ? `${actual(i, k).reps} reps` : '✓'}
                            </span>
                          ) : null,
                        )}
                        {done < mine.length && <span className="xsmall muted">{mine.length - done} not done</span>}
                        {pain[i] && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>⚠ hurt</span>}
                      </span>
                    ) : (
                      <span className="xsmall muted num">
                        {h.dose}
                        {h.cr && mode === 'push' ? ' · C-R' : ''}
                        {h.knee ? ' · mind the knee' : ''}
                        {pain[i] ? ' · ⚠ hurt' : ''}
                      </span>
                    )}
                  </span>
                  {!future && (
                    <span className="xsmall muted num" style={{ flex: 'none' }}>
                      {done}/{mine.length}
                    </span>
                  )}
                  <span style={{ transform: isOpen ? 'rotate(-90deg)' : 'rotate(90deg)', display: 'inline-flex', color: 'var(--muted)', flex: 'none' }}>
                    <Icon name="chevron" size={14} stroke={2.2} />
                  </span>
                </button>
                {isOpen && (
                  <div className="workout-ex-body">
                    <DemoButton name={h.name} kind="stretch" demo={h.demo} steps={holdSteps(h, mode)} />
                    <details className="stretch-how">
                      <summary className="small">How to do it</summary>
                      <div className="small stack-sm" style={{ gap: 6, marginTop: 6, color: 'var(--ink-2)', lineHeight: 1.45 }}>
                        {holdSteps(h, mode).map((t, n) => (
                          <p key={n} style={{ margin: 0 }}>
                            {t}
                          </p>
                        ))}
                      </div>
                    </details>
                    <div className={`workout-sets stretch-sets${future ? ' preview' : ''}`} role="table" aria-label={`${h.name} sets`}>
                      <span className="stretch-set head xsmall muted" role="row">
                        <span>Set</span>
                        <span>Previous</span>
                        <span>{timed ? 'Time' : counted ? 'Reps' : ''}</span>
                        <span />
                        <span />
                      </span>
                      {mine.map((r, k) => {
                        const s = hs[k]!;
                        const p = prev?.find((x) => (x.set_no ?? 1) === k + 1);
                        const running = timer?.hold === i && timer.set === k && timer.phase === 'hold';
                        return (
                          <div key={k} className={`stretch-set${r.done ? ' done' : ''}${running ? ' running' : ''}`} role="row">
                            <span className="num small">{s.label === 'Left' ? 'L' : s.label === 'Right' ? 'R' : s.label}</span>
                            <button
                              type="button"
                              className="workout-prev num"
                              disabled={!p || future || r.done}
                              onClick={() => p && setRows((all) => all.map((x, a) => (a === i ? x.map((y, b) => (b === k ? { ...y, value: p.seconds != null ? clockText(p.seconds) : String(p.reps ?? '') } : y)) : x)))}
                              aria-label={p ? `Copy last time: ${setText(p, hs)}` : 'No previous set'}
                            >
                              {p ? setText(p, hs).replace(/^[LR] /, '') : '—'}
                            </button>
                            {future || (s.seconds == null && s.reps == null) ? (
                              <span className="workout-cell num">{s.seconds != null ? clockText(s.seconds) : s.reps ?? '—'}</span>
                            ) : running ? (
                              <span className="workout-cell num" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>
                                {clockText(left)}
                              </span>
                            ) : (
                              <input
                                className="input"
                                type="text"
                                inputMode={s.seconds != null ? 'text' : 'numeric'}
                                aria-label={`${h.name} set ${s.label} ${s.seconds != null ? 'time' : `reps (${s.reps})`}`}
                                placeholder={planned(i, k)}
                                value={r.value}
                                onFocus={(x) => x.target.select()}
                                onChange={(x) => setRows((all) => all.map((y, a) => (a === i ? y.map((z, b) => (b === k ? { ...z, value: x.target.value } : z)) : y)))}
                              />
                            )}
                            {!future && s.seconds != null && !r.done ? (
                              <button type="button" className={`set-play${running ? ' on' : ''}`} aria-label={running ? 'Stop the timer' : `Start ${s.label === '1' ? '' : `${s.label} `}timer`} onClick={() => (running ? setTimer(null) : start(i, k))}>
                                <Icon name={running ? 'x' : 'play'} size={15} stroke={2.4} />
                              </button>
                            ) : (
                              <span />
                            )}
                            {!future ? (
                              <button type="button" className={`set-tick${r.done ? ' on' : ''}`} aria-pressed={r.done} aria-label={`Set ${s.label} done`} onClick={() => tick(i, k)}>
                                <Icon name="check" size={16} stroke={2.6} />
                              </button>
                            ) : (
                              <span />
                            )}
                          </div>
                        );
                      })}
                      {!future && i === firstOpen(rows) && doneSets === 0 && (
                        <span className="xsmall muted">
                          {timed
                            ? 'Tap ▶ when you’re in position: the timer counts the hold, ticks it, and moves on. Held it without the timer? Tick it, or type the time you held (like 3:30) first.'
                            : 'Did it as planned? Tick it. Otherwise type what you did, then tick.'}
                        </span>
                      )}
                    </div>
                    {!future && (
                      <button type="button" className={`pain-toggle${pain[i] ? ' on' : ''}`} aria-pressed={!!pain[i]} onClick={() => setPain((p) => p.map((x, j) => (j === i ? !x : x)))}>
                        {pain[i] ? '⚠ This hurt (tap to undo)' : 'Sharp or pinching pain'}
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          );
        })}
      </div>
      {plan.finish && <span className="small muted">{plan.finish}</span>}

      {!future && (
        <>
          <span className="row-start small" style={{ gap: 14 }}>
            <label className="check-row small">
              <input
                type="checkbox"
                checked={handsFree}
                onChange={(e) => {
                  setHandsFree(e.target.checked);
                  writeFlag(HANDS_FREE, e.target.checked);
                }}
              />
              <span>Hands-free: start the next hold after {GET_IN} s</span>
            </label>
            <label className="check-row small">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  setSound(e.target.checked);
                  writeFlag(SOUND, e.target.checked);
                }}
              />
              <span>Sound</span>
            </label>
          </span>
          <SessionFiles session={session} title="Photos" accept="image/*" cta="Add a photo" hideEmpty />
          <label className="field">
            Note
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How deep, which side was tighter, the knee" />
          </label>
          <button className="btn primary" disabled={doneSets === 0} onClick={finish}>
            {session.status === 'planned' ? (doneSets >= totalSets ? 'Finish stretching' : `Finish: ${holdsDone} of ${plan.holds.length} holds`) : 'Save changes'}
          </button>
          {onGeneral && (
            <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={onGeneral}>
              {session.status === 'planned' ? 'Skip today, keep the minimum, or log it without the holds' : 'Change or clear this log'}
            </button>
          )}
        </>
      )}
      {session.status === 'planned' && moveDatesFor(view, session, today).length > 0 && (
        <div className="stack-sm">
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setMoving(!moving)}>
            {moving ? 'Cancel' : 'Move to another day'}
          </button>
          {moving && <MoveDayPicker session={session} onMoved={onClose} />}
        </div>
      )}
      <span className="xsmall muted">Stretching should feel strong, never sharp. Stop any stretch that causes sharp, pinching or nerve-like pain.</span>

      {timer && timing && timingSet && (
        <div className={`rest-bar stretch-timer phase-${timer.phase}${cue ? ` cue-${cue.kind}` : ''}`} role="timer" aria-live="off">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="xsmall muted stretch-timer-what">
              {timer.phase === 'hold'
                ? `${timing.name}${timingSet.label === 'Left' || timingSet.label === 'Right' ? ` · ${timingSet.label}` : sets[timer.hold]!.length > 1 ? ` · ${timingSet.label} of ${sets[timer.hold]!.length}` : ''}`
                : timer.phase === 'rest'
                  ? timingSet.label === 'Left' || timingSet.label === 'Right'
                    ? `Switch sides: ${timingSet.label} next`
                    : `Rest · set ${timingSet.label} next`
                  : `Next: ${timing.name}${timingSet.label === 'Left' ? ' · Left' : ''}`}
            </span>
            {timer.end == null ? (
              <b className="stretch-timer-cue">Get into position</b>
            ) : (
              <>
                <b className="num rest-time">{clockText(left)}</b>
                {cue && <span className={`stretch-timer-cue small cue-${cue.kind}`}>{cue.cue}</span>}
                {timer.phase === 'next' && <span className="stretch-timer-cue small">Get into position</span>}
              </>
            )}
          </span>
          {timer.end == null ? (
            <>
              <button type="button" className="btn small" onClick={() => setTimer(null)}>
                Close
              </button>
              <button type="button" className="btn small primary" onClick={() => start(timer.hold, timer.set)}>
                <Icon name="play" size={14} stroke={2.4} /> Start
              </button>
            </>
          ) : timer.phase === 'hold' ? (
            <>
              <button type="button" className="btn small" aria-label="15 seconds less" onClick={() => adjust(-15)}>
                −15s
              </button>
              <button type="button" className="btn small" aria-label="15 seconds more" onClick={() => adjust(15)}>
                +15s
              </button>
              <button type="button" className="btn small" onClick={() => (timer.paused != null ? resume() : pause())}>
                {timer.paused != null ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="btn small primary" onClick={doneEarly}>
                Done
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn small" onClick={() => setTimer(null)}>
                Stop
              </button>
              <button type="button" className="btn small primary" onClick={() => start(timer.hold, timer.set)}>
                Start now
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------- Editing the plan (on the task) ----------

/** The day's holds, one small card each: name, how long, contract-relax, knee, how-to, push and easy notes. */
export function StretchPlanEditor({ plan, onChange }: { plan: StretchPlan; onChange: (p: StretchPlan) => void }) {
  const edit = (i: number, patch: Partial<StretchHold>) => onChange({ ...plan, holds: plan.holds.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= plan.holds.length) return;
    const holds = [...plan.holds];
    [holds[i], holds[j]] = [holds[j]!, holds[i]!];
    onChange({ ...plan, holds });
  };
  const setsLine = (h: StretchHold) => {
    const s = holdSets(h);
    if (s.every((x) => x.seconds == null && x.reps == null)) return 'Not timed: write it like 3 min, 1.5 min each leg, 3 × 45 s or 2 × 8–10';
    return s.map((x) => `${x.label === '1' && s.length === 1 ? '' : `${x.label}: `}${x.seconds != null ? clockText(x.seconds) : `${x.reps} reps`}`).join(' · ');
  };
  return (
    <div className="stack-sm">
      <span className="xsmall muted">The day's holds, in order. On the day each set has a timer (or reps to tick).</span>
      <div className="plan-ex-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <label className="field">
          Day
          <select value={plan.day} onChange={(e) => onChange({ ...plan, day: e.target.value as 'push' | 'easy', intensity: e.target.value === 'push' ? '7–8 out of 10' : '5–6 out of 10' })}>
            <option value="push">Push (C-R)</option>
            <option value="easy">Easy (passive)</option>
          </select>
        </label>
        <label className="field">
          Intensity
          <input value={plan.intensity} onChange={(e) => onChange({ ...plan, intensity: e.target.value })} />
        </label>
        <label className="field">
          Focus
          <input value={plan.focus} onChange={(e) => onChange({ ...plan, focus: e.target.value })} placeholder="Hamstrings" />
        </label>
      </div>
      {plan.holds.map((h, i) => (
        <div key={i} className="card tight stack-sm">
          <div className="row-between" style={{ gap: 6 }}>
            <input value={h.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="Side Split" aria-label={`Hold ${i + 1} name`} style={{ flex: 1 }} />
            <DemoButton compact name={h.name} kind="stretch" demo={h.demo} steps={h.how ? [h.how] : undefined} onSave={(demo) => edit(i, { demo })} />
            <span className="row-start" style={{ gap: 2, flex: 'none' }}>
              <button type="button" className="link-btn xsmall" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="link-btn xsmall" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="link-btn xsmall" onClick={() => onChange({ ...plan, holds: plan.holds.filter((_, j) => j !== i) })} aria-label="Remove hold">✕</button>
            </span>
          </div>
          <div className="plan-ex-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <label className="field">
              How long
              <input value={h.dose} onChange={(e) => edit(i, { dose: e.target.value })} placeholder="3 min" />
            </label>
            <label className="field">
              Rest between
              <input value={h.rest ?? ''} onChange={(e) => edit(i, { rest: e.target.value })} placeholder="15 s" />
            </label>
            <label className="field">
              Part
              <select value={h.part} onChange={(e) => edit(i, { part: e.target.value as 'daily' | 'focus' })}>
                <option value="daily">Daily hold</option>
                <option value="focus">Focus slot</option>
              </select>
            </label>
          </div>
          <span className="xsmall muted">{setsLine(h)}</span>
          <span className="row-start small" style={{ gap: 14 }}>
            <label className="check-row small">
              <input type="checkbox" checked={!!h.cr} onChange={(e) => edit(i, { cr: e.target.checked })} />
              <span>Contract-relax on push days</span>
            </label>
            <label className="check-row small">
              <input type="checkbox" checked={!!h.knee} onChange={(e) => edit(i, { knee: e.target.checked })} />
              <span>Mind the knee</span>
            </label>
          </span>
          <textarea rows={2} value={h.how} onChange={(e) => edit(i, { how: e.target.value })} placeholder="How to get into it and what to feel" aria-label="How" />
          <input value={h.push ?? ''} onChange={(e) => edit(i, { push: e.target.value })} placeholder="Push day: (optional)" aria-label="Push day" />
          <input value={h.easy ?? ''} onChange={(e) => edit(i, { easy: e.target.value })} placeholder="Easy day: (optional)" aria-label="Easy day" />
        </div>
      ))}
      <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ ...plan, holds: [...plan.holds, blankHold(plan.holds.some((h) => h.part === 'focus') ? 'focus' : 'daily')] })}>
        + Add a hold
      </button>
      <label className="field">
        Last line <span style={{ fontWeight: 400 }}>(optional)</span>
        <input value={plan.finish ?? ''} onChange={(e) => onChange({ ...plan, finish: e.target.value })} placeholder="Finish with 30 s hugging both knees to your chest" />
      </label>
    </div>
  );
}
