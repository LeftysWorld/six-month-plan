import { useState } from 'react';
import {
  blockCount,
  blockIndex,
  blockRange,
  planTotalWeeks,
  planWeekNumber,
  quarterRange,
  shortDate,
  weekStart,
  type DateRange,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsArchivePlan, opsLinkGoalToPlan } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { BackLink, Bar, Empty, PacePill } from '../components/ui.tsx';

type Horizon = 'plan' | 'quarter' | 'block' | 'week';

export function PlanDetail({ id }: { id: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const plan = view.plan(id);
  const [horizon, setHorizon] = useState<Horizon>('block');
  const [linking, setLinking] = useState(false);
  if (!plan) return <Empty title="Plan not found." />;

  const goals = view.goalsForPlan(plan.id);
  const started = plan.start_date <= today;
  const ref = started ? (today > plan.end_date ? plan.end_date : today) : plan.start_date;
  const bIndex = blockIndex(plan, ref);
  const ranges: Record<Horizon, DateRange> = {
    plan: { start: plan.start_date, end: plan.end_date },
    quarter: quarterRange(plan, ref),
    block: blockRange(plan, bIndex),
    week: { start: ref, end: ref },
  };
  const weekRange: DateRange = { start: weekStart(ref), end: ref };
  const range = horizon === 'week' ? weekRange : { start: ranges[horizon].start, end: ref < ranges[horizon].end ? ref : ranges[horizon].end };
  const otherGoals = data.goals.filter((g) => !g.archived_at && !goals.some((x) => x.id === g.id));

  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label="Plans" fallback="/plans" />
        <button
          className="link-btn small"
          onClick={() => {
            commit(opsArchivePlan(plan, !plan.archived_at));
            if (!plan.archived_at) navigate('/plans');
          }}
        >
          {plan.archived_at ? 'Restore plan' : 'Archive plan'}
        </button>
      </div>
      <div>
        <h1>{plan.name}</h1>
        <div className="small muted">
          {shortDate(plan.start_date)} → {shortDate(plan.end_date)}
          {started && ` · week ${planWeekNumber(plan, ref)} of ${planTotalWeeks(plan)} · block ${bIndex + 1} of ${blockCount(plan)}`}
        </div>
      </div>
      <div className="seg" role="tablist" aria-label="Time horizon">
        {(
          [
            ['plan', '6 months'],
            ['quarter', '3-month checkpoint'],
            ['block', 'This block'],
            ['week', 'This week'],
          ] as [Horizon, string][]
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={horizon === key} onClick={() => setHorizon(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="xsmall muted">
        Pace from {shortDate(range.start)} to {shortDate(range.end)}
      </div>

      {goals.map((g) => {
        const pace = view.goalPace(g, plan, range);
        const typeLabel = g.type === 'number' ? 'Number' : g.type === 'practice' ? 'Practice' : 'Finish';
        const p = pace.progress;
        const share = p && p.planned ? p.actual / p.planned : pace.number && g.target_value != null && pace.number.trend != null
          ? Math.min(1, Math.abs(pace.number.trend - pace.number.start.value) / Math.max(0.1, Math.abs(g.target_value - pace.number.start.value)))
          : 0;
        return (
          <a key={g.id} className="card stack-sm" href={href(`/goals/${g.id}`)} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row-between">
              <b style={{ fontSize: 15 }}>{g.title}</b>
              <span className="pill none">{typeLabel}</span>
            </div>
            <div className="row-between small">
              <span>{pace.summary}</span>
              <PacePill label={pace.label} />
            </div>
            <Bar value={share} color={g.color} />
            {g.why && <div className="xsmall muted" style={{ fontStyle: 'italic' }}>"{g.why}"</div>}
          </a>
        );
      })}
      {goals.length === 0 && <Empty title="No goals in this plan yet." />}

      <a className="btn primary" href={href(`/goals/new?plan=${plan.id}`)}>
        + Add a goal
      </a>
      {otherGoals.length > 0 && (
        <div className="card tight stack-sm">
          <button className="link-btn small" style={{ textAlign: 'left' }} onClick={() => setLinking(!linking)}>
            {linking ? 'Done' : 'Share an existing goal with this plan'}
          </button>
          {linking &&
            otherGoals.map((g) => (
              <button key={g.id} className="btn small" onClick={() => commit(opsLinkGoalToPlan(data, g.id, plan.id))}>
                + {g.title}
              </button>
            ))}
        </div>
      )}
      {goals.length >= 4 && (
        <p className="xsmall muted" style={{ textAlign: 'center' }}>
          Tip: most people stick with 3–4 goals at first. Add more once checking in is a habit.
        </p>
      )}
    </div>
  );
}

