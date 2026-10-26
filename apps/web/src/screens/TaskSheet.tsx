import { useState } from 'react';
import { addDays, describeSchedule, isoWeekday, rangeLabel, shortDate, weekDates, weekdayName, parseWorkoutPlan, type ActionKind, type Goal, type ISODate, type Plan, type PlanStep } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { opsEnsureStep } from '../data/chain.ts';
import { applyFrom, blankTask, inputFromTask, isOnce, opsAddTask, opsEditTask, opsRemoveTask, withOps, type TaskInput, type WeekTask } from '../data/breakdown.ts';
import { matchingTasks, opsShareTask, opsUnshareTask, shareCandidates } from '../data/connect.ts';
import { Sheet, WEEKDAY_NAMES } from '../components/ui.tsx';
import { WorkoutPlanEditor, blankExercise } from '../components/Workout.tsx';
import { ShareTaskSheet } from '../components/Connections.tsx';

/** "Oct 27 – Nov 2" for a step. */
export function dateRange(s: { start_date: ISODate; end_date: ISODate }) {
  return { start: s.start_date, end: s.end_date };
}

/** The calendar days of a week step (it may be a partial week at a month edge). */
export function daysOfWeek(week: PlanStep): ISODate[] {
  return weekDates(addDays(week.start_date, 1 - isoWeekday(week.start_date))).filter((d) => d >= week.start_date && d <= week.end_date);
}

/** How a general task is checked off. Workouts are their own task type. */
const KINDS: { value: ActionKind; label: string }[] = [
  { value: 'check', label: 'Just do it' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'count', label: 'Count' },
  { value: 'study', label: 'Study' },
  { value: 'measure', label: 'Log a number' },
  { value: 'photo', label: 'Photo' },
];

export function TaskSheet({
  goal,
  plan,
  week,
  task,
  initial,
  onClose,
  onSaved,
}: {
  goal: Goal;
  plan: Plan;
  week: PlanStep;
  task: WeekTask | null;
  initial?: Partial<TaskInput>;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const { data, today, commit } = useStore();
  const view = useView();
  const [v, setV] = useState<TaskInput>(() => (task ? inputFromTask(task, week) : { ...blankTask(week, today), ...initial }));
  const set = (patch: Partial<TaskInput>) => setV((x) => ({ ...x, ...patch }));
  // Every goal this task supports. The goal you're on always stays in the set.
  const [goalIds, setGoalIds] = useState<string[]>(() => (task ? view.goalsForAction(task.action.id).map((g) => g.id) : [goal.id]));
  const connected = new Set(view.connectionsFor(goal.id).map((c) => c.goal.id));
  const goalChoices = [
    goal,
    ...view.activeGoals.filter((g) => g.id !== goal.id).sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)) || a.title.localeCompare(b.title)),
    ...goalIds.map((id) => view.goal(id)).filter((g): g is Goal => !!g && g.id !== goal.id && !view.activeGoals.includes(g)),
  ];
  const sharedWith = task ? view.otherGoalsForAction(task.action.id, goal.id) : [];
  // New task: offer the tasks other goals already have, so a duplicate isn't made by accident.
  const candidates = task ? [] : shareCandidates(view, goal.id, today);
  const matches = matchingTasks(candidates, v.title);
  const [browsing, setBrowsing] = useState(false);
  const useExisting = (actionId: string, title: string, from: string) => {
    commit(opsShareTask(data, actionId, goal.id));
    onSaved(`Using ${title} from ${from}: it now counts for ${goal.title} too`);
  };
  const types = data.measurementTypes.filter((t) => !t.archived_at);
  const pickKind = (kind: ActionKind) => {
    const patch: Partial<TaskInput> = { kind };
    // A weigh-in or a photo takes no real time: don't count 30 minutes toward the day.
    if ((kind === 'measure' || kind === 'photo') && v.kind !== 'measure' && v.kind !== 'photo') patch.minutes = 0;
    // A new workout starts from the exercises written in details, or one empty exercise.
    if (kind === 'workout' && !v.workoutPlan?.length) {
      const fromDetails = v.details?.trim() ? parseWorkoutPlan(v.details) : [];
      patch.workoutPlan = fromDetails.length ? fromDetails : [blankExercise()];
    }
    if (kind === 'measure' && !v.measurementTypeId && !v.newMeasure) {
      const fromGoals = goalIds.map((id) => view.goal(id)?.measurement_type_id).find((x) => x && types.some((t) => t.id === x));
      const first = fromGoals ?? types[0]?.id ?? null;
      patch.measurementTypeId = first;
      patch.newMeasure = first ? null : { name: '', unit: data.profile.units };
    }
    set(patch);
  };
  const from = applyFrom(week, today);
  const goalEnd = view.endFor(goal, plan);
  const [pickEnd, setPickEnd] = useState(false);
  const month = data.planSteps.find((s) => s.id === week.parent_id);
  const quarter = month ? data.planSteps.find((s) => s.id === month.parent_id) : undefined;
  const throughOptions: [string, ISODate | null][] = [
    ['This week', week.end_date],
    ...(month && month.end_date > week.end_date ? [[`End of ${month.title}`, month.end_date] as [string, ISODate]] : []),
    ...(quarter && quarter.end_date > (month?.end_date ?? week.end_date) ? [[`End of ${quarter.title.toLowerCase()}`, quarter.end_date] as [string, ISODate]] : []),
    ...(plan.end_date > (quarter?.end_date ?? week.end_date) ? [['End of plan', plan.end_date] as [string, ISODate]] : []),
    ...(goalEnd < plan.end_date && goalEnd > week.end_date && goalEnd !== month?.end_date && goalEnd !== quarter?.end_date ? [['When the goal is due', goalEnd] as [string, ISODate]] : []),
    ['No end date', null],
  ];
  if (!throughOptions.some(([, d]) => d === v.through)) throughOptions.push([`Through ${shortDate(v.through!)}`, v.through]);
  const originalDate = task && isOnce(task.schedule) ? task.schedule.effective_from : null;
  const dayChoices = weekDates(addDays(week.start_date, 1 - isoWeekday(week.start_date))).filter(
    (d) => d >= week.start_date && d <= week.end_date && (d >= from || d === originalDate),
  );
  const measureOk = v.kind !== 'measure' || (v.newMeasure ? v.newMeasure.name.trim().length > 0 : !!v.measurementTypeId);
  const valid = v.title.trim().length > 0 && (v.kind !== 'workout' || (v.workoutPlan ?? []).some((e) => e.name.trim())) && (v.when !== 'days' || v.days.length > 0) && (v.when !== 'once' || dayChoices.includes(v.date) || v.date >= from) && (v.when === 'once' || !v.through || v.through >= (v.start ?? from)) && measureOk;

  function save() {
    if (!valid) return;
    if (task) {
      // A one-day task on a day that has already passed only changes its details, not its date.
      const editFrom = originalDate && originalDate < from && v.when === 'once' && v.date === originalDate ? originalDate : from;
      commit(opsEditTask(data, task.action, { ...v, goalIds }, editFrom, today, goal.id));
      onSaved(`${v.title.trim()} updated${editFrom > today ? ` from ${shortDate(editFrom)}` : ''}`);
    } else {
      const ensure = opsEnsureStep(data, week);
      commit([...ensure, ...opsAddTask(withOps(data, ensure), goal, week, { ...v, goalIds }, today)]);
      onSaved(`Added ${v.title.trim()}${week.start_date <= today ? ". It's on Today when it's due." : ''}`);
    }
  }

  return (
    <Sheet title={task ? 'Edit daily task' : `New task · ${week.title}`} onClose={onClose}>
      <div className="row-start small muted" style={{ marginTop: -8 }}>
        <span className="dot" style={{ background: goal.color }} />
        {goal.title} · {rangeLabel(dateRange(week))}
      </div>
      {sharedWith.length > 0 && (
        <div className="banner info">
          <span>Shared with {sharedWith.map((g) => g.title).join(', ')}: changes here change it there too.</span>
        </div>
      )}
      <label className="field">
        Task
        <input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder={v.kind === 'workout' ? 'e.g. Mon · Chest & Back A' : 'e.g. Practice chord changes'} />
      </label>
      <div className="stack-sm">
        <span className="xsmall muted">Task type</span>
        <div className="seg" role="tablist" aria-label="Task type">
          <button role="tab" aria-selected={v.kind !== 'workout'} onClick={() => v.kind === 'workout' && pickKind('check')}>
            General
          </button>
          <button role="tab" aria-selected={v.kind === 'workout'} onClick={() => v.kind !== 'workout' && pickKind('workout')}>
            Workout
          </button>
        </div>
        {v.kind === 'workout' && <span className="xsmall muted">Plan the exercises with sets, reps and weight. On the day, the log opens with the plan filled in and you enter what you actually did.</span>}
      </div>
      {matches.length > 0 && (
        <div className="banner info stack-sm" style={{ alignItems: 'stretch' }}>
          {matches.slice(0, 3).map((m) => (
            <div key={m.action.id} className="row-between" style={{ gap: 8 }}>
              <span className="small">
                <b>{m.action.title}</b> already exists on {m.goal.title}. Use that one instead?
              </span>
              <button className="btn small" style={{ flex: 'none' }} onClick={() => useExisting(m.action.id, m.action.title, m.goal.title)}>
                Use it
              </button>
            </div>
          ))}
        </div>
      )}
      {!task && candidates.length > 0 && !v.title.trim() && (
        <div className="card tight stack-sm">
          <div className="row-between">
            <span className="xsmall muted">Or use one you already have (logged once, counts for both)</span>
            <button className="link-btn small" onClick={() => setBrowsing(true)}>
              See all
            </button>
          </div>
          <div className="chips">
            {candidates.flatMap((g) => g.tasks.map((t) => ({ ...t, goal: g.goal }))).slice(0, 6).map((t) => (
              <button key={t.action.id} className="chip" onClick={() => useExisting(t.action.id, t.action.title, t.goal.title)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }} title={`From ${t.goal.title} · ${describeSchedule(t.schedule)}`}>
                <span className="dot" style={{ width: 7, height: 7, background: t.goal.color }} />
                {t.action.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {browsing && <ShareTaskSheet goal={goal} onClose={() => setBrowsing(false)} onShared={(m) => onSaved(m)} />}
      <div className="stack-sm">
        <span className="xsmall muted">When</span>
        <div className="seg" role="tablist" aria-label="When">
          <button role="tab" aria-selected={v.when === 'days'} onClick={() => set({ when: 'days' })}>
            Set days
          </button>
          <button role="tab" aria-selected={v.when === 'per_week'} onClick={() => set({ when: 'per_week' })}>
            Times a week
          </button>
          <button role="tab" aria-selected={v.when === 'once'} onClick={() => set({ when: 'once', date: dayChoices.includes(v.date) ? v.date : dayChoices[0] ?? v.date })}>
            One day
          </button>
        </div>
        {v.when === 'days' && (
          <div className="chips" role="group" aria-label="Days">
            {WEEKDAY_NAMES.map((d, i) => {
              const dayNo = i + 1;
              const on = v.days.includes(dayNo);
              return (
                <button key={d} className="chip" aria-pressed={on} onClick={() => set({ days: on ? v.days.filter((x) => x !== dayNo) : [...v.days, dayNo].sort() })}>
                  {d}
                </button>
              );
            })}
            <button className="chip" onClick={() => set({ days: [1, 2, 3, 4, 5, 6, 7] })}>
              Every day
            </button>
          </div>
        )}
        {v.when === 'per_week' && (
          <label className="field">
            Times a week (place them on days from Today)
            <input type="number" min={1} max={14} value={v.perWeek} onChange={(e) => set({ perWeek: Math.min(14, Math.max(1, Number(e.target.value))) })} />
          </label>
        )}
        {v.when === 'once' && (
          <div className="stack-sm">
            <div className="chips" role="group" aria-label="Day">
              {dayChoices.map((d) => (
                <button key={d} className="chip" aria-pressed={v.date === d} onClick={() => set({ date: d })}>
                  {d === today ? 'Today' : `${weekdayName(d)} ${d.slice(8)}`}
                </button>
              ))}
            </div>
            <label className="field">
              Or any date (an exam, a class)
              <input type="date" min={from} value={v.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
            </label>
          </div>
        )}
      </div>
      {v.when !== 'once' && (
        <label className="field">
          Starts
          <input type="date" min={from} value={v.start ?? from} onChange={(e) => set({ start: e.target.value && e.target.value > from ? e.target.value : null })} />
          <span className="xsmall muted" style={{ fontWeight: 400 }}>
            Later for something that begins on a date, like coursework from the first class.
          </span>
        </label>
      )}
      {v.when !== 'once' && (
        <label className="field">
          Repeat
          <select
            value={pickEnd ? 'pick' : v.through ?? ''}
            onChange={(e) => {
              if (e.target.value === 'pick') {
                setPickEnd(true);
                const s0 = v.start ?? from;
                if (!v.through || v.through < s0) set({ through: addDays(s0, 27) });
                return;
              }
              setPickEnd(false);
              set({ through: e.target.value || null });
            }}
          >
            {throughOptions.map(([label, d]) => (
              <option key={label} value={d ?? ''}>
                {label}
                {d ? ` (${shortDate(d)})` : ''}
              </option>
            ))}
            <option value="pick">Until a date I pick…</option>
          </select>
        {pickEnd && <input className="input" type="date" aria-label="Last day" min={v.start ?? from} value={v.through ?? ''} onChange={(e) => e.target.value && set({ through: e.target.value })} />}
        </label>
      )}
      {v.kind === 'workout' && <WorkoutPlanEditor plan={v.workoutPlan ?? []} details={v.details ?? ''} unit={data.profile.units} onChange={(p) => set({ workoutPlan: p })} />}
      {v.kind !== 'workout' && (
      <div className="stack-sm">
        <span className="xsmall muted">How you log it</span>
        <div className="chips">
          {KINDS.map((k) => (
            <button key={k.value} className="chip" aria-pressed={v.kind === k.value} onClick={() => pickKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>
        {v.kind === 'measure' && <span className="xsmall muted">Checking it off asks for the number and saves it as that day's reading, so the goal's path updates.</span>}
        {v.kind === 'photo' && <span className="xsmall muted">Checking it off opens the camera or your photos and saves the photo to that day.</span>}
      </div>
      )}
      {v.kind === 'measure' && (
        <div className="stack-sm">
          <label className="field">
            What it records
            <select
              value={v.newMeasure ? '__new' : v.measurementTypeId ?? ''}
              onChange={(e) => (e.target.value === '__new' ? set({ newMeasure: { name: '', unit: data.profile.units }, measurementTypeId: null }) : set({ measurementTypeId: e.target.value, newMeasure: null }))}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.unit ? ` (${t.unit})` : ''}
                </option>
              ))}
              <option value="__new">+ New measurement…</option>
            </select>
          </label>
          {v.newMeasure && (
            <div className="grid-2">
              <label className="field">
                Name
                <input value={v.newMeasure.name} onChange={(e) => set({ newMeasure: { ...v.newMeasure!, name: e.target.value } })} placeholder="e.g. Weight" />
              </label>
              <label className="field">
                Unit
                <input value={v.newMeasure.unit} onChange={(e) => set({ newMeasure: { ...v.newMeasure!, unit: e.target.value } })} placeholder="e.g. lb" />
              </label>
            </div>
          )}
        </div>
      )}
      <div className="grid-2">
        {v.kind !== 'measure' && v.kind !== 'photo' && (
          <label className="field">
            Minutes
            <input type="number" min={0} value={v.minutes} onChange={(e) => set({ minutes: Math.max(0, Number(e.target.value)) })} />
          </label>
        )}
        {v.kind === 'count' && (
          <label className="field">
            How many
            <input type="number" min={1} value={v.count ?? 1} onChange={(e) => set({ count: Math.max(1, Number(e.target.value)) })} />
          </label>
        )}
      </div>
      <label className="field">
        {v.kind === 'workout' ? 'Warm-up and notes (optional)' : 'Details (optional)'}
        <textarea rows={4} value={v.details ?? ''} onChange={(e) => set({ details: e.target.value })} placeholder={v.kind === 'workout' ? 'e.g. warm-up, how to progress' : 'e.g. what to cover, links, steps'} />
        <span className="xsmall muted">Shown when you tap the task on Today.</span>
      </label>
      <label className="field">
        When does it happen? (optional)
        <input value={v.cue} onChange={(e) => set({ cue: e.target.value })} placeholder="e.g. After morning coffee, at my desk" />
        <span className="xsmall muted">A specific cue ("after ___, at ___") makes a habit much more likely to stick. It shows on Today.</span>
      </label>
      <label className="field">
        Minimum version for hard days (optional)
        <input value={v.minLabel} onChange={(e) => set({ minLabel: e.target.value })} placeholder="e.g. 5 minutes" />
      </label>
      {goalChoices.length > 1 && (
        <div className="stack-sm">
          <span className="xsmall muted">Supports (logging it once counts for each)</span>
          <div className="chips" role="group" aria-label="Goals this task supports">
            {goalChoices.map((g) => {
              const on = goalIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  className="chip"
                  aria-pressed={on}
                  disabled={g.id === goal.id}
                  title={g.id === goal.id ? 'The goal you are on' : undefined}
                  onClick={() => setGoalIds(on ? goalIds.filter((x) => x !== g.id) : [...goalIds, g.id])}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
                >
                  <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
                  {g.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <label className="row-start small">
        <input type="checkbox" checked={v.priority} onChange={(e) => set({ priority: e.target.checked })} style={{ width: 20, height: 20 }} />
        Show under Priorities on Today
      </label>
      {task && (
        <p className="xsmall muted" style={{ margin: 0 }}>
          Changes apply from {from === today ? 'today' : shortDate(from)} on, on every day this task runs. Days already logged keep their history. To change only one day, tap that
          day above and choose "Just this day".
        </p>
      )}
      <div className="btn-row">
        {task && sharedWith.length > 0 && (
          <button
            className="btn"
            onClick={() => {
              commit(opsUnshareTask(data, task.action.id, goal.id));
              onSaved(`${task.action.title} no longer counts for ${goal.title}; it keeps running for ${sharedWith.map((g) => g.title).join(', ')}`);
            }}
          >
            Remove from this goal
          </button>
        )}
        {task && (
          <button
            className="btn danger"
            onClick={() => {
              commit(opsRemoveTask(data, task.action, from));
              onSaved(`${task.action.title} removed from ${from === today ? 'today' : shortDate(from)} on`);
            }}
          >
            {sharedWith.length > 0 ? 'Stop everywhere' : 'Remove'}
          </button>
        )}
        <button className="btn primary" disabled={!valid} onClick={save}>
          {task ? 'Save changes' : 'Add task'}
        </button>
      </div>
    </Sheet>
  );
}



// ---------- The goal page's cards ----------
