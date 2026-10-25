import { useEffect, useState } from 'react';
import { parseWorkoutPlan, repsText, suggestWeight, targetText, weekdayName, type DoneSet, type PlannedExercise, type Session, type WorkoutSet } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import { opsLogSession, opsRestoreSession, opsSaveWorkout } from '../data/ops.ts';
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

// ---------- The plan on Today's card ----------

/** The day's exercises on the Today card, and once logged, how many sets got done. */
export function WorkoutCardPlan({ session, plan }: { session: Session; plan: PlannedExercise[] }) {
  const { data } = useStore();
  const unit = data.profile.units;
  const sets = data.workoutSets.filter((w) => w.session_id === session.id);
  if (session.status !== 'planned' && sets.length) {
    const planned = plan.reduce((n, e) => n + e.sets, 0);
    const done = sets.filter((s) => s.done).length;
    return <span className="workout-card-sum">{done} of {planned} sets done</span>;
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

/**
 * The workout log: every exercise of the plan with a row per set. Weight starts at the plan's (or
 * last time's, plus 5 once you hit the top of the range on every set); you type the reps and tick
 * the set. Progress is kept on this device until you finish, so a locked phone loses nothing.
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

  const [rows, setRows] = useState<Row[][]>(() => {
    try {
      const draft = localStorage.getItem(draftKey(session.id));
      const parsed = draft ? (JSON.parse(draft) as Row[][]) : null;
      // A draft only fits if the plan still has the same exercises and sets.
      if (parsed && parsed.length === plan.length && parsed.every((r, i) => r.length === plan[i]!.sets)) return parsed;
    } catch {
      // no draft
    }
    return plan.map((e, i) =>
      Array.from({ length: e.sets }, (_, k) => {
        const s = saved.find((w) => w.exercise.toLowerCase() === e.name.toLowerCase() && w.set_no === k + 1);
        if (s) return { weight: s.weight == null ? '' : String(s.weight), reps: s.reps == null ? '' : String(s.reps), done: s.done };
        const w = suggestions[i]!.weight;
        return { weight: w == null ? '' : String(w), reps: '', done: false };
      }),
    );
  });
  const [note, setNote] = useState(session.note);

  useEffect(() => {
    if (future) return;
    try {
      localStorage.setItem(draftKey(session.id), JSON.stringify(rows));
    } catch {
      // storage blocked: the draft just isn't kept
    }
  }, [rows, future, session.id]);

  const setRow = (i: number, k: number, patch: Partial<Row>) => setRows(rows.map((r, a) => (a === i ? r.map((x, b) => (b === k ? { ...x, ...patch } : x)) : r)));
  const tick = (i: number, k: number) => {
    const r = rows[i]![k]!;
    // Ticking a set with no reps typed counts the top of the range: change it if you did fewer.
    setRow(i, k, { done: !r.done, reps: !r.done && r.reps.trim() === '' ? String(plan[i]!.reps_max) : r.reps });
  };
  const doneCount = rows.flat().filter((r) => r.done).length;
  const total = rows.flat().length;

  function finish() {
    const before = session;
    const sets: Omit<WorkoutSet, 'id' | 'session_id'>[] = plan.flatMap((e, i) =>
      rows[i]!.map((r, k) => ({ exercise: e.name, set_no: k + 1, weight: r.weight.trim() === '' ? null : Number(r.weight), reps: r.reps.trim() === '' ? null : Number(r.reps), done: r.done })).filter((s) => s.done || s.reps != null),
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
      <div className="row-between small muted" style={{ marginTop: -8 }}>
        <span>
          {plan.length} exercises · {total} sets{session.planned_minutes ? ` · about ${session.planned_minutes} min` : ''}
        </span>
        {!future && <span className="num">{doneCount}/{total}</span>}
      </div>
      {future && <div className="banner info">This is the plan for {weekdayName(day)}. You can log it on the day.</div>}
      {action?.details?.trim() && (
        <details className="task-details">
          <summary>Warm-up and notes</summary>
          <div className="task-details-body">{action.details}</div>
        </details>
      )}
      {plan.map((e, i) => {
        const prev = last.get(e.name.toLowerCase());
        const sug = suggestions[i]!;
        return (
          <section key={i} className="workout-ex" aria-label={e.name}>
            <div className="workout-ex-head">
              <b>{e.name}</b>
              <span className="small muted num">
                {targetText(e, unit)}
                {e.rest ? ` · rest ${e.rest}` : ''}
              </span>
              {e.note && <span className="xsmall muted">{e.note}</span>}
              {prev && (
                <span className="xsmall muted">
                  Last time: {prev.filter((s) => s.done).map((s) => `${s.weight != null ? fmt(s.weight) : 'BW'}×${s.reps ?? '?'}`).join(', ') || 'not done'}
                </span>
              )}
              {sug.why === 'up' && !future && (
                <span className="xsmall" style={{ color: 'var(--accent-ink)' }}>
                  ↑ {fmt(sug.weight!)} {unit}: you hit {e.reps_max} on every set last time
                </span>
              )}
            </div>
            {!future && (
              <div className="workout-sets">
                <span className="workout-sets-head xsmall muted">
                  <span>Set</span>
                  <span>{unit}</span>
                  <span>Reps ({repsText(e)})</span>
                  <span />
                </span>
                {rows[i]!.map((r, k) => (
                  <div key={k} className={`workout-set${r.done ? ' done' : ''}`}>
                    <span className="num small">{k + 1}</span>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      aria-label={`${e.name} set ${k + 1} weight`}
                      placeholder={e.weight_note || '—'}
                      value={r.weight}
                      onChange={(x) => setRow(i, k, { weight: x.target.value })}
                    />
                    <input
                      className="input"
                      type="number"
                      inputMode="numeric"
                      aria-label={`${e.name} set ${k + 1} reps`}
                      placeholder={String(e.reps_max)}
                      value={r.reps}
                      onChange={(x) => setRow(i, k, { reps: x.target.value })}
                    />
                    <button type="button" className={`set-tick${r.done ? ' on' : ''}`} aria-pressed={r.done} aria-label={`Set ${k + 1} done`} onClick={() => tick(i, k)}>
                      <Icon name="check" size={16} stroke={2.6} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
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
    </Sheet>
  );
}
