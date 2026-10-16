import { useEffect, useMemo, useState } from 'react';
import type { WorkoutSet } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsLogSession, opsSaveWorkout } from '../data/ops.ts';
import { navigate } from '../router.ts';
import { BackLink, Empty, Icon, useToast } from '../components/ui.tsx';

interface SetDraft {
  weight: number | null;
  reps: number | null;
  done: boolean;
}

interface ExerciseDraft {
  name: string;
  sets: SetDraft[];
}

function useElapsed(key: string): number {
  const [start] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    if (saved) return saved;
    const now = Date.now();
    localStorage.setItem(key, String(now));
    return now;
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - start) / 1000));
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function WorkoutLog({ id }: { id: string }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const session = data.sessions.find((s) => s.id === id);
  const timerKey = `six.timer.${id}`;
  const elapsed = useElapsed(timerKey);

  // The most recent earlier workout of the same action that has sets: the "program".
  const previous = useMemo(() => {
    if (!session) return [] as WorkoutSet[];
    const earlier = data.sessions
      .filter((s) => s.action_id === session.action_id && s.id !== session.id && s.date && session.date && s.date < session.date)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1));
    for (const s of earlier) {
      const sets = data.workoutSets.filter((w) => w.session_id === s.id);
      if (sets.length) return sets;
    }
    return [] as WorkoutSet[];
  }, [data.sessions, data.workoutSets, session]);

  const lastFor = (exercise: string) => {
    const sets = previous.filter((w) => w.exercise === exercise).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const top = sets[0];
    return top ? `${top.weight ?? '–'} × ${top.reps ?? '–'}` : null;
  };

  const [exercises, setExercises] = useState<ExerciseDraft[]>(() => {
    if (!session) return [];
    const mine = data.workoutSets.filter((w) => w.session_id === session.id);
    const source = mine.length ? mine : [];
    return group(source, !!mine.length);
  });
  const [newName, setNewName] = useState('');

  if (!session) return <Empty title="This workout isn't here anymore." />;
  const goal = view.goalsForAction(session.action_id)[0];

  function copyLast() {
    setExercises(group(previous, false));
  }

  function save(status: 'done' | 'partial') {
    if (!session) return;
    const sets = exercises.flatMap((ex) =>
      ex.sets.map((s, i) => ({ exercise: ex.name, set_no: i + 1, weight: s.weight, reps: s.reps, done: s.done })),
    );
    commit([
      ...opsSaveWorkout(data, session.id, sets),
      ...opsLogSession(session, { status, actual_minutes: Math.max(1, Math.round(elapsed / 60)) }),
    ]);
    localStorage.removeItem(timerKey);
    toast(status === 'done' ? 'Workout finished' : 'Saved as partial');
    navigate('/today');
  }

  const update = (ei: number, si: number, patch: Partial<SetDraft>) =>
    setExercises(exercises.map((ex, i) => (i !== ei ? ex : { ...ex, sets: ex.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) })));

  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label="Today" fallback="/today" />
        <span className="pill on_track num" style={{ fontSize: 15, padding: '6px 12px' }} aria-label="Elapsed time">
          {clock(elapsed)}
        </span>
      </div>
      <div>
        <h1>{session.title}</h1>
        {goal && (
          <div className="small muted row-start" style={{ marginTop: 4 }}>
            <span className="dot" style={{ background: goal.color }} />
            {goal.title}
          </div>
        )}
      </div>

      {exercises.length === 0 && previous.length > 0 && (
        <button className="btn" onClick={copyLast}>
          Start from last workout ({[...new Set(previous.map((p) => p.exercise))].length} exercises)
        </button>
      )}

      {exercises.map((ex, ei) => (
        <div key={ei} className="card stack-sm">
          <div className="row-between">
            <b>{ex.name}</b>
            <span className="xsmall muted">{lastFor(ex.name) ? `Last: ${lastFor(ex.name)}` : 'New exercise'}</span>
          </div>
          <div className="grid-3 xsmall muted" style={{ gridTemplateColumns: '40px minmax(0,1fr) minmax(0,1fr) 44px' }}>
            <span>Set</span>
            <span>Weight</span>
            <span>Reps</span>
            <span />
          </div>
          {ex.sets.map((s, si) => (
            <div key={si} className="grid-3" style={{ gridTemplateColumns: '40px minmax(0,1fr) minmax(0,1fr) 44px', alignItems: 'center' }}>
              <span className="small muted">{si + 1}</span>
              <input className="input" aria-label={`${ex.name} set ${si + 1} weight`} inputMode="decimal" type="number" value={s.weight ?? ''} onChange={(e) => update(ei, si, { weight: e.target.value === '' ? null : Number(e.target.value) })} />
              <input className="input" aria-label={`${ex.name} set ${si + 1} reps`} inputMode="numeric" type="number" value={s.reps ?? ''} onChange={(e) => update(ei, si, { reps: e.target.value === '' ? null : Number(e.target.value) })} />
              <button
                aria-label={`${ex.name} set ${si + 1} ${s.done ? 'done' : 'not done'}`}
                aria-pressed={s.done}
                onClick={() => update(ei, si, { done: !s.done })}
                style={{ width: 44, height: 44, borderRadius: 10, border: `1.5px solid ${s.done ? 'var(--accent)' : '#9AA49E'}`, background: s.done ? 'var(--accent)' : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                {s.done && <Icon name="check" size={16} stroke={3} />}
              </button>
            </div>
          ))}
          <button
            className="link-btn small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setExercises(exercises.map((x, i) => (i === ei ? { ...x, sets: [...x.sets, { ...(x.sets.at(-1) ?? { weight: null, reps: null }), done: false }] } : x)))}
          >
            + Add set
          </button>
        </div>
      ))}

      <form
        className="row-start"
        style={{ flexWrap: 'nowrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          setExercises([...exercises, { name: newName.trim(), sets: [{ weight: null, reps: null, done: false }] }]);
          setNewName('');
        }}
      >
        <input className="input" placeholder="Add an exercise, e.g. Bench press" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New exercise name" />
        <button className="btn small" type="submit" style={{ minHeight: 44 }}>
          Add
        </button>
      </form>

      <div className="btn-row">
        <button className="btn" onClick={() => save('partial')}>
          Save as partial
        </button>
        <button className="btn primary" onClick={() => save('done')}>
          Finish workout
        </button>
      </div>
    </div>
  );
}

function group(sets: WorkoutSet[], keepValues: boolean): ExerciseDraft[] {
  const out: ExerciseDraft[] = [];
  for (const s of [...sets].sort((a, b) => a.set_no - b.set_no)) {
    let ex = out.find((e) => e.name === s.exercise);
    if (!ex) {
      ex = { name: s.exercise, sets: [] };
      out.push(ex);
    }
    ex.sets.push({ weight: s.weight, reps: s.reps, done: keepValues ? s.done : false });
  }
  return out;
}
