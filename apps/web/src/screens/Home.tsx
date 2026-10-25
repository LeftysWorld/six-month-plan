import { useState, type ReactNode } from 'react';
import { chainAt, planDayNumber, planTotalDays, quarterRange, shortDate, valueOnPath, weeklyRateOnPath, type DateRange, type Goal, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView, type GoalPace, type View } from '../data/derive.ts';
import { checkInStreak } from '../data/habit.ts';
import { href } from '../router.ts';
import { PacePill } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { StreakDots } from './Today.tsx';

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
const paceWord = (label: string) => (label === 'behind' ? 'Behind' : label === 'ahead' ? 'Ahead' : label === 'none' ? 'Not yet' : 'On pace');

/**
 * Progress at a glance (shown at the top of Review): plan pace rings, the number goal's trend,
 * this week's tasks, the check-in streak, and plan vs actual for each horizon.
 */
export function ProgressBento({ plan }: { plan: Plan }) {
  const view = useView();
  const { today, data } = useStore();
  const goals = view.goalsForPlan(plan.id);
  const early = view.tooEarly(plan);
  const month = chainAt(plan, today).month;
  const monthPaces = goals.map((g) => view.goalPace(g, plan, { start: month.start, end: today }));
  const horizons = view.horizons(plan);
  // Today is still in progress, so the headline judges the other four horizons.
  const judged = horizons.filter((h) => h.key !== 'today' && h.progress.label !== 'none');
  const onPace = judged.filter((h) => h.progress.label !== 'behind');
  const numberGoal = goals.find((g) => g.type === 'number');

  const behindLabels = monthPaces.filter((p) => p.label === 'behind');
  const aheadLabels = monthPaces.filter((p) => p.label === 'ahead' || p.label === 'on_track');
  const status =
    early || judged.length === 0
      ? { title: 'Nothing to judge yet. Just start.', sentence: 'Pace shows up after your first week. Today counts if you do one thing on the list.' }
      : {
          title: onPace.length === judged.length ? 'On track' : onPace.length >= judged.length / 2 ? 'Mostly on track' : 'Behind, and fixable',
          sentence: shortSentence(aheadLabels.length, monthPaces.filter((p) => p.label !== 'none').length, behindLabels),
        };

  const ringOf = (key: string) => horizons.find((h) => h.key === key);
  const rings = (['plan', 'quarter', 'month'] as const).map((k) => ringOf(k)).filter(Boolean) as typeof horizons;
  const frac = (p: { actual: number; planned: number }) => (p.planned ? p.actual / p.planned : 0);
  const weekH = ringOf('week');

  const streak = checkInStreak(data.sessions, today);

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
                {h.key === 'plan' ? `Goals ${fmt(h.progress.actual)}/${h.progress.planned}` : `${h.key === 'quarter' ? '3 mo' : 'Month'} ${Math.round(frac(h.progress) * 100)}%`}
              </span>
            ))}
          </div>

        </div>

        {numberGoal && <WeightCard goal={numberGoal} plan={plan} view={view} />}

        <a className="tile" href={href('/today')}>
          <span className="label">This week</span>
          <div className="row-start" style={{ gap: 12, flexWrap: 'nowrap' }}>
            <Ring size={54} stroke={7} value={weekH ? frac(weekH.progress) : 0} color="var(--accent)" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="num" style={{ fontSize: 26, lineHeight: 1 }}>
                {weekH ? fmt(weekH.progress.actual) : 0}
                <span style={{ color: 'var(--muted)', fontSize: 17 }}>/{weekH?.progress.planned ?? 0}</span>
              </span>
              <span className="xsmall" style={{ color: 'var(--ink-2)' }}>tasks done</span>
            </div>
          </div>
        </a>

        <div className="tile">
          <div className="row-between">
            <span className="label">Check-ins</span>
            <span className="label">{streak.freezes} freeze{streak.freezes === 1 ? '' : 's'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="num" style={{ fontSize: 26, lineHeight: 1 }}>{streak.days}</span>
            <span className="xsmall" style={{ color: 'var(--ink-2)' }}>day{streak.days === 1 ? '' : 's'} running</span>
          </div>
          <StreakDots streak={streak} />
        </div>

      </div>

      <p className="mono" style={{ textAlign: 'center', margin: '6px 0 0' }}>
        Day {planDayNumber(plan, today)} of {planTotalDays(plan)}
      </p>
    </>
  );
}

/** One or two short lines for the pace tile, e.g. "4 of 6 goals on pace. Guitar and splits slipped this month." */
function shortSentence(onPace: number, judged: number, behind: GoalPace[]): string {
  const first = judged ? `${onPace} of ${judged} goals on pace.` : '';
  if (behind.length === 0) return `${first} Keep showing up.`.trim();
  const names = behind.slice(0, 2).map((p) => p.goal.title);
  const list = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
  return `${first} ${list}${behind.length > 2 ? ` and ${behind.length - 2} more` : ''} slipped this month.`.trim();
}

export function statusSentence(onPace: GoalPace[], behind: GoalPace[]): string {
  const names = (list: GoalPace[]) => {
    const t = list.slice(0, 2).map((p) => p.goal.title);
    return t.length === 2 ? `${t[0]} and ${t[1]}` : t[0] ?? '';
  };
  if (behind.length === 0) return `${names(onPace) || 'Everything'} ${onPace.length === 1 ? 'is' : 'are'} on pace. Keep the streak of showing up going.`;
  const behindText = `${names(behind)}${behind.length > 2 ? ` and ${behind.length - 2} more` : ''} ${behind.length === 1 ? 'is' : 'are'} behind this month.`;
  return onPace.length ? `${names(onPace)} ${onPace.length === 1 ? 'is' : 'are'} on pace. ${behindText} A couple of short tasks closes the gap.` : `${behindText} Try the minimum versions this week.`;
}

type Range = 'month' | '3mo' | '6mo';

function WeightCard({ goal, plan, view }: { goal: Goal; plan: Plan; view: View }) {
  const { today } = useStore();
  const [range, setRange] = useState<Range>('6mo');
  const pace = view.goalPace(goal, plan);
  const status = pace.number!;
  const path = view.pathFor(goal);
  const readings = view.measurementsFor(goal.measurement_type_id);
  const month = chainAt(plan, today).month;
  const quarter = quarterRange(plan, today);
  const end = goal.target_date && goal.target_date > plan.end_date ? goal.target_date : plan.end_date;
  const ranges: Record<Range, DateRange> = {
    month: { start: month.start, end: month.end },
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
          {(['month', '3mo', '6mo'] as Range[]).map((r) => (
            <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}>
              {r === 'month' ? 'Month' : r === '3mo' ? '3 mo' : '6 mo'}
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
