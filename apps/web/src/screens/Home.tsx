import { useState, type ReactNode } from 'react';
import {
  addDays,
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
  const initial = (name || 'You').trim().charAt(0).toUpperCase();
  const started = plan && plan.start_date <= today;

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {started ? `Week ${planWeekNumber(plan, today)} of ${planTotalWeeks(plan)} · Day ${planDayNumber(plan, today)}` : longDate(today)}
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>
        {greeting()}
        {name ? ',' : ''}
        {name && <br />}
        {name}
      </h1>
      {!plan && <FirstPlan />}
      {plan && plan.start_date > today && <Upcoming plan={plan} />}
      {plan && started && <Dashboard plan={plan} view={view} />}
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
        <h2>Start with one plan and one goal.</h2>
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

/** A progress ring. value 0..1. */
function Ring({ size, stroke, value, color, children }: { size: number; stroke: number; value: number; color: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--track)' }} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        style={{ stroke: color, transition: 'stroke-dashoffset 0.8s cubic-bezier(0.2,0.8,0.2,1)' }}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {children}
    </svg>
  );
}

const paceColor = (label: string) => (label === 'behind' ? 'var(--amber)' : label === 'ahead' ? 'var(--blue)' : 'var(--accent)');
const paceInk = (label: string) => (label === 'behind' ? 'var(--amber-ink)' : label === 'ahead' ? 'var(--blue-ink)' : label === 'none' ? 'var(--muted)' : 'var(--accent-ink)');
const paceWord = (label: string) => (label === 'behind' ? 'Behind' : label === 'ahead' ? 'Ahead' : label === 'none' ? 'Not yet' : 'On pace');

function Dashboard({ plan, view }: { plan: Plan; view: View }) {
  const { today, data } = useStore();
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
      ? { title: 'Nothing to judge yet. Just start.', sentence: 'Pace shows up after your first week. Today counts if you do one thing on the list.' }
      : {
          title: onPace.length === judged.length ? 'On track' : onPace.length >= judged.length / 2 ? 'Mostly on track' : 'Behind, and fixable',
          sentence: shortSentence(aheadLabels.length, blockPaces.filter((p) => p.label !== 'none').length, behindLabels),
        };

  const ringOf = (key: string) => horizons.find((h) => h.key === key);
  const rings = (['plan', 'quarter', 'block'] as const).map((k) => ringOf(k)).filter(Boolean) as typeof horizons;
  const frac = (p: { actual: number; planned: number }) => (p.planned ? p.actual / p.planned : 0);
  const weekH = ringOf('week');

  // Check-ins: days with anything logged, the last 14 days, and the current run.
  const logged = new Set(data.sessions.filter((s) => s.date && s.status !== 'planned' && s.status !== 'skipped' && s.status !== 'moved').map((s) => s.date!));
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  let run = 0;
  for (let d = logged.has(today) ? today : addDays(today, -1); logged.has(d); d = addDays(d, -1)) run++;

  return (
    <>
      <div className="bento" style={{ marginTop: 8 }}>
        <div className="tile wide">
          <div className="row-between" style={{ alignItems: 'center', gap: 16 }}>
            <div className="grow stack-sm" style={{ gap: 8 }}>
              <span className="label">Plan pace</span>
              <span style={{ fontSize: 26, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.035em' }}>{status.title}</span>
              <span className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.4 }}>{status.sentence}</span>
            </div>
            <div
              role="img"
              aria-label={rings.map((h) => `${h.name} ${Math.round(frac(h.progress) * 100)}% done, ${paceWord(h.progress.label).toLowerCase()}`).join('; ')}
              style={{ position: 'relative', width: 112, height: 112, flex: 'none' }}
            >
              {rings.map((h, i) => (
                <div key={h.key} style={{ position: 'absolute', inset: i * 13 }}>
                  <Ring size={112 - i * 26} stroke={9} value={frac(h.progress)} color={paceColor(h.progress.label)} />
                </div>
              ))}
            </div>
          </div>
          <div className="row-start" style={{ gap: 14 }}>
            {rings.map((h) => (
              <span key={h.key} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
                <span className="dot" style={{ width: 6, height: 6, background: paceColor(h.progress.label) }} />
                {h.key === 'plan' ? `Goals ${fmt(h.progress.actual)}/${h.progress.planned}` : `${h.key === 'quarter' ? '3 mo' : 'Block'} ${Math.round(frac(h.progress) * 100)}%`}
              </span>
            ))}
          </div>
          <a className="up-next" href={href('/today')} style={{ marginTop: 2 }}>
            <span className="small">
              {next ? (
                <>
                  <b>Up next</b> · {next.title}
                  {next.planned_minutes ? ` · ${minutesText(next.planned_minutes)}` : ''}
                </>
              ) : todaySessions.length ? (
                <b>Today's list is done.</b>
              ) : (
                <b>Nothing planned today.</b>
              )}
            </span>
            <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: 0.7, whiteSpace: 'nowrap' }}>
              {left.length > 0 && `${left.length} left`} <Icon name="chevron" size={16} />
            </span>
          </a>
        </div>

        {numberGoal && <WeightCard goal={numberGoal} plan={plan} view={view} />}

        <a className="tile" href={href('/review')}>
          <span className="label">This week</span>
          <div className="row-start" style={{ gap: 12, flexWrap: 'nowrap' }}>
            <Ring size={54} stroke={7} value={weekH ? frac(weekH.progress) : 0} color="var(--accent)" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="num" style={{ fontSize: 26, lineHeight: 1 }}>
                {weekH ? fmt(weekH.progress.actual) : 0}
                <span style={{ color: 'var(--muted)', fontSize: 17 }}>/{weekH?.progress.planned ?? 0}</span>
              </span>
              <span className="xsmall" style={{ color: 'var(--ink-2)' }}>sessions</span>
            </div>
          </div>
        </a>

        <div className="tile">
          <span className="label">Check-ins</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="num" style={{ fontSize: 26, lineHeight: 1 }}>{run}</span>
            <span className="xsmall" style={{ color: 'var(--ink-2)' }}>day{run === 1 ? '' : 's'} running</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }} role="img" aria-label={`Logged on ${last14.filter((d) => logged.has(d)).length} of the last 14 days`}>
            {last14.map((d) => (
              <span
                key={d}
                style={{
                  aspectRatio: '1',
                  borderRadius: 4,
                  background: logged.has(d) ? 'var(--accent)' : d === today ? 'transparent' : 'var(--track)',
                  boxShadow: d === today && !logged.has(d) ? 'inset 0 0 0 1.5px var(--accent-ink)' : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {blockPaces.length > 0 && (
          <div className="tile wide" style={{ padding: '8px 20px' }}>
            <div className="row-between" style={{ minHeight: 40 }}>
              <span className="label">Goals · this block</span>
              <a href={href('/progress')} className="label" style={{ textDecoration: 'none', color: 'var(--ink-2)' }}>
                All progress ›
              </a>
            </div>
            {blockPaces.map((p) => {
              const whole = view.goalPace(p.goal, plan).progress;
              const pct = whole && whole.planned ? Math.min(1, whole.actual / whole.planned) : 0;
              return (
                <a key={p.goal.id} href={href(`/goals/${p.goal.id}`)} className="list-row" style={{ gap: 12, minHeight: 50, padding: '8px 0' }}>
                  <span className="dot" style={{ width: 9, height: 9, background: p.goal.color, boxShadow: `0 0 12px ${p.goal.color}` }} />
                  <span className="grow" style={{ fontSize: 15, fontWeight: 520, letterSpacing: '-0.015em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.goal.title}
                  </span>
                  <span style={{ width: 56, height: 4, borderRadius: 2, background: 'var(--track)', position: 'relative', flex: 'none' }}>
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, width: `${Math.max(4, pct * 100)}%`, background: p.goal.color }} />
                  </span>
                  <span style={{ width: 58, textAlign: 'right', fontSize: 12.5, fontWeight: 550, color: paceInk(p.label) }}>{paceWord(p.label)}</span>
                </a>
              );
            })}
          </div>
        )}

        <div className="tile wide">
          <div className="row-between">
            <span className="label">Plan vs actual</span>
            <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
              <span style={{ width: 2, height: 11, background: 'var(--ink)', display: 'inline-block' }} />
              where you should be
            </span>
          </div>
          <div>
            {horizons.map((h) => (
              <a key={h.key} className="horizon" href={href(h.key === 'today' ? '/today' : h.key === 'week' ? '/review' : h.key === 'plan' ? '/plans' : `/plans/${plan.id}`)} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {h.name} <span className="xsmall muted" style={{ fontWeight: 400 }}>· {h.detail}</span>
                </div>
                <div className="row-start" style={{ flexWrap: 'nowrap' }}>
                  <span className="num" style={{ fontSize: 14 }}>
                    {fmt(h.progress.actual)}/{h.progress.planned}
                  </span>
                  <PacePill label={h.progress.label} text={h.progress.label === 'behind' ? `Behind ${fmt(h.progress.expected - h.progress.actual)}` : undefined} />
                </div>
                <PaceBar progress={h.progress} />
              </a>
            ))}
          </div>
        </div>
      </div>

      {goals.length === 0 && (
        <a className="btn primary" href={href(`/goals/new?plan=${plan.id}`)}>
          Add your first goal
        </a>
      )}
      <p className="mono" style={{ textAlign: 'center', margin: '6px 0 0' }}>
        Day {planDayNumber(plan, today)} of {planTotalDays(plan)}
      </p>
    </>
  );
}

/** One or two short lines for the pace tile, e.g. "4 of 6 goals on pace. Guitar and splits slipped this block." */
function shortSentence(onPace: number, judged: number, behind: GoalPace[]): string {
  const first = judged ? `${onPace} of ${judged} goals on pace.` : '';
  if (behind.length === 0) return `${first} Keep showing up.`.trim();
  const names = behind.slice(0, 2).map((p) => p.goal.title);
  const list = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
  return `${first} ${list}${behind.length > 2 ? ` and ${behind.length - 2} more` : ''} slipped this block.`.trim();
}

export function statusSentence(onPace: GoalPace[], behind: GoalPace[]): string {
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
    <div className="tile wide" style={{ gap: 8 }}>
      <div className="row-between">
        <div className="row-start" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
          <span className="dot" style={{ width: 7, height: 7, background: goal.color, boxShadow: `0 0 10px ${goal.color}` }} />
          <a
            className="label"
            href={href(`/goals/${goal.id}`)}
            style={{ textDecoration: 'none', minHeight: 36, display: 'block', lineHeight: '36px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {goal.title}
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
      <div className="row-between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 10 }}>
        <div>
          <div className="hero-num" style={{ fontSize: 60, lineHeight: 0.95, whiteSpace: 'nowrap' }}>
            {status.latest != null ? fmt(status.latest) : '–'}
            <span style={{ fontSize: 17, color: 'var(--muted)', fontWeight: 500, letterSpacing: 0 }}> {unit}</span>
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
