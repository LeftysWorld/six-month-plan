import { useState } from 'react';
import { describeSchedule, shortDate, type Goal, type MeasurementType } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import {
  opsAddMeasurement,
  opsAddMeasurementType,
  opsAddMilestone,
  opsArchiveGoal,
  opsDeleteMeasurement,
  opsToggleMilestone,
  opsUpdateGoal,
} from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { Empty, Icon, NumberInput, PacePill, useToast } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { stepAt, stepsForGoal, tasksInRange } from '../data/breakdown.ts';

export function GoalDetail({ id }: { id: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const goal = view.goal(id);
  const [editing, setEditing] = useState(false);
  const [msTitle, setMsTitle] = useState('');
  const [msDate, setMsDate] = useState(today);
  if (!goal) return <Empty title="Goal not found." />;

  const plans = view.plansForGoal(goal.id);
  const plan = plans.find((p) => p.start_date <= today && p.end_date >= today) ?? plans[0] ?? null;
  const pace = view.goalPace(goal, plan);
  const actions = view.actionsForGoal(goal.id);
  const milestones = data.milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const types = data.measurementTypes.filter((t) => !t.archived_at && (t.goal_id === goal.id || t.id === goal.measurement_type_id));
  const actionIds = new Set(actions.map((a) => a.id));
  const history = data.changeLog
    .filter((c) => c.entity_id === goal.id || actionIds.has(c.entity_id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const nextMilestone = milestones.find((m) => !m.completed_at);

  const chain = [
    actions[0] ? `${actions[0].title} ${describeSchedule(view.scheduleFor(actions[0].id)).toLowerCase()}` : null,
    nextMilestone ? `${nextMilestone.title} by ${shortDate(nextMilestone.due_date)}` : null,
    goal.done_means || (goal.target_value != null ? `${fmt(goal.target_value)} ${goal.unit ?? ''} by ${goal.target_date ? shortDate(goal.target_date) : 'the end'}` : null),
  ].filter(Boolean);

  return (
    <div className="stack">
      <div aria-hidden="true" style={{ position: 'fixed', top: -170, right: -150, width: 440, height: 440, borderRadius: '50%', background: `radial-gradient(closest-side, ${goal.color}30, transparent)`, pointerEvents: 'none', zIndex: -1 }} />
      <div className="topbar">
        <button type="button" className="back" onClick={() => (plan ? navigate(`/plans/${plan.id}`) : navigate('/plans'))}>
          <Icon name="back" />
          {plan?.name ?? 'Plans'}
        </button>
      </div>
      <div className="stack-sm" style={{ gap: 8 }}>
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="dot" style={{ width: 7, height: 7, background: goal.color, boxShadow: `0 0 10px ${goal.color}` }} />
          6-month goal
        </span>
        <h1>{goal.title}</h1>
        {chain.length > 0 && <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>{chain.join(' → ')}</div>}
      </div>

      <div className="card stack-sm">
        <div className="row-between">
          <span className="label">Why</span>
          <div className="row-start">
            <PacePill label={pace.label} />
            <button className="link-btn small" onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>
        </div>
        {editing ? (
          <GoalEdit goal={goal} />
        ) : (
          <>
            <div style={{ fontStyle: 'italic' }}>{goal.why ? `"${goal.why}"` : <span className="muted">Add one line on why this matters.</span>}</div>
            <div className="row-between small" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
              <span className="muted">Done means</span>
              <span style={{ textAlign: 'right' }}>{goal.done_means || '–'}</span>
            </div>
            <div className="row-between small">
              <span className="muted">Status</span>
              <span>{pace.summary}</span>
            </div>
          </>
        )}
      </div>

      <BreakdownCard goalId={goal.id} planId={plan?.id ?? null} color={goal.color} />

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

      <div className="card stack-sm">
        <div className="row-between">
          <span className="label">Actions</span>
          <a className="small strong" href={href(`/actions/new?goal=${goal.id}`)} style={{ textDecoration: 'none' }}>
            + Add
          </a>
        </div>
        {actions.length === 0 && <span className="small muted">No regular action yet.</span>}
        {actions.map((a) => (
          <a key={a.id} className="list-row" href={href(`/actions/${a.id}`)}>
            <div className="grow">
              <div className="strong">{a.title}</div>
              <div className="xsmall muted">
                {a.planned_count ? `${a.planned_count} · ` : ''}
                {a.planned_minutes} min · {describeSchedule(view.scheduleFor(a.id))}
                {a.min_label ? ` · minimum: ${a.min_label}` : ''}
              </div>
            </div>
            <Icon name="chevron" size={18} />
          </a>
        ))}
      </div>

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
          className="grid-3"
          style={{ gridTemplateColumns: 'minmax(0,1fr) 140px auto' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!msTitle.trim()) return;
            commit(opsAddMilestone(goal.id, msTitle, msDate));
            setMsTitle('');
          }}
        >
          <input className="input" placeholder="New milestone" aria-label="New milestone" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} />
          <input className="input" type="date" aria-label="Milestone date" value={msDate} onChange={(e) => setMsDate(e.target.value)} />
          <button className="btn small" type="submit" style={{ minHeight: 44 }}>
            Add
          </button>
        </form>
      </div>

      <Measurements goal={goal} types={types} onAdd={(name) => toast(`Added ${name}`)} />

      {history.length > 0 && (
        <div className="card stack-sm">
          <span className="label">History</span>
          {history.map((c) => (
            <div key={c.id} className="list-row small">
              <span className="grow">{c.summary}</span>
              <span className="xsmall muted">from {shortDate(c.effective_from)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row-between xsmall muted">
        <span>In: {plans.map((p) => p.name).join(', ') || 'no plan'}</span>
        <button
          className="link-btn small"
          style={{ color: 'var(--danger)' }}
          onClick={() => {
            commit(opsArchiveGoal(goal, !goal.archived_at));
            toast(goal.archived_at ? 'Goal restored' : 'Goal archived; its history is kept');
          }}
        >
          {goal.archived_at ? 'Restore goal' : 'Archive goal'}
        </button>
      </div>
    </div>
  );
}

function GoalEdit({ goal }: { goal: Goal }) {
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
function BreakdownCard({ goalId, planId, color }: { goalId: string; planId: string | null; color: string }) {
  const { data, today } = useStore();
  const steps = stepsForGoal(data, goalId).filter((s) => s.plan_id === planId);
  const at = (level: 'quarter' | 'month' | 'week') => stepAt(steps.filter((s) => s.level === level), today);
  const q = at('quarter');
  const m = at('month');
  const w = at('week');
  const tasks = w ? tasksInRange(data, goalId, { start: w.start_date, end: w.end_date }, w.id) : [];
  return (
    <a className="card stack-sm" href={href(`/flow/${goalId}`)} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="row-between">
        <span className="label">Breakdown</span>
        <span className="small strong" style={{ color: 'var(--accent-ink)' }}>Open ›</span>
      </div>
      {steps.length === 0 ? (
        <span className="small muted">Break this goal into 3-month, monthly and weekly steps with daily tasks.</span>
      ) : (
        <div className="stack-sm" style={{ gap: 6, borderLeft: `2.5px solid ${color}66`, paddingLeft: 12 }}>
          {[q, m, w].map(
            (s) =>
              s && (
                <div key={s.id} className="small">
                  <b>{s.title}</b>
                  <span className="muted"> · {s.target_note || (s.target_value != null ? `${fmt(s.target_value)} by ${shortDate(s.end_date)}` : 'not described yet')}</span>
                </div>
              ),
          )}
          <div className="small">
            <b>Daily tasks</b>
            <span className="muted"> · {tasks.length} this week</span>
          </div>
        </div>
      )}
    </a>
  );
}
