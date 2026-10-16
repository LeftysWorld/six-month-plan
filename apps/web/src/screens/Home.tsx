import { useState } from 'react';
import {
  blockIndex,
  blockRange,
  longDate,
  planDayNumber,
  planTotalDays,
  planTotalWeeks,
  planWeekNumber,
  quarterRange,
  shortDate,
  valueOnPath,
  weeklyRateOnPath,
  type DateRange,
  type Goal,
  type Plan,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView, type GoalPace, type View } from '../data/derive.ts';
import { href } from '../router.ts';
import { Icon, PaceBar, PacePill } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { PlanForm } from './Plans.tsx';

export function Home() {
  const view = useView();
  const { data, today } = useStore();
  const plan = view.mainPlan;
  const name = data.profile.display_name || '';

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <div className="small muted">
            {longDate(today)}
            {plan && plan.start_date <= today && ` · Week ${planWeekNumber(plan, today)} of ${planTotalWeeks(plan)}`}
          </div>
          <h1 style={{ marginTop: 2 }}>
            {greeting()}
            {name ? `, ${name}` : ''}
          </h1>
        </div>
        <a href={href('/settings')} aria-label="Settings" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
          <Icon name="gear" />
        </a>
      </div>
      {!plan && <FirstPlan />}
      {plan && plan.start_date > today && <Upcoming plan={plan} />}
      {plan && plan.start_date <= today && <Dashboard plan={plan} view={view} />}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

function FirstPlan() {
  return (
    <>
      <div className="card dark stack-sm">
        <h2 style={{ color: '#fff' }}>Start with one plan and one goal.</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Six months from today, what do you want to be true? Add one goal now; add the rest over your first week.
        </p>
      </div>
      <PlanForm />
    </>
  );
}

function Upcoming({ plan }: { plan: Plan }) {
  const { today } = useStore();
  return (
    <div className="card stack-sm">
      <h2>{plan.name} starts {shortDate(plan.start_date)}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        In {Math.max(0, Math.round((Date.parse(plan.start_date) - Date.parse(today)) / 86_400_000))} days. Add goals now so day one is ready.
      </p>
      <a className="btn primary" href={href(`/plans/${plan.id}`)}>
        Open plan
      </a>
    </div>
  );
}

function Dashboard({ plan, view }: { plan: Plan; view: View }) {
  const { today } = useStore();
  const goals = view.goalsForPlan(plan.id);
  const early = view.tooEarly(plan);
  const block = blockRange(plan, blockIndex(plan, today));
  const blockPaces = goals.map((g) => view.goalPace(g, plan, { start: block.start, end: today }));
  const horizons = view.horizons(plan);
  // Today is still in progress, so the headline judges the other four horizons.
  const judged = horizons.filter((h) => h.key !== 'today' && h.progress.label !== 'none');
  const onPace = judged.filter((h) => h.progress.label !== 'behind');
  const numberGoal = goals.find((g) => g.type === 'number');

  const todaySessions = view.sessionsOn(today);
  const left = todaySessions.filter((s) => s.status === 'planned');
  const next = [...left].sort((a, b) => Number(b.priority) - Number(a.priority))[0];

  const behindLabels = blockPaces.filter((p) => p.label === 'behind');
  const aheadLabels = blockPaces.filter((p) => p.label === 'ahead' || p.label === 'on_track');
  const status =
    early || judged.length === 0
      ? { title: 'Nothing to judge yet. Just start.', sentence: 'Pace shows up after your first week. Today counts if you do one thing on the list.', behind: false }
      : {
          title: onPace.length === judged.length ? 'On track' : onPace.length >= judged.length / 2 ? 'Mostly on track' : 'Behind, and fixable',
          sentence: statusSentence(aheadLabels, behindLabels),
          behind: onPace.length < judged.length,
        };

  return (
    <>
      <div className="card dark stack">
        <div className="row-start" style={{ gap: 10 }}>
          <span className={`status-dot ${status.behind ? 'behind' : ''}`} />
          <h2 style={{ color: '#fff', fontSize: 19 }}>{status.title}</h2>
          {!early && judged.length > 0 && (
            <span className="xsmall muted" style={{ marginLeft: 'auto' }}>
              {onPace.length} of {judged.length} horizons
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: '#dce3df' }}>{status.sentence}</p>
        <a className="up-next" href={href('/today')}>
          <span className="small">
            {next ? (
              <>
                <b>Up next:</b> {next.title} · {minutesText(next.planned_minutes)}
              </>
            ) : todaySessions.length ? (
              <b>Today's list is done.</b>
            ) : (
              <b>Nothing planned today.</b>
            )}
          </span>
          <span className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
            {left.length > 0 && `${left.length} left`} <Icon name="chevron" size={16} />
          </span>
        </a>
      </div>

      {numberGoal && <WeightCard goal={numberGoal} plan={plan} view={view} />}

      <div className="card">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="label">Plan vs actual</span>
          <span className="xsmall muted" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 2, height: 11, background: 'var(--ink)', display: 'inline-block' }} />
            should be here today
          </span>
        </div>
        {horizons.map((h) => (
          <a key={h.key} className="horizon" href={href(h.key === 'today' ? '/today' : h.key === 'week' ? '/review' : h.key === 'plan' ? '/plans' : `/plans/${plan.id}`)} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {h.name} <span className="xsmall muted" style={{ fontWeight: 400 }}>· {h.detail}</span>
            </div>
            <div className="row-start" style={{ flexWrap: 'nowrap' }}>
              <span className="num" style={{ fontSize: 14 }}>
                {fmt(h.progress.actual)} / {h.progress.planned}
              </span>
              <PacePill
                label={h.progress.label}
                text={h.progress.label === 'behind' ? `Behind ${fmt(h.progress.expected - h.progress.actual)}` : undefined}
              />
            </div>
            <PaceBar progress={h.progress} />
          </a>
        ))}
      </div>

      {blockPaces.length > 0 && (
        <div className="card stack-sm">
          <div className="row-between">
            <span className="label">Goals · pace this block</span>
            <a href={href('/progress')} className="small strong" style={{ textDecoration: 'none', minHeight: 36, display: 'flex', alignItems: 'center' }}>
              All progress ›
            </a>
          </div>
          <div className="grid-2">
            {blockPaces.map((p) => (
              <a key={p.goal.id} className="goal-chip" href={href(`/goals/${p.goal.id}`)}>
                <span className="dot" style={{ background: p.goal.color }} />
                <div style={{ minWidth: 0 }}>
                  <b>{p.goal.title}</b>
                  <PacePill label={p.label} />
                </div>
              </a>
            ))}
          </div>
          <span className="xsmall muted">Block {blockIndex(plan, today) + 1}: {shortDate(block.start)} – {shortDate(block.end)}</span>
        </div>
      )}

      {goals.length === 0 && (
        <a className="btn primary" href={href(`/goals/new?plan=${plan.id}`)}>
          Add your first goal
        </a>
      )}
      <p className="xsmall muted" style={{ textAlign: 'center' }}>
        Day {planDayNumber(plan, today)} of {planTotalDays(plan)}
      </p>
    </>
  );
}

function statusSentence(onPace: GoalPace[], behind: GoalPace[]): string {
  const names = (list: GoalPace[]) => {
    const t = list.slice(0, 2).map((p) => p.goal.title);
    return t.length === 2 ? `${t[0]} and ${t[1]}` : t[0] ?? '';
  };
  if (behind.length === 0) return `${names(onPace) || 'Everything'} ${onPace.length === 1 ? 'is' : 'are'} on pace. Keep the streak of showing up going.`;
  const behindText = `${names(behind)}${behind.length > 2 ? ` and ${behind.length - 2} more` : ''} ${behind.length === 1 ? 'is' : 'are'} behind this block.`;
  return onPace.length ? `${names(onPace)} ${onPace.length === 1 ? 'is' : 'are'} on pace. ${behindText} A couple of short sessions closes the gap.` : `${behindText} Try the minimum versions this week.`;
}

type Range = 'block' | '3mo' | '6mo';

function WeightCard({ goal, plan, view }: { goal: Goal; plan: Plan; view: View }) {
  const { today } = useStore();
  const [range, setRange] = useState<Range>('6mo');
  const pace = view.goalPace(goal, plan);
  const status = pace.number!;
  const path = view.pathFor(goal);
  const readings = view.measurementsFor(goal.measurement_type_id);
  const block = blockRange(plan, blockIndex(plan, today));
  const quarter = quarterRange(plan, today);
  const end = goal.target_date && goal.target_date > plan.end_date ? goal.target_date : plan.end_date;
  const ranges: Record<Range, DateRange> = {
    block,
    '3mo': quarter,
    '6mo': { start: status.start.date < plan.start_date ? status.start.date : plan.start_date, end },
  };
  const unit = goal.unit ?? '';
  const checkpointDate = quarterRange(plan, plan.start_date).end;
  const weekly = weeklyRateOnPath(status.start, path, today);
  const daysTracked = readings.length ? Math.max(1, (Date.parse(today) - Date.parse(readings[0]!.measured_on)) / 86_400_000) : 0;
  const perWeek = status.changeSoFar != null && daysTracked >= 7 ? (status.changeSoFar / daysTracked) * 7 : null;
  const toCheckpoint = status.trend != null ? Math.abs(status.trend - valueOnPath(status.start, path, checkpointDate)) : null;

  return (
    <div className="card stack-sm">
      <div className="row-between">
        <div className="row-start" style={{ gap: 7, flexWrap: 'nowrap' }}>
          <span className="dot" style={{ background: goal.color }} />
          <a className="label" href={href(`/goals/${goal.id}`)} style={{ color: 'var(--ink)', textDecoration: 'none', minHeight: 36, display: 'flex', alignItems: 'center' }}>
            {goal.title} · path ›
          </a>
        </div>
        <div
          className="seg"
          role="tablist"
          aria-label="Chart range"
          style={{ flex: 'none' }}
        >
          {(['block', '3mo', '6mo'] as Range[]).map((r) => (
            <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
              {r === 'block' ? 'Block' : r === '3mo' ? '3 mo' : '6 mo'}
            </button>
          ))}
        </div>
      </div>
      <div className="row-between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="num" style={{ fontSize: 34, lineHeight: 1 }}>
            {status.latest != null ? fmt(status.latest) : '–'}
            <span style={{ fontSize: 15, color: 'var(--muted)', fontWeight: 500 }}> {unit}</span>
          </div>
          <div className="xsmall muted" style={{ marginTop: 4 }}>
            {status.trend != null ? `7-day trend ${fmt(status.trend)} · path today ${fmt(status.pathToday)}` : 'Log a reading to start the line'}
          </div>
        </div>
        {status.aheadBy != null && status.label !== 'none' && (
          <PacePill
            label={status.aheadBy >= 0 ? 'ahead' : 'behind'}
            text={status.aheadBy >= 0 ? `${fmt(status.aheadBy)} ${unit} ahead of path` : `${fmt(-status.aheadBy)} ${unit} behind path`}
          />
        )}
      </div>
      <WeightChart
        start={status.start}
        path={path}
        readings={readings}
        range={ranges[range]}
        today={today}
        unit={unit}
        color={goal.color}
        markers={[
          { date: checkpointDate, label: `Checkpoint ${fmt(valueOnPath(status.start, path, checkpointDate))}` },
          ...(goal.target_date && goal.target_value != null ? [{ date: goal.target_date, label: `Goal ${fmt(goal.target_value)}` }] : []),
        ]}
      />
      <div className="kpis">
        <div>
          <b>{status.changeSoFar != null ? `${status.changeSoFar > 0 ? '+' : ''}${fmt(status.changeSoFar)}` : '–'}</b>
          <span>since {shortDate(status.start.date)}</span>
        </div>
        <div>
          <b>{perWeek != null ? `${perWeek > 0 ? '+' : ''}${fmt(perWeek)}` : '–'}</b>
          <span>per week, avg</span>
        </div>
        <div>
          <b>{toCheckpoint != null ? `${fmt(toCheckpoint)} ${unit}` : '–'}</b>
          <span>to checkpoint · {shortDate(checkpointDate)}</span>
        </div>
      </div>
      {perWeek != null && Math.abs(perWeek) > Math.abs(weekly) * 1.5 && (
        <div className="note-box">
          Early weeks often move faster than they last. The plan asks for {fmt(Math.abs(weekly))} {unit} a week, so a slower week ahead is
          still on track.
        </div>
      )}
      {readings.length === 0 && (
        <div className="note-box">Add a reading from the goal page or the weekly review to see your line.</div>
      )}
    </div>
  );
}
