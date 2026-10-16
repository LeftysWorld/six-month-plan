import { useMemo, useState } from 'react';
import { addDays, suggestPath, type GoalType, type PathPoint } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView } from '../data/derive.ts';
import { opsCreateGoal, type ActionInput } from '../data/ops.ts';
import { navigate } from '../router.ts';
import { ActionFields, blankAction, weeklyMinutes } from '../components/ActionFields.tsx';
import { BackLink, Empty, GOAL_COLORS, NumberInput, useToast } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';

const TYPES: { value: GoalType; title: string; sub: string }[] = [
  { value: 'number', title: 'Reach a number', sub: 'Start, target, date' },
  { value: 'practice', title: 'Build a practice', sub: 'Times per week' },
  { value: 'finish', title: 'Finish something', sub: 'Dated steps' },
];

export function GoalNew({ planId }: { planId: string | null }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const plan = (planId && view.plan(planId)) || view.mainPlan;
  const existing = plan ? view.goalsForPlan(plan.id) : [];

  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<GoalType>('practice');
  const [unit, setUnit] = useState('lb');
  const [measureName, setMeasureName] = useState('Weight');
  const [baseline, setBaseline] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [targetDate, setTargetDate] = useState(plan?.end_date ?? addDays(today, 182));
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [why, setWhy] = useState('');
  const [doneMeans, setDoneMeans] = useState('');
  const [milestones, setMilestones] = useState([{ title: '', due_date: addDays(today, 28) }]);
  const [withAction, setWithAction] = useState(true);
  const [action, setAction] = useState<ActionInput>(blankAction());
  const color = GOAL_COLORS[existing.length % GOAL_COLORS.length]!;

  const startDate = today;
  const path: PathPoint[] = useMemo(() => {
    if (type !== 'number' || baseline == null || target == null) return [];
    return suggestPath(baseline, target, startDate, targetDate, plan?.block_days ?? 28).map((p) => ({
      ...p,
      value: edits[p.date] ?? p.value,
    }));
  }, [type, baseline, target, startDate, targetDate, plan, edits]);

  // Capacity: average minutes a day already planned by active actions vs available.
  const plannedPerDay = useMemo(() => {
    let weekly = 0;
    for (const a of data.actions.filter((x) => !x.archived_at)) {
      const s = view.scheduleFor(a.id);
      if (!s) continue;
      weekly += (s.rule === 'per_week' ? s.per_week ?? 0 : s.days.length) * a.planned_minutes;
    }
    return weekly / 7;
  }, [data.actions, view]);
  const availablePerDay = data.profile.available_minutes.reduce((a, b) => a + b, 0) / 7;
  const withNew = plannedPerDay + (withAction && action.title.trim() ? weeklyMinutes(action) / 7 : 0);

  if (!plan) return <Empty title="Create a plan first." />;

  const canNext1 = title.trim().length > 0;
  const canNext2 = type !== 'number' || (target != null && targetDate > today);

  function save() {
    if (!plan) return;
    const { ops, goalId } = opsCreateGoal(
      data,
      {
        planId: plan.id,
        title,
        type,
        why,
        done_means: doneMeans,
        color,
        unit,
        measureName,
        baseline,
        target,
        targetDate,
        path,
        milestones: type === 'finish' ? milestones : [],
        action: withAction ? action : null,
      },
      today,
    );
    commit(ops);
    toast(`Added ${title.trim()}`);
    navigate(`/goals/${goalId}`);
  }

  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label="Cancel" fallback={`/plans/${plan.id}`} />
        <span className="small muted">
          {plan.name} · step {step} of 3
        </span>
      </div>
      <div className="steps" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <div key={n} className={n <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 1 && (
        <div className="stack">
          <h1>What do you want to be true in six months?</h1>
          <label className="field">
            Goal
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Comfortable on guitar" />
          </label>
          <div className="grid-3">
            {TYPES.map((t) => (
              <button key={t.value} type="button" className="choice" aria-pressed={type === t.value} onClick={() => setType(t.value)}>
                <b>{t.title}</b>
                <span>{t.sub}</span>
              </button>
            ))}
          </div>
          {existing.length >= 3 && (
            <div className="banner warn">This plan already has {existing.length} goals. Most people stick with 3–4 at first.</div>
          )}
          <button className="btn primary" disabled={!canNext1} onClick={() => setStep(2)}>
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <h1>{title}</h1>
          {type === 'number' && (
            <>
              <div className="grid-2">
                <label className="field">
                  What you measure
                  <input value={measureName} onChange={(e) => setMeasureName(e.target.value)} />
                </label>
                <label className="field">
                  Unit
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} />
                </label>
              </div>
              <div className="grid-3">
                <NumberInput label="Starting point" value={baseline} onChange={setBaseline} placeholder="Add later" />
                <NumberInput label="Target" value={target} onChange={setTarget} />
                <label className="field">
                  By
                  <input type="date" value={targetDate} min={addDays(today, 7)} onChange={(e) => setTargetDate(e.target.value)} />
                </label>
              </div>
              {baseline == null && <p className="xsmall muted" style={{ margin: 0 }}>Don't know your start yet? Leave it empty and add it later.</p>}
              {path.length > 0 && baseline != null && (
                <div className="card stack-sm">
                  <div className="row-between small">
                    <b>Suggested path · 4-week blocks</b>
                    <span className="muted">
                      {fmt(((target! - baseline) / Math.max(1, path.length)))} {unit} / block
                    </span>
                  </div>
                  <WeightChart
                    start={{ date: startDate, value: baseline }}
                    path={path}
                    readings={[]}
                    range={{ start: startDate, end: targetDate }}
                    today={today}
                    unit={unit}
                    color={color}
                  />
                  <div className="xsmall muted">Change any block's target if the straight line doesn't fit.</div>
                  <div className="grid-3">
                    {path.map((p, i) => (
                      <NumberInput
                        key={p.date}
                        label={i === path.length - 1 ? `Goal · ${p.date.slice(5)}` : `Block ${i + 1} · ${p.date.slice(5)}`}
                        value={p.value}
                        onChange={(v) => v != null && setEdits({ ...edits, [p.date]: v })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {type === 'finish' && (
            <div className="card stack-sm">
              <b className="small">Dated steps (modules, exam booking, exam day)</b>
              {milestones.map((m, i) => (
                <div key={i} className="grid-2">
                  <input
                    className="input"
                    aria-label={`Step ${i + 1}`}
                    placeholder={`Step ${i + 1}`}
                    value={m.title}
                    onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  />
                  <input
                    className="input"
                    type="date"
                    aria-label={`Step ${i + 1} date`}
                    value={m.due_date}
                    onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))}
                  />
                </div>
              ))}
              <button
                type="button"
                className="link-btn small"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setMilestones([...milestones, { title: '', due_date: addDays(milestones.at(-1)?.due_date ?? today, 14) }])}
              >
                + Add a step
              </button>
            </div>
          )}
          {type === 'practice' && (
            <p className="muted small" style={{ margin: 0 }}>
              Practice goals are tracked by how often you show up. You can add a measurement (arm size, splits gap) on the goal page afterwards.
            </p>
          )}
          <label className="field">
            Why this matters (one line)
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Play for myself at the end of the day" />
          </label>
          <label className="field">
            How will you know you made it?
            <input value={doneMeans} onChange={(e) => setDoneMeans(e.target.value)} placeholder="e.g. 3 songs recorded start to finish" />
          </label>
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn primary" disabled={!canNext2} onClick={() => setStep(3)}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <h1>What will you do regularly?</h1>
          <label className="row-start small">
            <input type="checkbox" checked={withAction} onChange={(e) => setWithAction(e.target.checked)} style={{ width: 20, height: 20 }} />
            Add a regular action for this goal
          </label>
          {withAction && <ActionFields value={action} onChange={setAction} />}
          <div className={`banner ${withNew > availablePerDay ? 'warn' : 'info'}`}>
            <span>
              Daily time planned: <b>{minutesText(Math.round(withNew))}</b> of {minutesText(Math.round(availablePerDay))} available
              {withNew > availablePerDay ? '. That is more than you have; consider fewer sessions.' : ''}
            </span>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn primary" disabled={withAction && !action.title.trim()} onClick={save}>
              Save goal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
