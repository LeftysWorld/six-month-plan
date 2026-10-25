import { useEffect, useState } from 'react';
import { parseWorkoutPlan, repsText, restSeconds, setsText, suggestWeight, targetText, weekdayName, type DoneSet, type PlannedExercise, type Session, type WorkoutSet } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import { opsLogSession, opsRestoreSession, opsSaveWorkout, opsStartExtra } from '../data/ops.ts';
import type { AppData, Op } from '../data/model.ts';
import { Icon, Sheet, useToast } from './ui.tsx';

/**
 * The workout task type: a plan of exercises (sets, reps, target weight) on the task, and a log
 * that opens with that plan filled in so you only type what you actually did.
 */

export const blankExercise = (): PlannedExercise => ({ name: '', sets: 3, reps_min: 8, reps_max: 12, weight: null, weight_note: '', rest: '', note: '' });

// ---------- Editing the plan (on the task) ----------

/** The plan's exercises, one small card each: name, sets, rep range, weight, rest, note. */
export function WorkoutPlanEditor({ plan, details, unit, onChange }: { plan: PlannedExercise[]; details: string; unit: string; onChange: (p: PlannedExercise[]) => void }) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const fromDetails = details.trim() ? parseWorkoutPlan(details) : [];
  const edit = (i: number, patch: Partial<PlannedExercise>) => onChange(plan.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= plan.length) return;
    const next = [...plan];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

  return (
    <div className="stack-sm">
      <div className="row-between">
        <span className="xsmall muted">The plan: what each workout day logs against</span>
        <button type="button" className="link-btn xsmall" onClick={() => setPasting(!pasting)}>
          {pasting ? 'Cancel' : 'Paste a plan'}
        </button>
      </div>
      {pasting && (
        <div className="stack-sm">
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'One exercise a line, like:\nFlat DB Bench Press: 3×8–12 @ 50 lb · rest 2 min\nLat Pulldown: 4×8–12 @ 100 lb'} />
          <button
            type="button"
            className="btn small"
            disabled={!parseWorkoutPlan(text).length}
            onClick={() => {
              onChange(parseWorkoutPlan(text));
              setPasting(false);
              setText('');
            }}
          >
            Use these {parseWorkoutPlan(text).length || ''} exercises
          </button>
        </div>
      )}
      {plan.length === 0 && !pasting && fromDetails.length > 0 && (
        <button type="button" className="btn small" onClick={() => onChange(fromDetails)}>
          Fill from details ({fromDetails.length} exercises)
        </button>
      )}
      {plan.map((e, i) => (
        <div key={i} className="card tight stack-sm plan-ex">
          <div className="row-start" style={{ flexWrap: 'nowrap', gap: 6 }}>
            <span className="plan-ex-no">{i + 1}</span>
            <input className="input" aria-label={`Exercise ${i + 1} name`} value={e.name} placeholder="Exercise" onChange={(x) => edit(i, { name: x.target.value })} />
            <button type="button" className="link-btn xsmall" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="link-btn xsmall" aria-label="Move down" disabled={i === plan.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button type="button" className="link-btn xsmall" aria-label={`Remove ${e.name || 'exercise'}`} onClick={() => onChange(plan.filter((_, j) => j !== i))}>
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="plan-ex-grid">
            <label className="field">
              Sets
              <input type="number" inputMode="numeric" min={1} value={e.sets} onChange={(x) => edit(i, { sets: Number(x.target.value) })} />
            </label>
            <label className="field">
              Reps from
              <input type="number" inputMode="numeric" min={1} value={e.reps_min} onChange={(x) => edit(i, { reps_min: Number(x.target.value) })} />
            </label>
            <label className="field">
              to
              <input type="number" inputMode="numeric" min={1} value={e.reps_max} onChange={(x) => edit(i, { reps_max: Number(x.target.value) })} />
            </label>
            <label className="field">
              Weight ({unit})
              <input type="number" inputMode="decimal" step="any" value={e.weight ?? ''} placeholder={e.weight_note || '—'} onChange={(x) => edit(i, { weight: numOrNull(x.target.value) })} />
            </label>
          </div>
          <div className="plan-ex-grid two">
            <label className="field">
              Rest
              <input value={e.rest} placeholder="e.g. 90 s" onChange={(x) => edit(i, { rest: x.target.value })} />
            </label>
            <label className="field">
              Note
              <input value={e.note} placeholder="e.g. full stretch" onChange={(x) => edit(i, { note: x.target.value })} />
            </label>
          </div>
          <label className="row-start xsmall muted" style={{ gap: 6 }}>
            <input type="checkbox" checked={!!e.per_side} onChange={(x) => edit(i, { per_side: x.target.checked })} />
            Reps are per side
          </label>
        </div>
      ))}
      <button type="button" className="btn small ghost" onClick={() => onChange([...plan, blankExercise()])}>
        <Icon name="plus" size={16} stroke={2.2} /> Add exercise
      </button>
    </div>
  );
}

// ---------- The plan (or what you did) on Today's card ----------

/** Before: the day's exercises and targets. After: what you actually did, exercise by exercise. */
export function WorkoutCardPlan({ session, plan }: { session: Session; plan: PlannedExercise[] }) {
  const { data } = useStore();
  const unit = data.profile.units;
  const sets = data.workoutSets.filter((w) => w.session_id === session.id && w.done);
  if (session.status !== 'planned' && sets.length) {
    const planned = plan.reduce((n, e) => n + e.sets, 0);
    const names = [...new Set([...plan.map((e) => e.name), ...sets.map((s) => s.exercise)])];
    return (
      <span className="workout-card-plan">
        <span className="workout-card-sum">
          {sets.length} of {planned} sets done
        </span>
        {names.map((n) => {
          const mine = sets.filter((s) => s.exercise.toLowerCase() === n.toLowerCase()).sort((a, b) => a.set_no - b.set_no);
          return (
            <span key={n} className="workout-card-ex">
              <span className="workout-card-name">{n}</span>
              <span className="num">{mine.length ? setsText(mine) : 'skipped'}</span>
            </span>
          );
        })}
      </span>
    );
  }
  if (session.status !== 'planned') return null;
  return (
    <span className="workout-card-plan">
      {plan.map((e, i) => (
        <span key={i} className="workout-card-ex">
          <span className="workout-card-name">{e.name}</span>
          <span className="num">{targetText(e, unit).replace(' @ ', ' · ')}</span>
        </span>
      ))}
    </span>
  );
}

// ---------- Logging a workout ----------

interface Row {
  /** What you typed; empty means the grey planned value. */
  weight: string;
  reps: string;
  done: boolean;
}

/** The sets of this task's last logged workout before `session`, by exercise. */
function lastTime(data: AppData, session: Session): Map<string, DoneSet[]> {
  const earlier = data.sessions
    .filter((s) => s.action_id === session.action_id && s.id !== session.id && s.status !== 'planned' && s.status !== 'skipped' && (s.date ?? s.week_start) <= (session.date ?? session.week_start))
    .sort((a, b) => ((a.date ?? a.week_start) < (b.date ?? b.week_start) ? 1 : -1));
  for (const s of earlier) {
    const sets = data.workoutSets.filter((w) => w.session_id === s.id);
    if (!sets.length) continue;
    const by = new Map<string, DoneSet[]>();
    for (const w of [...sets].sort((a, b) => a.set_no - b.set_no)) by.set(w.exercise.toLowerCase(), [...(by.get(w.exercise.toLowerCase()) ?? []), w]);
    return by;
  }
  return new Map();
}

const draftKey = (sessionId: string) => `six.workout.${sessionId}`;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/**
 * The workout log, laid out like the gym apps people stick with: one exercise open at a time,
 * a row per set (set · previous · weight · reps · ✓). The plan's weight and reps sit in each row
 * in grey, so ticking a set you did as planned is one tap; type over them when you did something
 * else, or tap Previous to copy last time. Ticking a set starts the exercise's rest timer. A
 * finished exercise folds to what you actually did. Progress is kept on this device until you
 * finish, so a locked phone loses nothing.
 */
export function WorkoutSheet({ session, plan, onClose, onMore }: { session: Session; plan: PlannedExercise[]; onClose: () => void; onMore: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const action = view.action(session.action_id);
  const unit = data.profile.units;
  const day = session.date ?? today;
  const future = day > today;
  const last = lastTime(data, session);
  const saved = data.workoutSets.filter((w) => w.session_id === session.id);
  const suggestions = plan.map((e) => suggestWeight(e, last.get(e.name.toLowerCase()) ?? null));
  const planWeight = (i: number) => suggestions[i]!.weight;

  const [rows, setRows] = useState<Row[][]>(() => {
    try {
      const draft = localStorage.getItem(draftKey(session.id));
      const parsed = draft ? (JSON.parse(draft) as Row[][]) : null;
      // A draft only fits if the plan still has the same exercises and sets.
      if (parsed && parsed.length === plan.length && parsed.every((r, i) => r.length >= plan[i]!.sets)) return parsed;
    } catch {
      // no draft
    }
    return plan.map((e) =>
      // Extra sets you added last time you saved come back too.
      Array.from({ length: Math.max(e.sets, ...saved.filter((w) => w.exercise.toLowerCase() === e.name.toLowerCase()).map((w) => w.set_no)) }, (_, k) => {
        const s = saved.find((w) => w.exercise.toLowerCase() === e.name.toLowerCase() && w.set_no === k + 1);
        return s ? { weight: s.weight == null ? '' : String(s.weight), reps: s.reps == null ? '' : String(s.reps), done: s.done } : { weight: '', reps: '', done: false };
      }),
    );
  });
  const firstOpen = (r: Row[][]) => r.findIndex((sets) => sets.some((x) => !x.done));
  const [open, setOpen] = useState<number>(() => Math.max(0, firstOpen(rows)));
  const [note, setNote] = useState(session.note);
  const [restEnd, setRestEnd] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (future) return;
    try {
      localStorage.setItem(draftKey(session.id), JSON.stringify(rows));
    } catch {
      // storage blocked: the draft just isn't kept
    }
  }, [rows, future, session.id]);

  // The rest timer counts to a time (not by ticks), so it stays right after the phone sleeps.
  useEffect(() => {
    if (restEnd == null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= restEnd) {
        setRestEnd(null);
        navigator.vibrate?.([200, 100, 200]);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [restEnd]);
  const restLeft = restEnd == null ? 0 : Math.max(0, Math.ceil((restEnd - now) / 1000));

  const setRow = (i: number, k: number, patch: Partial<Row>) => setRows((all) => all.map((r, a) => (a === i ? r.map((x, b) => (b === k ? { ...x, ...patch } : x)) : r)));
  /** A set's weight and reps as logged: what you typed, or the grey planned value. */
  const actual = (i: number, k: number) => {
    const r = rows[i]![k]!;
    const w = r.weight.trim() === '' ? planWeight(i) : Number(r.weight);
    const reps = r.reps.trim() === '' ? plan[i]!.reps_max : Number(r.reps);
    return { weight: w != null && Number.isFinite(w) ? w : null, reps: Number.isFinite(reps) ? reps : null };
  };
  const tick = (i: number, k: number) => {
    const r = rows[i]![k]!;
    if (r.done) {
      setRow(i, k, { done: false });
      return;
    }
    const a = actual(i, k);
    const next = rows.map((sets, x) => (x === i ? sets.map((y, z) => (z === k ? { weight: a.weight == null ? '' : String(a.weight), reps: a.reps == null ? '' : String(a.reps), done: true } : y)) : sets));
    setRows(next);
    const secs = restSeconds(plan[i]!.rest);
    const exerciseDone = next[i]!.every((y) => y.done);
    if (exerciseDone) {
      // Fold the finished exercise to what you did, and open the next one with sets left.
      setOpen(firstOpen(next));
    }
    const allDone = next.every((sets) => sets.every((y) => y.done));
    if (secs && !allDone) {
      setNow(Date.now());
      setRestEnd(Date.now() + secs * 1000);
    }
  };
  const copyPrevious = (i: number, k: number) => {
    const p = last.get(plan[i]!.name.toLowerCase())?.[k];
    if (p) setRow(i, k, { weight: p.weight == null ? '' : String(p.weight), reps: p.reps == null ? '' : String(p.reps) });
  };
  /** One more set on an exercise, starting from the weight of its last set. */
  const addSet = (i: number) => setRows((all) => all.map((r, a) => (a === i ? [...r, { weight: r.at(-1)?.weight ?? '', reps: '', done: false }] : r)));
  const removeSet = (i: number, k: number) => setRows((all) => all.map((r, a) => (a === i ? r.filter((_, b) => b !== k) : r)));
  const [another, setAnother] = useState(false);
  const workouts = data.actions.filter((a) => !a.archived_at && a.kind === 'workout' && a.workout_plan?.length);
  const doneCount = rows.flat().filter((r) => r.done).length;
  const total = rows.flat().length;

  function finish() {
    const before = session;
    const sets: Omit<WorkoutSet, 'id' | 'session_id'>[] = plan.flatMap((e, i) =>
      rows[i]!.map((r, k) => ({ exercise: e.name, set_no: k + 1, ...actual(i, k), done: r.done })).filter((s, k) => s.done || rows[i]![k]!.reps.trim() !== ''),
    );
    const status = doneCount >= total ? 'done' : 'partial';
    const saveOps = opsSaveWorkout(data, session.id, sets);
    const added = saveOps.flatMap((o) => (o.kind === 'insert' ? o.rows.map((r) => r.id) : []));
    const undoSets: Op[] = [
      ...added.map((id): Op => ({ kind: 'delete', collection: 'workoutSets', id })),
      ...(saved.length ? [{ kind: 'insert', collection: 'workoutSets', rows: saved as unknown as ({ id: string } & Record<string, unknown>)[] } as Op] : []),
    ];
    commit([...saveOps, ...opsLogSession(session, { status, note, on: today })]);
    try {
      localStorage.removeItem(draftKey(session.id));
    } catch {
      // nothing to clear
    }
    toast(`${session.title}: ${doneCount} of ${total} sets`, () => commit([...undoSets, ...opsRestoreSession(before)]));
    onClose();
  }

  return (
    <Sheet title={session.title} onClose={onClose}>
      <div className="stack-sm" style={{ marginTop: -8, gap: 8 }}>
        <div className="row-between small muted">
          <span>
            {future ? `${plan.length} exercises · ${total} sets` : `${doneCount} of ${total} sets`}
            {session.planned_minutes ? ` · about ${session.planned_minutes} min` : ''}
          </span>
          {!future && doneCount > 0 && (
            <button type="button" className="btn small primary" onClick={finish}>
              {session.status === 'planned' ? 'Finish' : 'Save'}
            </button>
          )}
        </div>
        {!future && (
          <span className="workout-progress" aria-hidden="true">
            <i style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
          </span>
        )}
      </div>
      {future && <div className="banner info">This is {weekdayName(day)}’s plan. On {weekdayName(day)}, open it from Today to tick off each set and enter your actual weight and reps.</div>}
      {action?.details?.trim() && (
        <details className="task-details">
          <summary>Warm-up and notes</summary>
          <div className="task-details-body">{action.details}</div>
        </details>
      )}
      <div className="stack-sm" style={{ gap: 8 }}>
        {plan.map((e, i) => {
          const prev = last.get(e.name.toLowerCase());
          const sug = suggestions[i]!;
          const mine = rows[i]!;
          const done = mine.filter((r) => r.done).length;
          const finished = done >= mine.length;
          const isOpen = open === i;
          const did = mine.map((r, k) => ({ ...actual(i, k), done: r.done })).filter((s) => s.done);
          return (
            <section key={i} className={`workout-ex${isOpen ? ' open' : ''}`} aria-label={e.name}>
              <button type="button" className="workout-ex-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
                <span className={`workout-ex-badge${finished ? ' done' : ''}`}>{finished ? <Icon name="check" size={13} stroke={3} /> : i + 1}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="workout-ex-name">{e.name}</b>
                  {did.length > 0 && !isOpen ? (
                    <span className="workout-did">
                      {did.map((s, k) => (
                        <span key={k} className={`workout-chip${(s.reps ?? 0) < e.reps_min ? ' short' : ''}`}>
                          {s.weight == null ? 'BW' : fmt(s.weight)} × {s.reps ?? '?'}
                        </span>
                      ))}
                      {done < mine.length && <span className="xsmall muted">{mine.length - done} not done</span>}
                    </span>
                  ) : (
                    <span className="xsmall muted num">
                      {targetText({ ...e, weight: sug.weight }, unit)}
                      {e.rest ? ` · rest ${e.rest}` : ''}
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
                  {sug.why === 'up' && !future && (
                    <span className="workout-up">
                      ↑ Up to {fmt(sug.weight!)} {unit}: you hit {e.reps_max} on every set last time
                    </span>
                  )}
                  {e.note && <span className="xsmall muted">{e.note}</span>}
                  {future && <span className="xsmall muted">The plan for each set. You can enter what you actually did on {weekdayName(day)}.</span>}
                  {(
                    <div className={`workout-sets${future ? ' preview' : ''}`} role="table" aria-label={`${e.name} sets`}>
                      <span className="workout-set head xsmall muted" role="row">
                        <span>Set</span>
                        <span>Previous</span>
                        <span>{unit}</span>
                        <span>Reps</span>
                        <span />
                      </span>
                      {mine.map((r, k) => {
                        const p = prev?.[k];
                        return (
                          <div key={k} className={`workout-set${r.done ? ' done' : ''}`} role="row">
                            <span className="num small">{k + 1}</span>
                            <button type="button" className="workout-prev num" disabled={!p || future} onClick={() => copyPrevious(i, k)} aria-label={p ? `Copy last time: ${p.weight ?? 'bodyweight'} by ${p.reps}` : 'No previous set'}>
                              {p ? `${p.weight == null ? 'BW' : fmt(p.weight)} × ${p.reps ?? '?'}` : '—'}
                            </button>
                            <input
                              className="input"
                              type="number"
                              inputMode="decimal"
                              step="any"
                              aria-label={`${e.name} set ${k + 1} weight`}
                              disabled={future}
                              placeholder={planWeight(i) != null ? fmt(planWeight(i)!) : /body/i.test(e.weight_note) ? 'BW' : '—'}
                              value={r.weight}
                              onChange={(x) => setRow(i, k, { weight: x.target.value })}
                            />
                            <input
                              className="input"
                              type="number"
                              inputMode="numeric"
                              aria-label={`${e.name} set ${k + 1} reps (${repsText(e)})`}
                              disabled={future}
                              placeholder={String(e.reps_max)}
                              value={r.reps}
                              onChange={(x) => setRow(i, k, { reps: x.target.value })}
                            />
                            <button type="button" className={`set-tick${r.done ? ' on' : ''}`} aria-pressed={r.done} aria-label={`Set ${k + 1} done`} disabled={future} onClick={() => tick(i, k)}>
                              <Icon name="check" size={16} stroke={2.6} />
                            </button>
                            {k >= e.sets && !r.done && (
                              <button type="button" className="link-btn xsmall workout-remove-set" onClick={() => removeSet(i, k)} aria-label={`Remove set ${k + 1}`}>
                                Remove extra set
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {!future && (
                        <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => addSet(i)}>
                          + Add set
                        </button>
                      )}
                      {!future && i === firstOpen(rows) && doneCount === 0 && (
                        <span className="xsmall muted">Grey numbers are the plan ({repsText(e)} reps). Tick to log them as is, or type what you did first.</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!future && (
        <>
          <label className="field">
            Note
            <textarea rows={2} value={note} onChange={(x) => setNote(x.target.value)} placeholder="How it felt, the knee, anything to change" />
          </label>
          <button className="btn primary" disabled={doneCount === 0} onClick={finish}>
            {session.status === 'planned' ? (doneCount >= total ? 'Finish workout' : `Finish: ${doneCount} of ${total} sets`) : 'Save changes'}
          </button>
        </>
      )}
      <button type="button" className="link-btn small" onClick={onMore}>
        Skip, move to another day, or add a photo
      </button>
      {day === today && workouts.length > 0 && (
        <div className="stack-sm">
          <button type="button" className="link-btn small" onClick={() => setAnother(!another)}>
            {another ? 'Cancel' : 'Do another workout today'}
          </button>
          {another && (
            <div className="chips" role="group" aria-label="Pick a workout">
              {workouts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    commit(opsStartExtra(data, a, today).ops);
                    toast(`${a.title} added to today as an extra`);
                    onClose();
                  }}
                >
                  {a.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {restEnd != null && (
        <div className="rest-bar" role="timer" aria-live="off">
          <span className="grow">
            <span className="xsmall muted">Rest</span>
            <b className="num rest-time">{clock(restLeft)}</b>
          </span>
          <button type="button" className="btn small" onClick={() => setRestEnd((t) => (t == null ? t : Math.max(Date.now(), t - 15000)))}>
            −15s
          </button>
          <button type="button" className="btn small" onClick={() => setRestEnd((t) => (t == null ? t : t + 15000))}>
            +15s
          </button>
          <button type="button" className="btn small" onClick={() => setRestEnd(null)}>
            Skip
          </button>
        </div>
      )}
    </Sheet>
  );
}
