import { useState } from 'react';
import { addDays, chainAt, quarterRange, shortDate, weekStart, weekdayName, type DateRange, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { BackLink, Empty } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';

type Tab = 'body' | 'habits' | 'study';

export function Progress() {
  const view = useView();
  const plan = view.mainPlan;
  const [tab, setTab] = useState<Tab>('body');
  return (
    <div className="stack">
      <BackLink label="Review" fallback="/review" />
      <h1>All progress</h1>
      <div className="seg" role="tablist" aria-label="Area">
        {(['body', 'habits', 'study'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'body' ? 'Measurements' : t === 'habits' ? 'Habits' : 'Study'}
          </button>
        ))}
      </div>
      {!plan && <Empty title="Create a plan to see progress." />}
      {plan && tab === 'body' && <Body plan={plan} />}
      {plan && tab === 'habits' && <Habits />}
      {plan && tab === 'study' && <Study />}
    </div>
  );
}

function Body({ plan }: { plan: Plan }) {
  const { data, today } = useStore();
  const view = useView();
  const [range, setRange] = useState<'month' | '3mo' | '6mo'>('month');
  const numberGoals = view.goalsForPlan(plan.id).filter((g) => g.type === 'number');
  const ranges: Record<string, DateRange> = {
    month: (() => { const m = chainAt(plan, today).month; return { start: m.start, end: m.end }; })(),
    '3mo': quarterRange(plan, today),
    '6mo': { start: plan.start_date, end: plan.end_date },
  };
  const others = data.measurementTypes.filter((t) => !t.archived_at && !numberGoals.some((g) => g.measurement_type_id === t.id));
  return (
    <>
      {numberGoals.map((g) => {
        const pace = view.goalPace(g, plan);
        const status = pace.number!;
        return (
          <div key={g.id} className="card stack-sm">
            <div className="row-between">
              <span className="label">Results · {g.title}</span>
              <div className="seg" role="tablist" aria-label="Chart range">
                {(['month', '3mo', '6mo'] as const).map((r) => (
                  <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
                    {r === 'month' ? 'Month' : r === '3mo' ? '3 mo' : '6 mo'}
                  </button>
                ))}
              </div>
            </div>
            <div className="num" style={{ fontSize: 22 }}>
              {status.changeSoFar != null ? `${status.changeSoFar > 0 ? '+' : ''}${fmt(status.changeSoFar)} ${g.unit}` : 'No readings yet'}
              <span className="small muted" style={{ fontFamily: 'var(--body)', fontWeight: 400 }}>
                {' '}
                since {shortDate(status.start.date)} · path by today {fmt(status.pathToday - status.start.value)}
              </span>
            </div>
            <WeightChart
              start={status.start}
              path={view.pathFor(g)}
              readings={view.measurementsFor(g.measurement_type_id)}
              range={ranges[range]!}
              today={today}
              unit={g.unit ?? ''}
              color={g.color}
            />
            <WorkoutsBars range={ranges[range]!} />
            <span className="xsmall muted">Same dates on both charts, so weeks line up. It shows a pattern, not proof.</span>
          </div>
        );
      })}
      {others.length > 0 && (
        <div className="card stack-sm">
          <span className="label">Other measurements</span>
          <table className="table">
            <thead>
              <tr>
                <th>Measure</th>
                <th>Start</th>
                <th>Latest</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {others.map((t) => {
                const r = view.measurementsFor(t.id);
                const first = r[0];
                const last = r.at(-1);
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{first ? `${fmt(first.value)} ${t.unit}` : '–'}</td>
                    <td>{last ? `${fmt(last.value)} · ${shortDate(last.measured_on)}` : 'Not logged'}</td>
                    <td>{first && last ? `${last.value - first.value > 0 ? '+' : ''}${fmt(last.value - first.value)}` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {numberGoals.length === 0 && others.length === 0 && <Empty title="No measurements yet.">Add one from a goal page.</Empty>}
    </>
  );
}

/** Workouts per week on the same date range as the weight chart. */
function WorkoutsBars({ range }: { range: DateRange }) {
  const { data } = useStore();
  const workoutIds = new Set(data.actions.filter((a) => a.kind === 'workout').map((a) => a.id));
  if (workoutIds.size === 0) return null;
  const weeks: string[] = [];
  for (let m = weekStart(range.start); m <= range.end; m = addDays(m, 7)) weeks.push(m);
  const counts = weeks.map((m) => data.sessions.filter((s) => s.action_id && workoutIds.has(s.action_id) && s.week_start === m && (s.status === 'done' || s.status === 'minimum' || s.status === 'partial')).length);
  const max = Math.max(1, ...counts, ...weeks.map((m) => data.sessions.filter((s) => s.action_id && workoutIds.has(s.action_id) && s.week_start === m).length));
  return (
    <div className="stack-sm" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
      <span className="label">Actions · workouts per week</span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 54 }} role="img" aria-label={`Workouts per week: ${counts.join(', ')}`}>
        {counts.map((c, i) => (
          <div key={weeks[i]} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ width: '100%', height: Math.max(3, (c / max) * 40), background: c ? 'var(--accent)' : 'var(--line)', borderRadius: 4 }} />
            <span style={{ fontSize: 9, color: 'var(--muted)' }}>{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Habits() {
  const { data, today } = useStore();
  const view = useView();
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27));
  const actions = data.actions.filter((a) => !a.archived_at);
  return (
    <div className="card stack-sm">
      <span className="label">Last 4 weeks</span>
      <div className="heat" style={{ gridTemplateColumns: `86px repeat(28, minmax(0, 1fr))` }}>
        <span />
        {days.map((d, i) => (
          <span key={d} style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center' }}>
            {i % 7 === 0 ? weekdayName(d).slice(0, 1) : ''}
          </span>
        ))}
        {actions.map((a) => (
          <HeatRow key={a.id} name={a.title} cells={days.map((d) => cellFor(data.sessions.filter((s) => s.action_id === a.id && s.date === d), d, today))} color={view.goalsForAction(a.id)[0]?.color} />
        ))}
      </div>
      <div className="row-start xsmall muted" style={{ gap: 12 }}>
        <Legend cls="full" text="Full" />
        <Legend cls="min" text="Minimum or partial" />
        <Legend cls="skip" text="Skipped" />
        <Legend cls="none" text="Not logged" />
      </div>
      <span className="xsmall muted">Blank days had nothing scheduled. Gaps are grey, never red.</span>
    </div>
  );
}

function HeatRow({ name, cells, color }: { name: string; cells: string[]; color?: string }) {
  return (
    <>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span className="dot" style={{ background: color ?? 'var(--faint)', width: 6, height: 6 }} />
        {name}
      </span>
      {cells.map((c, i) => (
        <span key={i} className={`cell ${c}`} />
      ))}
    </>
  );
}

function cellFor(list: { status: string }[], date: string, today: string): string {
  if (list.length === 0) return 'future';
  if (list.some((s) => s.status === 'done')) return 'full';
  if (list.some((s) => s.status === 'minimum' || s.status === 'partial')) return 'min';
  if (list.some((s) => s.status === 'skipped')) return 'skip';
  return date < today ? 'none' : 'future';
}

function Legend({ cls, text }: { cls: string; text: string }) {
  return (
    <span className="row-start" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <span className={`cell ${cls}`} style={{ width: 12, height: 12, borderRadius: 3, display: 'inline-block' }} />
      {text}
    </span>
  );
}

function Study() {
  const { data, today } = useStore();
  const view = useView();
  const studyActions = data.actions.filter((a) => a.kind === 'study' && !a.archived_at);
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(weekStart(today), (i - 5) * 7));
  if (studyActions.length === 0) return <Empty title="No study actions yet.">Add one with the "Study" type from a goal.</Empty>;
  return (
    <>
      {studyActions.map((a) => {
        const goal = view.goalsForAction(a.id)[0];
        const rows = weeks.map((m) => {
          const list = data.sessions.filter((s) => s.action_id === a.id && s.week_start === m);
          return {
            m,
            planned: list.reduce((sum, s) => sum + s.planned_minutes, 0),
            done: list.reduce((sum, s) => sum + (s.status !== 'planned' ? s.actual_minutes ?? 0 : 0), 0),
          };
        });
        const max = Math.max(60, ...rows.map((r) => Math.max(r.planned, r.done)));
        const milestones = data.milestones.filter((m) => goal && m.goal_id === goal.id);
        return (
          <div key={a.id} className="card stack-sm">
            <div className="row-between">
              <span className="label">{a.title}</span>
              <span className="xsmall muted">
                {milestones.filter((m) => m.completed_at).length} of {milestones.length} milestones
              </span>
            </div>
            {rows.map((r) => (
              <div key={r.m} className="stack-sm" style={{ gap: 3 }}>
                <div className="row-between xsmall">
                  <span className="muted">Week of {shortDate(r.m)}</span>
                  <span>
                    {fmt(r.done / 60)} of {fmt(r.planned / 60)} h
                  </span>
                </div>
                <div className="bar">
                  <div className="fill" style={{ width: `${(r.done / max) * 100}%`, background: goal?.color }} />
                  <div className="tick" style={{ left: `calc(${(r.planned / max) * 100}% - 1px)` }} />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
