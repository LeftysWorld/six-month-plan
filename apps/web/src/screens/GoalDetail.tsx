import { useState } from 'react';
import { shortDate, type Goal, type MeasurementType, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import {
  opsAddMeasurement,
  opsAddMeasurementType,
  opsAddMilestone,
  opsArchiveGoal,
  opsCompleteGoal,
  opsReopenGoal,
  opsDeleteMeasurement,
  opsToggleMilestone,
  opsUpdateGoal,
} from '../data/ops.ts';
import { navigate } from '../router.ts';
import { Icon, NumberInput, useToast } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { GoalFiles } from '../components/Attachments.tsx';

/**
 * The lower half of the goal page: why it matters, the path chart, milestones,
 * measurements, change history and archiving. The chain and daily tasks sit above it (Flow.tsx).
 */
export function GoalExtras({ goal, plan }: { goal: Goal; plan: Plan | null }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [msTitle, setMsTitle] = useState('');
  const [msDate, setMsDate] = useState(today);
  const plans = view.plansForGoal(goal.id);
  const pace = view.goalPace(goal, plan);
  const actions = view.actionsForGoal(goal.id, true);
  const milestones = data.milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const types = data.measurementTypes.filter((t) => !t.archived_at && (t.goal_id === goal.id || t.id === goal.measurement_type_id));
  const actionIds = new Set(actions.map((a) => a.id));
  const history = data.changeLog
    .filter((c) => c.entity_id === goal.id || actionIds.has(c.entity_id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <>
      <div className="card stack-sm">
        <div className="row-between">
          <span className="label">Why it matters</span>
          <button className="link-btn small" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
        {editing ? (
          <GoalEdit goal={goal} onSaved={() => setEditing(false)} />
        ) : (
          <>
            {goal.why ? <div style={{ fontSize: 16, fontStyle: 'italic' }}>"{goal.why}"</div> : <span className="small muted">Add a line about why this matters. It helps on hard days.</span>}
            {goal.done_means && (
              <div className="small" style={{ color: 'var(--ink-2)' }}>
                Done means: {goal.done_means}
              </div>
            )}
          </>
        )}
      </div>

      {goal.type === 'number' && pace.number && plan && (
        <div className="card stack-sm">
          <div className="row-between">
            <span className="label">Path</span>
            {pace.number.aheadBy != null && (
              <span className="small muted">
                {pace.number.aheadBy >= 0 ? `${fmt(pace.number.aheadBy)} ${goal.unit} ahead` : `${fmt(-pace.number.aheadBy)} ${goal.unit} behind`}
              </span>
            )}
          </div>
          <WeightChart
            start={pace.number.start}
            path={view.pathFor(goal)}
            readings={view.measurementsFor(goal.measurement_type_id)}
            range={{ start: pace.number.start.date, end: goal.target_date ?? plan.end_date }}
            today={today}
            unit={goal.unit ?? ''}
            color={goal.color}
          />
        </div>
      )}

      <GoalFiles actionIds={actionIds} />

      {(goal.type === 'finish' || milestones.length > 0) && (
        <div className="card stack-sm">
          <span className="label">Milestones</span>
          {milestones.length === 0 && <span className="small muted">No milestones yet.</span>}
          {milestones.map((m) => (
            <div key={m.id} className="list-row">
              <button
                aria-label={m.completed_at ? `${m.title} complete, tap to reopen` : `Mark ${m.title} complete`}
                onClick={() => commit(opsToggleMilestone(m))}
                style={{ width: 44, height: 44, border: 0, background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: -10 }}
              >
                <span className={`ring ${m.completed_at ? 'done' : ''}`} style={{ width: 22, height: 22 }}>
                  {m.completed_at && <Icon name="check" size={12} stroke={3.2} />}
                </span>
              </button>
              <div className="grow">
                <div style={{ textDecoration: m.completed_at ? 'line-through' : undefined, color: m.completed_at ? 'var(--muted)' : undefined }}>{m.title}</div>
                <div className="xsmall muted">
                  {shortDate(m.due_date)}
                  {!m.completed_at && m.due_date < today ? ' · past due' : ''}
                </div>
              </div>
            </div>
          ))}
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!msTitle.trim()) return;
              commit(opsAddMilestone(goal.id, msTitle, msDate));
              setMsTitle('');
            }}
          >
            <input className="input" placeholder="New milestone" aria-label="New milestone" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} />
            <div className="row-start" style={{ flexWrap: 'nowrap' }}>
              <input className="input" type="date" aria-label="Milestone date" value={msDate} onChange={(e) => setMsDate(e.target.value)} />
              <button className="btn small" type="submit" style={{ flex: 'none' }}>
                Add milestone
              </button>
            </div>
          </form>
        </div>
      )}

      <Measurements goal={goal} types={types} onAdd={(name) => toast(`Added ${name}`)} />

      {history.length > 0 && (
        <details className="card tight">
          <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            Change history · {history.length}
          </summary>
          {history.map((c) => (
            <div key={c.id} className="list-row small">
              <span className="grow">{c.summary}</span>
              <span className="xsmall muted">from {shortDate(c.effective_from)}</span>
            </div>
          ))}
        </details>
      )}

      <CompleteGoal goal={goal} />

      <div className="row-between xsmall muted">
        <span>In: {plans.map((p) => p.name).join(', ') || 'no plan'}</span>
        <button
          className="link-btn small"
          style={{ color: 'var(--danger)' }}
          onClick={() => {
            commit(opsArchiveGoal(goal, !goal.archived_at));
            toast(goal.archived_at ? 'Goal restored' : 'Goal archived; its history is kept');
            if (!goal.archived_at) navigate('/goals');
          }}
        >
          {goal.archived_at ? 'Restore goal' : 'Archive goal'}
        </button>
      </div>
    </>
  );
}

/** Finish the goal (it moves to Completed with a note on how it ended), or reopen a finished one. */
function CompleteGoal({ goal }: { goal: Goal }) {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (goal.completed_at) {
    return (
      <div className="card tight row-between small" style={{ gap: 10 }}>
        <span>
          <b>Completed {shortDate(goal.completed_at.slice(0, 10))}.</b>
          {goal.completion_note ? <span className="muted"> “{goal.completion_note}”</span> : null}
        </span>
        <button
          type="button"
          className="link-btn small"
          onClick={() => {
            commit(opsReopenGoal(data, goal));
            toast(`${goal.title} is active again`);
          }}
        >
          Reopen
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        Mark goal complete
      </button>
    );
  }
  return (
    <form
      className="card stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        commit(opsCompleteGoal(data, goal, note, today));
        toast(`${goal.title} completed`);
        navigate('/goals/completed');
      }}
    >
      <span className="label">Mark goal complete</span>
      <label className="field">
        How did it end? (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Recorded all three songs; the morning slot made it work" rows={2} autoFocus />
      </label>
      <span className="xsmall muted">It moves to Completed and its tasks come off your list. Its history is kept, and you can reopen it.</span>
      <div className="btn-row">
        <button className="btn small primary" type="submit">
          Complete goal
        </button>
        <button className="btn small" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function GoalEdit({ goal, onSaved }: { goal: Goal; onSaved?: () => void }) {
  const { commit } = useStore();
  const [title, setTitle] = useState(goal.title);
  const [why, setWhy] = useState(goal.why);
  const [done, setDone] = useState(goal.done_means);
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        commit(opsUpdateGoal(goal, { title: title.trim() || goal.title, why: why.trim(), done_means: done.trim() }));
        onSaved?.();
      }}
    >
      <label className="field">
        Goal
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Why
        <input value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <label className="field">
        Done means
        <input value={done} onChange={(e) => setDone(e.target.value)} />
      </label>
      <button className="btn primary small" type="submit">
        Save
      </button>
    </form>
  );
}

function Measurements({ goal, types, onAdd }: { goal: Goal; types: MeasurementType[]; onAdd: (name: string) => void }) {
  const { today, commit } = useStore();
  const view = useView();
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('in');
  const [cadence, setCadence] = useState(7);
  const [adding, setAdding] = useState(false);

  return (
    <div className="card stack-sm">
      <div className="row-between">
        <span className="label">Measurements</span>
        <button className="link-btn small" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ Track something'}
        </button>
      </div>
      {adding && (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            commit(opsAddMeasurementType({ name: newName.trim(), unit: newUnit.trim(), cadence_days: cadence, goal_id: goal.id }));
            onAdd(newName.trim());
            setNewName('');
            setAdding(false);
          }}
        >
          <div className="grid-3">
            <label className="field">
              Name
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Arm (flexed)" />
            </label>
            <label className="field">
              Unit
              <input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
            </label>
            <label className="field">
              Every (days)
              <input type="number" min={1} max={90} value={cadence} onChange={(e) => setCadence(Number(e.target.value))} />
            </label>
          </div>
          <button className="btn small" type="submit">
            Add measurement
          </button>
        </form>
      )}
      {types.length === 0 && !adding && <span className="small muted">Track a number for evidence, like arm size or the splits gap.</span>}
      {types.map((t) => {
        const readings = view.measurementsFor(t.id);
        const first = readings[0];
        const last = readings.at(-1);
        return (
          <div key={t.id} className="stack-sm" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
            <div className="row-between small">
              <b>{t.name}</b>
              <span className="muted">
                {last ? `${fmt(last.value)} ${t.unit} · ${shortDate(last.measured_on)}` : 'No readings'}
                {first && last && first !== last ? ` · start ${fmt(first.value)}` : ''}
              </span>
            </div>
            <form
              className="grid-3"
              style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
              onSubmit={(e) => {
                e.preventDefault();
                const v = values[t.id];
                if (v == null) return;
                commit(opsAddMeasurement(t.id, v, today));
                setValues({ ...values, [t.id]: null });
              }}
            >
              <NumberInput label={`Today's ${t.name.toLowerCase()} (${t.unit})`} value={values[t.id] ?? null} onChange={(v) => setValues({ ...values, [t.id]: v })} />
              <button className="btn small" type="submit" style={{ alignSelf: 'end', minHeight: 44 }}>
                Log
              </button>
            </form>
            {readings.length > 0 && (
              <details>
                <summary className="xsmall muted" style={{ cursor: 'pointer' }}>
                  All {readings.length} readings
                </summary>
                <table className="table">
                  <tbody>
                    {[...readings].reverse().map((r) => (
                      <tr key={r.id}>
                        <td>{shortDate(r.measured_on)}</td>
                        <td>
                          {fmt(r.value)} {t.unit}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="link-btn xsmall" onClick={() => commit(opsDeleteMeasurement(r.id))} aria-label={`Delete reading from ${shortDate(r.measured_on)}`}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}


/** Where this goal is right now in its breakdown: 3 months → month → week → today's tasks. */
