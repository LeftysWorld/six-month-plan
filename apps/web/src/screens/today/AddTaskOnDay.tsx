import { useState } from 'react';
import { weekdayName, type PlannedExercise } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { useView } from '../../data/useView.ts';
import { opsStartExtra } from '../../data/ops.ts';
import { opsAddOnDate } from '../../data/calendar.ts';
import { Icon, useToast } from '../../components/ui.tsx';
import { WorkoutPlanEditor } from '../../components/Workout.tsx';

/**
 * "+ Add a task" on Today (or any other day): something to do that day. Two kinds, each with its
 * own options:
 * - General: a title, a goal or none, and about how long. With no goal it's a one-off; it can be
 *   linked to a goal later from its log sheet.
 * - Workout: do one of your workouts again that day, or make a new one with its exercises (sets,
 *   reps, weight), for a goal or none. It logs like any workout.
 */
export function AddTaskOnDay({ day, label }: { day: string; label: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'general' | 'workout'>('general');
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [goalId, setGoalId] = useState('');
  const [plan, setPlan] = useState<PlannedExercise[]>([]);
  const [details, setDetails] = useState('');
  const goals = view.activeGoals;
  const workouts = data.actions.filter((a) => !a.archived_at && a.kind === 'workout' && a.workout_plan?.length);
  const onDay = day === today ? 'today' : weekdayName(day);
  const reset = () => {
    setTitle('');
    setGoalId('');
    setPlan([]);
    setDetails('');
    setMinutes(15);
    setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} stroke={2.2} /> {label}
      </button>
    );
  }
  const workoutOk = kind !== 'workout' || plan.some((e) => e.name.trim());
  const goalPicker = (
    <select className="input" aria-label="Goal" value={goalId} onChange={(e) => setGoalId(e.target.value)} style={{ minWidth: 0 }}>
      <option value="">No goal</option>
      {goals.map((g) => (
        <option key={g.id} value={g.id}>
          For {g.title}
        </option>
      ))}
    </select>
  );
  const minutesField = (
    <label className="row-start small muted" style={{ gap: 6, flex: 'none', flexWrap: 'nowrap' }}>
      <input className="input" type="number" min={0} step={5} aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))} style={{ width: 72 }} />
      min
    </label>
  );
  return (
    <form
      className="card stack-sm add-task-today"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !workoutOk) return;
        commit(opsAddOnDate(data, { title, date: day, goalId: goalId || null, minutes, ...(kind === 'workout' ? { workout: { plan, details } } : {}) }, today));
        const g = goalId ? view.goal(goalId) : undefined;
        toast(`${title.trim()} added to ${onDay}${g ? ` for ${g.title}` : ''}`);
        reset();
      }}
    >
      <div className="row-between">
        <span className="label">{label}</span>
        <div className="seg" role="tablist" aria-label="Kind of task">
          <button type="button" role="tab" aria-selected={kind === 'general'} onClick={() => setKind('general')}>
            General
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'workout'}
            onClick={() => {
              setKind('workout');
              if (!minutes || minutes === 15) setMinutes(45);
            }}
          >
            Workout
          </button>
        </div>
      </div>

      {kind === 'general' ? (
        <>
          <input className="input" autoFocus aria-label="Task" placeholder="e.g. Call the bank, Pick up dry cleaning" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="row-start" style={{ flexWrap: 'nowrap', gap: 8 }}>
            {goalPicker}
            {minutesField}
          </div>
          <span className="xsmall muted">{goalId ? 'Counts for the goal and shows on its page.' : 'You can link it to a goal later: tap it, then Link to a goal.'}</span>
        </>
      ) : (
        <>
          {workouts.length > 0 && (
            <div className="stack-sm">
              <span className="xsmall muted">Do one of your workouts {onDay === 'today' ? 'today' : `on ${onDay}`}</span>
              <div className="chips" role="group" aria-label="Your workouts">
                {workouts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="chip"
                    onClick={() => {
                      commit(opsStartExtra(data, a, day).ops);
                      toast(`${a.title} added to ${onDay}`);
                      reset();
                    }}
                  >
                    {a.title}
                  </button>
                ))}
              </div>
              <span className="xsmall muted">Or a new workout:</span>
            </div>
          )}
          <input className="input" autoFocus aria-label="Workout name" placeholder="e.g. Upper body, Leg day" value={title} onChange={(e) => setTitle(e.target.value)} />
          <WorkoutPlanEditor plan={plan} details={details} unit={data.profile.units} onChange={setPlan} />
          <div className="row-start" style={{ flexWrap: 'nowrap', gap: 8 }}>
            {goalPicker}
            {minutesField}
          </div>
          <span className="xsmall muted">Logs like your other workouts: sets, reps and weight for each exercise.</span>
        </>
      )}
      <div className="btn-row">
        <button className="btn primary" type="submit" disabled={!title.trim() || !workoutOk}>
          {kind === 'workout' ? 'Add workout' : 'Add'}
        </button>
        <button type="button" className="btn" onClick={reset}>
          Cancel
        </button>
      </div>
    </form>
  );
}
