import { useMemo, useState } from 'react';
import { addDays, cascadeRanges, shortDate, suggestPath, valueOnPath, type GoalType, type PathPoint } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import { opsCreateGoal } from '../data/ops.ts';
import { navigate } from '../router.ts';
import { opsCreateBreakdown, withOps } from '../data/breakdown.ts';
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
  const color = GOAL_COLORS[existing.length % GOAL_COLORS.length]!;

  const startDate = today;
  const path: PathPoint[] = useMemo(() => {
    if (type !== 'number' || baseline == null || target == null) return [];
    return suggestPath(baseline, target, startDate, targetDate, plan?.block_days ?? 28).map((p) => ({
      ...p,
      value: edits[p.date] ?? p.value,
    }));
  }, [type, baseline, target, startDate, targetDate, plan, edits]);

  // What the goal flows into: two 3-month stages, three months each.
  const preview = useMemo(() => (plan ? cascadeRanges(plan) : []), [plan]);
  const startPoint = baseline != null ? { date: startDate, value: baseline } : null;
  const targetAt = (d: string) => (type === 'number' && startPoint && path.length ? fmt(valueOnPath(startPoint, path, d)) : null);

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
        action: null,
      },
      today,
    );
    // The goal flows straight into its breakdown: 3 months → months → weeks.
    const next = withOps(data, ops);
    const goal = next.goals.find((g) => g.id === goalId)!;
    commit([...ops, ...opsCreateBreakdown(next, goal, plan)]);
    toast(`Added ${title.trim()}. Now plan the stages and this week's tasks.`);
    navigate(`/flow/${goalId}`);
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
          <h1>Here's how it breaks down</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Your 6-month goal flows into two 3-month stages, six months, and weekly steps. Next you'll describe each stage and add daily tasks; they show up on Today.
          </p>
          <div className="card stack-sm">
            <div className="row-between">
              <b>6 months · {title.trim()}</b>
              <span className="xsmall muted">
                {shortDate(plan.start_date)} – {shortDate(plan.end_date)}
              </span>
            </div>
            {type === 'number' && target != null && (
              <span className="small">
                {baseline != null ? `${fmt(baseline)} → ` : ''}
                {fmt(target)} {unit}
              </span>
            )}
          </div>
          {preview.map((q) => (
            <div key={q.start} className="card tight stack-sm" style={{ marginLeft: 14, borderLeft: `1.5px solid ${color}88` }}>
              <div className="row-between small">
                <b>{q.title}</b>
                <span className="xsmall muted">
                  {shortDate(q.start)} – {shortDate(q.end)}
                  {targetAt(q.end) ? ` · ${targetAt(q.end)} ${unit}` : ''}
                </span>
              </div>
              <div className="grid-3" style={{ marginLeft: 6 }}>
                {q.children.map((m) => (
                  <div key={m.start} className="goal-chip" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <b>{m.title}</b>
                    <span className="xsmall muted">{m.children.length} weeks</span>
                    {targetAt(m.end) && (
                      <span className="xsmall">
                        {targetAt(m.end)} {unit}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn primary" onClick={save}>
              Save and plan the stages
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
