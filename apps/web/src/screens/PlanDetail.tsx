import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  addDays,
  blockCount,
  blockIndex,
  blockRange,
  daysBetween,
  planDayNumber,
  planTotalDays,
  planTotalWeeks,
  planWeekNumber,
  progressFor,
  quarterRange,
  sessionCredit,
  shortDate,
  valueOnPath,
  weekDates,
  weekStart,
  weekdayName,
  type Goal,
  type ISODate,
  type Plan,
  type Session,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView, type View } from '../data/derive.ts';
import { opsArchivePlan, opsLinkGoalToPlan, opsToggleMilestone } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { BackLink, Empty, Icon, PaceBar, PacePill } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';

type Horizon = 'plan' | 'quarter' | 'block' | 'week';

const TABS: [Horizon, string][] = [
  ['plan', '6 months'],
  ['quarter', '3 months'],
  ['block', 'Block'],
  ['week', 'Week'],
];

export function PlanDetail({ id }: { id: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const plan = view.plan(id);
  const [horizon, setHorizon] = useState<Horizon>('plan');
  const [linking, setLinking] = useState(false);
  if (!plan) return <Empty title="Plan not found." />;

  const goals = view.goalsForPlan(plan.id);
  const started = plan.start_date <= today;
  // The date each view is drawn around: today, clamped to the plan.
  const ref = started ? (today > plan.end_date ? plan.end_date : today) : plan.start_date;
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
          {started && ` · week ${planWeekNumber(plan, ref)} of ${planTotalWeeks(plan)}`}
        </div>
      </div>
      <div className="seg" role="tablist" aria-label="Time horizon">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={horizon === key} onClick={() => setHorizon(key)}>
            {label}
          </button>
        ))}
      </div>

      {goals.length === 0 ? (
        <Empty title="No goals in this plan yet." />
      ) : horizon === 'plan' ? (
        <SixMonthView plan={plan} goals={goals} refDate={ref} view={view} />
      ) : horizon === 'quarter' ? (
        <QuarterView plan={plan} goals={goals} refDate={ref} view={view} />
      ) : horizon === 'block' ? (
        <BlockView plan={plan} goals={goals} refDate={ref} view={view} />
      ) : (
        <WeekView plan={plan} refDate={ref} view={view} />
      )}

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
      {goals.length >= 5 && (
        <p className="xsmall muted" style={{ textAlign: 'center' }}>
          Tip: most people stick with 3–4 goals at first. Add more once checking in is a habit.
        </p>
      )}
    </div>
  );
}

interface ViewProps {
  plan: Plan;
  goals: Goal[];
  refDate: ISODate;
  view: View;
}

/** Sessions belonging to a goal's actions, including weeks not generated yet. */
function goalSessions(view: View, goal: Goal, range: { start: ISODate; end: ISODate }): Session[] {
  const actionIds = new Set(view.actionsForGoal(goal.id, true).map((a) => a.id));
  return view.projectedSessions(range).filter((s) => s.action_id && actionIds.has(s.action_id));
}

function inRange(s: Session, start: ISODate, end: ISODate): boolean {
  const d = s.date ?? s.week_start;
  return d >= start && d <= end;
}

function Hero({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="card dark stack-sm">
      <span className="xsmall" style={{ color: '#9fb3aa', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
        {eyebrow}
      </span>
      <h2 style={{ color: '#fff', fontSize: 22 }}>{title}</h2>
      {children}
    </div>
  );
}

// =====================================================================
// 6 months: a roadmap. Where each goal starts, where it is, where it ends.
// =====================================================================

function SixMonthView({ plan, goals, refDate, view }: ViewProps) {
  const total = planTotalDays(plan);
  const pos = (d: ISODate) => Math.min(100, Math.max(0, (daysBetween(plan.start_date, d) / Math.max(1, total - 1)) * 100));
  const blocks = Array.from({ length: blockCount(plan) }, (_, i) => blockRange(plan, i));
  const current = blockIndex(plan, refDate);
  const checkpoint = quarterRange(plan, plan.start_date).end;
  const daysLeft = Math.max(0, daysBetween(refDate, plan.end_date));
  const months = monthTicks(plan.start_date, plan.end_date);

  return (
    <>
      <Hero eyebrow="The whole plan" title={`Day ${planDayNumber(plan, refDate)} of ${total} · ${daysLeft} days left`}>
        <div style={{ position: 'relative', height: 58, marginTop: 6 }} role="img" aria-label={`Plan timeline: block ${current + 1} of ${blocks.length}, checkpoint ${shortDate(checkpoint)}`}>
          {blocks.map((b, i) => (
            <div
              key={b.start}
              title={`Block ${i + 1}: ${shortDate(b.start)} – ${shortDate(b.end)}`}
              style={{
                position: 'absolute',
                top: 14,
                height: 22,
                left: `${pos(b.start)}%`,
                width: `calc(${pos(b.end) - pos(b.start)}% - 3px)`,
                borderRadius: 6,
                background: i < current ? '#3c7f74' : i === current ? '#5FC4B4' : '#2c3833',
                color: i <= current ? '#0b1f1a' : '#9fb3aa',
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              B{i + 1}
            </div>
          ))}
          <div style={{ position: 'absolute', left: `calc(${pos(checkpoint)}% - 5px)`, top: 31, width: 10, height: 10, transform: 'rotate(45deg)', background: '#E9B45A', border: '2px solid #17201C' }} title="3-month checkpoint" />
          <div style={{ position: 'absolute', left: `calc(${pos(refDate)}% - 1px)`, top: 4, height: 42, width: 2, background: '#fff' }} />
          <span style={{ position: 'absolute', left: `${pos(refDate)}%`, top: -8, transform: 'translateX(-50%)', fontSize: 10, color: '#fff', fontWeight: 600 }}>Today</span>
          {months.map((m) => (
            <span key={m.date} style={{ position: 'absolute', left: `${pos(m.date)}%`, top: 42, fontSize: 10, color: '#9fb3aa', transform: 'translateX(-50%)' }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="row-start xsmall" style={{ color: '#c9d2cd', gap: 14 }}>
          <span className="row-start" style={{ gap: 5 }}>
            <span style={{ width: 9, height: 9, transform: 'rotate(45deg)', background: '#E9B45A', display: 'inline-block' }} /> 3-month checkpoint {shortDate(checkpoint)}
          </span>
          <span>Block {current + 1} of {blocks.length} now</span>
        </div>
      </Hero>

      <div className="section-label">Goal roadmap</div>
      {goals.map((g) => (
        <RoadmapLane key={g.id} goal={g} plan={plan} refDate={refDate} view={view} pos={pos} checkpoint={checkpoint} />
      ))}
    </>
  );
}

function RoadmapLane({
  goal,
  plan,
  refDate,
  view,
  pos,
  checkpoint,
}: {
  goal: Goal;
  plan: Plan;
  refDate: ISODate;
  view: View;
  pos: (d: ISODate) => number;
  checkpoint: ISODate;
}) {
  const { data } = useStore();
  const pace = view.goalPace(goal, plan);
  const milestones = data.milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  let summary: ReactNode = pace.summary;
  let markers: { date: ISODate; label?: string; filled: boolean; diamond?: boolean }[] = [];
  let fill = pos(refDate);
  let fillOpacity = 0.25;

  if (goal.type === 'number' && pace.number) {
    const n = pace.number;
    const path = view.pathFor(goal);
    const end = goal.target_date ?? plan.end_date;
    markers = [
      { date: checkpoint, label: fmt(valueOnPath(n.start, path, checkpoint)), filled: refDate >= checkpoint, diamond: true },
      { date: end, label: `${fmt(goal.target_value)} ${goal.unit ?? ''}`, filled: false },
    ];
    summary = (
      <>
        Start <b>{fmt(n.start.value)}</b> → now <b>{fmt(n.latest)}</b> → goal <b>{fmt(goal.target_value)}</b> {goal.unit}
      </>
    );
    const span = Math.abs((goal.target_value ?? n.start.value) - n.start.value) || 1;
    fillOpacity = 0.35;
    fill = n.trend != null ? Math.min(100, (Math.abs(n.trend - n.start.value) / span) * 100) : 0;
  } else if (goal.type === 'finish') {
    markers = milestones.map((m) => ({ date: m.due_date, filled: !!m.completed_at }));
    const done = milestones.filter((m) => m.completed_at).length;
    summary = (
      <>
        <b>{done}</b> of {milestones.length} milestones done
        {milestones.find((m) => !m.completed_at) ? ` · next: ${milestones.find((m) => !m.completed_at)!.title}, ${shortDate(milestones.find((m) => !m.completed_at)!.due_date)}` : ''}
      </>
    );
  } else {
    const sessions = goalSessions(view, goal, { start: plan.start_date, end: plan.end_date });
    const planned = sessions.filter((s) => s.status !== 'moved').length;
    const done = sessions.reduce((sum, s) => sum + sessionCredit(s), 0);
    markers = milestones.map((m) => ({ date: m.due_date, filled: !!m.completed_at, label: undefined }));
    summary = (
      <>
        <b>{fmt(done, 0)}</b> of {planned} sessions across the plan · {fmt(planned ? (done / planned) * 100 : 0, 0)}% complete
      </>
    );
  }

  return (
    <a className="card stack-sm" href={href(`/flow/${goal.id}`)} style={{ textDecoration: 'none', color: 'inherit' }} aria-label={`${goal.title}: open breakdown`}>
      <div className="row-between">
        <span className="row-start" style={{ gap: 7, flexWrap: 'nowrap' }}>
          <span className="dot" style={{ background: goal.color }} />
          <b style={{ fontSize: 15 }}>{goal.title}</b>
        </span>
        <PacePill label={pace.label} />
      </div>
      <div style={{ position: 'relative', height: 26 }} aria-hidden="true">
        <div style={{ position: 'absolute', left: 0, right: 0, top: 11, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${fill}%`, top: 11, height: 4, borderRadius: 2, background: goal.color, opacity: goal.type === 'practice' ? 1 : fillOpacity * 2.4 }} />
        <div style={{ position: 'absolute', left: `calc(${pos(refDate)}% - 1px)`, top: 3, height: 20, width: 2, background: 'var(--ink)' }} />
        {markers.map((m, i) => (
          <div key={`${m.date}-${i}`} style={{ position: 'absolute', left: `${pos(m.date)}%`, top: m.diamond ? 7 : 6, transform: 'translateX(-50%)' }}>
            <div
              style={{
                width: m.diamond ? 10 : 12,
                height: m.diamond ? 10 : 12,
                borderRadius: m.diamond ? 2 : '50%',
                transform: m.diamond ? 'rotate(45deg)' : undefined,
                background: m.filled ? goal.color : '#fff',
                border: `2px solid ${goal.color}`,
              }}
            />
          </div>
        ))}
      </div>
      {markers.some((m) => m.label) && (
        <div style={{ position: 'relative', height: 14, marginTop: -6 }}>
          {markers
            .filter((m) => m.label)
            .map((m) => (
              <span
                key={m.date}
                className="xsmall"
                style={{ position: 'absolute', left: `${pos(m.date)}%`, transform: pos(m.date) > 85 ? 'translateX(-100%)' : 'translateX(-50%)', color: 'var(--muted)', whiteSpace: 'nowrap' }}
              >
                {m.label}
              </span>
            ))}
        </div>
      )}
      <div className="row-between small" style={{ alignItems: 'flex-end' }}>
        <span>{summary}</span>
        <span className="xsmall strong" style={{ color: 'var(--accent)', whiteSpace: 'nowrap' }}>Breakdown ›</span>
      </div>
    </a>
  );
}

function monthTicks(start: ISODate, end: ISODate): { date: ISODate; label: string }[] {
  const out: { date: ISODate; label: string }[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  for (let i = 1; i < 9; i++) {
    const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1)).toISOString().slice(0, 10);
    if (d > end) break;
    out.push({ date: d, label: shortDate(d).split(' ')[0]! });
  }
  return out;
}

// =====================================================================
// 3 months: the checkpoint. What must be true by then, and what it takes.
// =====================================================================

function QuarterView({ plan, goals, refDate, view }: ViewProps) {
  const { data, commit, today } = useStore();
  const q = quarterRange(plan, refDate);
  const totalDays = daysBetween(q.start, q.end) + 1;
  const elapsed = Math.min(totalDays, Math.max(0, daysBetween(q.start, refDate) + 1));
  const daysLeft = Math.max(0, daysBetween(refDate, q.end));
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  const pct = elapsed / totalDays;
  const circumference = 2 * Math.PI * 30;

  return (
    <>
      <Hero eyebrow="3-month checkpoint" title={`${shortDate(q.end)} · ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} to go`}>
        <div className="row-start" style={{ gap: 16, flexWrap: 'nowrap' }}>
          <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${Math.round(pct * 100)}% of this 3-month stretch gone`}>
            <circle cx="38" cy="38" r="30" fill="none" stroke="#2c3833" strokeWidth="8" />
            <circle cx="38" cy="38" r="30" fill="none" stroke="#E9B45A" strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct)} transform="rotate(-90 38 38)" />
            <text x="38" y="43" textAnchor="middle" fontFamily="Space Grotesk" fontSize="16" fontWeight="600" fill="#fff">
              {Math.round(pct * 100)}%
            </text>
          </svg>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: '#dce3df' }}>
            {shortDate(q.start)} to {shortDate(q.end)}. Day {elapsed} of {totalDays}. Below is what each goal needs to look like by the checkpoint.
          </p>
        </div>
      </Hero>

      <div className="section-label">By {shortDate(q.end)}</div>
      {goals.map((g) => {
        const pace = view.goalPace(g, plan);
        if (g.type === 'number' && pace.number) {
          const n = pace.number;
          const path = view.pathFor(g);
          const target = valueOnPath(n.start, path, q.end);
          const current = n.trend ?? n.start.value;
          const direction = Math.sign((g.target_value ?? target) - n.start.value) || -1;
          const remaining = (target - current) * direction;
          const perWeekNeeded = remaining / weeksLeft;
          const span = Math.abs(target - n.start.value) || 1;
          const share = Math.min(1, Math.max(0, Math.abs(current - n.start.value) / span));
          return (
            <CheckpointCard key={g.id} goal={g} label={pace.label}>
              <div className="row-between" style={{ alignItems: 'baseline' }}>
                <span className="num" style={{ fontSize: 26 }}>
                  {fmt(target)} <span className="small muted" style={{ fontWeight: 400 }}>{g.unit} target</span>
                </span>
                <span className="small muted">now {fmt(current)}</span>
              </div>
              <div className="bar" aria-label={`${Math.round(share * 100)}% of the way to the checkpoint`} role="img">
                <div className="fill" style={{ width: `${share * 100}%`, background: g.color }} />
              </div>
              <div className="small">
                {remaining <= 0 ? (
                  <>Already past the checkpoint target by {fmt(-remaining)} {g.unit}. Hold steady.</>
                ) : (
                  <>
                    <b>{fmt(remaining)} {g.unit}</b> to go · about <b>{fmt(Math.abs(perWeekNeeded))} {g.unit} a week</b> for {weeksLeft} weeks
                  </>
                )}
              </div>
            </CheckpointCard>
          );
        }
        if (g.type === 'finish') {
          const ms = data.milestones
            .filter((m) => m.goal_id === g.id && m.due_date <= q.end)
            .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
          const done = ms.filter((m) => m.completed_at).length;
          return (
            <CheckpointCard key={g.id} goal={g} label={pace.label}>
              <div className="small">
                <b>{done}</b> of {ms.length} milestones due by the checkpoint are done
              </div>
              {ms.length === 0 && <span className="small muted">No milestones fall in this stretch.</span>}
              {ms.map((m) => (
                <button
                  key={m.id}
                  className="list-row"
                  style={{ background: 'none', border: 0, borderTop: '1px solid var(--line-2)', width: '100%', textAlign: 'left', cursor: 'pointer', padding: '8px 0' }}
                  onClick={() => commit(opsToggleMilestone(m))}
                  aria-label={m.completed_at ? `${m.title} done, tap to reopen` : `Mark ${m.title} done`}
                >
                  <span className={`ring ${m.completed_at ? 'done' : ''}`} style={{ width: 22, height: 22, flex: 'none' }}>
                    {m.completed_at && <Icon name="check" size={12} stroke={3.2} />}
                  </span>
                  <span className="grow small" style={{ textDecoration: m.completed_at ? 'line-through' : undefined, color: m.completed_at ? 'var(--muted)' : undefined }}>
                    {m.title}
                  </span>
                  <span className="xsmall" style={{ color: !m.completed_at && m.due_date < today ? 'var(--amber-ink)' : 'var(--muted)' }}>
                    {shortDate(m.due_date)}
                    {!m.completed_at && m.due_date < today ? ' · past due' : ''}
                  </span>
                </button>
              ))}
            </CheckpointCard>
          );
        }
        // Practice goals: sessions across the stretch.
        const sessions = goalSessions(view, g, q).filter((s) => inRange(s, q.start, q.end));
        const progress = progressFor(sessions, q, { today, dayFraction: 0 });
        const remainingSessions = Math.max(0, progress.planned - progress.actual);
        return (
          <CheckpointCard key={g.id} goal={g} label={progress.label === 'none' ? pace.label : progress.label}>
            <div className="row-between" style={{ alignItems: 'baseline' }}>
              <span className="num" style={{ fontSize: 26 }}>
                {fmt(progress.actual, 0)} <span className="small muted" style={{ fontWeight: 400 }}>of {progress.planned} sessions</span>
              </span>
              <span className="small muted">{fmt(progress.expected, 0)} expected by now</span>
            </div>
            <PaceBar progress={progress} />
            <div className="small">
              <b>{fmt(remainingSessions, 0)}</b> sessions left · about <b>{fmt(remainingSessions / weeksLeft, 1)} a week</b> to finish the stretch
            </div>
          </CheckpointCard>
        );
      })}
    </>
  );
}

function CheckpointCard({ goal, label, children }: { goal: Goal; label: Parameters<typeof PacePill>[0]['label']; children: ReactNode }) {
  return (
    <div className="card stack-sm" style={{ borderLeft: `4px solid ${goal.color}` }}>
      <div className="row-between">
        <a href={href(`/goals/${goal.id}`)} className="strong" style={{ textDecoration: 'none', color: 'var(--ink)', fontSize: 15 }}>
          {goal.title}
        </a>
        <PacePill label={label} />
      </div>
      {children}
    </div>
  );
}

// =====================================================================
// Block: four weeks side by side, one row per habit.
// =====================================================================

function BlockView({ plan, goals, refDate, view }: ViewProps) {
  const { data, today } = useStore();
  const idx = blockIndex(plan, refDate);
  const b = blockRange(plan, idx);
  const weeks: ISODate[] = [];
  for (let m = weekStart(b.start); m <= b.end; m = addDays(m, 7)) weeks.push(m);
  const daysLeft = Math.max(0, daysBetween(refDate, b.end));
  const horizon = view.horizons(plan).find((h) => h.key === 'block')!;
  const goalIds = new Set(goals.map((g) => g.id));
  const actions = data.actions.filter(
    (a) => !a.archived_at && data.actionGoals.some((ag) => ag.action_id === a.id && goalIds.has(ag.goal_id)),
  );
  const sessions = view.projectedSessions(b);
  const numberGoals = goals.filter((g) => g.type === 'number');
  const milestones = data.milestones
    .filter((m) => goalIds.has(m.goal_id) && m.due_date >= b.start && m.due_date <= b.end)
    .sort((x, y) => (x.due_date < y.due_date ? -1 : 1));
  const thisMonday = weekStart(today);

  return (
    <>
      <Hero eyebrow={`Block ${idx + 1} of ${blockCount(plan)}`} title={`${shortDate(b.start)} – ${shortDate(b.end)} · ${daysLeft} days left`}>
        <div className="row-between small" style={{ color: '#dce3df' }}>
          <span>
            {fmt(horizon.progress.actual)} of {horizon.progress.planned} actions done
          </span>
          <PacePill label={horizon.progress.label} />
        </div>
        <div style={{ background: 'rgba(255,255,255,.08)', borderRadius: 4, padding: '6px 0 2px' }}>
          <PaceBar progress={horizon.progress} />
        </div>
      </Hero>

      <div className="section-label">Week by week</div>
      <div className="card" style={{ padding: '12px 10px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `minmax(78px, 1.2fr) repeat(${weeks.length}, minmax(0, 1fr))`, gap: 5, alignItems: 'center' }}>
          <span />
          {weeks.map((m, i) => (
            <span key={m} className="xsmall" style={{ textAlign: 'center', fontWeight: m === thisMonday ? 700 : 500, color: m === thisMonday ? 'var(--ink)' : 'var(--muted)' }}>
              W{i + 1}
              <span style={{ display: 'block', fontWeight: 400, fontSize: 10 }}>{shortDate(m)}</span>
            </span>
          ))}
          {actions.map((a) => {
            const color = view.goalsForAction(a.id)[0]?.color ?? 'var(--accent)';
            return (
              <BlockRow
                key={a.id}
                title={a.title}
                color={color}
                cells={weeks.map((m) => {
                  const list = sessions.filter(
                    (s) => s.action_id === a.id && s.status !== 'moved' && (s.date ? weekStart(s.date) === m : s.week_start === m) && (s.date ?? m) <= b.end,
                  );
                  return { monday: m, planned: list.length, done: list.reduce((sum, s) => sum + sessionCredit(s), 0), future: m > thisMonday };
                })}
              />
            );
          })}
        </div>
        <div className="row-start xsmall muted" style={{ gap: 12, marginTop: 10 }}>
          <span>Darker = more of the week done</span>
          <span>Dashed = coming up</span>
        </div>
      </div>

      {numberGoals.map((g) => {
        const pace = view.goalPace(g, plan);
        const n = pace.number!;
        const path = view.pathFor(g);
        const startVal = valueOnPath(n.start, path, b.start);
        const endVal = valueOnPath(n.start, path, b.end);
        return (
          <div key={g.id} className="card stack-sm" style={{ borderLeft: `4px solid ${g.color}` }}>
            <div className="row-between">
              <b>{g.title} · this block</b>
              <PacePill label={pace.label} />
            </div>
            <div className="grid-3" style={{ textAlign: 'center' }}>
              <Stat label="Block start" value={`${fmt(startVal)}`} />
              <Stat label="Now (7-day)" value={`${fmt(n.trend)}`} strong />
              <Stat label="Block target" value={`${fmt(endVal)}`} />
            </div>
          </div>
        );
      })}

      {milestones.length > 0 && (
        <div className="card stack-sm">
          <span className="label">Milestones this block</span>
          {milestones.map((m) => (
            <div key={m.id} className="list-row small">
              <span className={`ring ${m.completed_at ? 'done' : ''}`} style={{ width: 18, height: 18, flex: 'none' }}>
                {m.completed_at && <Icon name="check" size={10} stroke={3.2} />}
              </span>
              <span className="grow">{m.title}</span>
              <span className="xsmall muted">{shortDate(m.due_date)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BlockRow({ title, color, cells }: { title: string; color: string; cells: { monday: ISODate; planned: number; done: number; future: boolean }[] }) {
  return (
    <>
      <span className="row-start" style={{ gap: 6, flexWrap: 'nowrap', minWidth: 0, alignItems: 'flex-start' }}>
        <span className="dot" style={{ background: color, marginTop: 5 }} />
        <span style={{ fontSize: 12, lineHeight: 1.25 }}>{title}</span>
      </span>
      {cells.map((c) => {
        const ratio = c.planned ? Math.min(1, c.done / c.planned) : 0;
        return (
          <div
            key={c.monday}
            role="img"
            aria-label={c.future ? `${c.planned} planned` : `${fmt(c.done)} of ${c.planned} done`}
            style={{
              height: 40,
              borderRadius: 8,
              border: c.future ? `1.5px dashed ${color}` : '1px solid transparent',
              background: c.future || c.planned === 0 ? 'transparent' : tint(color, 0.14 + ratio * 0.76),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="xsmall" style={{ fontWeight: 600, color: !c.future && ratio >= 0.6 ? '#fff' : 'var(--ink)' }}>
              {c.planned === 0 ? '–' : c.future ? c.planned : `${fmt(c.done, 0)}/${c.planned}`}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** A hex colour at a given opacity, as rgba(). */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.min(1, Math.max(0, alpha)).toFixed(2)})`;
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="num" style={{ fontSize: strong ? 22 : 18, color: strong ? 'var(--ink)' : 'var(--ink-2)' }}>
        {value}
      </div>
      <div className="xsmall muted">{label}</div>
    </div>
  );
}

// =====================================================================
// Week: a day-by-day agenda you can log from.
// =====================================================================

function WeekView({ plan, refDate, view }: { plan: Plan; refDate: ISODate; view: View }) {
  const { data, today } = useStore();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Session | null>(null);
  const monday = addDays(weekStart(refDate), offset * 7);
  const days = weekDates(monday);
  const all = view.sessionsInWeek(monday).filter((s) => s.date);
  const tray = data.sessions.filter((s) => !s.date && s.week_start === monday && s.status === 'planned');
  const done = all.filter((s) => s.status !== 'planned').reduce((sum, s) => sum + sessionCredit(s), 0);
  const plannedMin = all.reduce((sum, s) => sum + s.planned_minutes, 0);
  const available = data.profile.available_minutes;
  const availableTotal = available.reduce((a, b) => a + b, 0);
  const canBack = addDays(monday, 6) >= plan.start_date;
  const canForward = monday <= plan.end_date;

  return (
    <>
      <Hero eyebrow={offset === 0 ? 'This week' : offset < 0 ? `${-offset} week${offset === -1 ? '' : 's'} ago` : `In ${offset} week${offset === 1 ? '' : 's'}`} title={`${shortDate(monday)} – ${shortDate(addDays(monday, 6))}`}>
        <div className="small" style={{ color: '#dce3df' }}>
          {fmt(done)} of {all.length + tray.length} done · {minutesText(plannedMin)} planned of {minutesText(availableTotal)} available
        </div>
        <div className="btn-row" style={{ marginTop: 4 }}>
          <button className="btn small" disabled={!canBack} onClick={() => setOffset(offset - 1)} style={{ background: '#2c3833', color: '#fff', borderColor: '#2c3833' }}>
            ‹ Previous week
          </button>
          {offset !== 0 && (
            <button className="btn small" onClick={() => setOffset(0)} style={{ background: '#2c3833', color: '#fff', borderColor: '#2c3833' }}>
              This week
            </button>
          )}
          <button className="btn small" disabled={!canForward} onClick={() => setOffset(offset + 1)} style={{ background: '#2c3833', color: '#fff', borderColor: '#2c3833' }}>
            Next week ›
          </button>
        </div>
      </Hero>

      {tray.length > 0 && (
        <div className="card tight stack-sm" style={{ borderStyle: 'dashed' }}>
          <span className="xsmall muted">Not placed on a day yet</span>
          <div className="chips" style={{ gap: 6 }}>
            {tray.map((s) => (
              <SessionChip key={s.id} session={s} color={view.colorFor(s)} onClick={() => setOpen(s)} />
            ))}
          </div>
        </div>
      )}

      <div className="stack-sm">
        {days.map((d, i) => {
          const list = all.filter((s) => s.date === d).sort((a, b) => Number(b.priority) - Number(a.priority));
          const minutes = list.reduce((sum, s) => sum + s.planned_minutes, 0);
          const over = minutes > (available[i] ?? 0);
          const isToday = d === today;
          const past = d < today;
          return (
            <div
              key={d}
              className="card tight"
              style={{
                display: 'grid',
                gridTemplateColumns: '52px minmax(0, 1fr)',
                gap: 10,
                borderColor: isToday ? 'var(--accent)' : undefined,
                boxShadow: isToday ? '0 0 0 1px var(--accent)' : undefined,
                opacity: past && list.every((s) => s.status !== 'planned') && list.length > 0 ? 0.85 : 1,
              }}
            >
              <div>
                <div className="strong" style={{ color: isToday ? 'var(--accent-ink)' : 'var(--ink)' }}>{weekdayName(d)}</div>
                <div className="num" style={{ fontSize: 20, lineHeight: 1.1 }}>{d.slice(8)}</div>
                {isToday && <div className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>Today</div>}
              </div>
              <div className="stack-sm" style={{ gap: 6 }}>
                <div className="chips" style={{ gap: 6 }}>
                  {list.map((s) => (
                    <SessionChip key={s.id} session={s} color={view.colorFor(s)} onClick={() => setOpen(s)} />
                  ))}
                  {list.length === 0 && <span className="small muted">Rest</span>}
                </div>
                {list.length > 0 && (
                  <span className="xsmall" style={{ color: over ? 'var(--amber-ink)' : 'var(--muted)', fontWeight: over ? 600 : 400 }}>
                    {minutesText(minutes)} of {minutesText(available[i] ?? 0)}
                    {over ? ' · over' : ''}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="row-start xsmall muted" style={{ gap: 12 }}>
        <LegendChip cls="done" text="Done" />
        <LegendChip cls="min" text="Minimum or partial" />
        <LegendChip cls="skip" text="Skipped" />
        <LegendChip cls="plan" text="Planned" />
      </div>
      {open && <LogSheet session={data.sessions.find((s) => s.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      <p className="xsmall muted" style={{ margin: 0 }}>
        Tap any session to log it or move it.
      </p>
    </>
  );
}

function chipStyle(status: Session['status'], color: string): CSSProperties {
  switch (status) {
    case 'done':
      return { background: `${color}1f`, border: `1px solid ${color}55`, color: 'var(--ink)' };
    case 'minimum':
    case 'partial':
      return { background: 'var(--amber-soft)', border: '1px solid #e9c98f', color: 'var(--amber-ink)' };
    case 'skipped':
      return { background: 'var(--line-2)', border: '1px solid var(--line)', color: 'var(--muted)', textDecoration: 'line-through' };
    default:
      return { background: '#fff', border: `1.5px dashed ${color}`, color: 'var(--ink)' };
  }
}

function SessionChip({ session, color, onClick }: { session: Session; color: string; onClick: () => void }) {
  const s = session;
  const icon = s.status === 'done' ? 'check' : s.status === 'minimum' || s.status === 'partial' ? 'minus' : s.status === 'skipped' ? 'x' : null;
  return (
    <button
      onClick={onClick}
      aria-label={`${s.title}, ${s.status === 'planned' ? 'planned' : s.status}`}
      style={{
        ...chipStyle(s.status, color),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        padding: '0 10px',
        minHeight: 34,
        borderRadius: 999,
        cursor: 'pointer',
      }}
    >
      {icon ? <Icon name={icon} size={12} stroke={3} /> : <span className="dot" style={{ background: color, width: 7, height: 7 }} />}
      {s.title}
      <span style={{ fontWeight: 400, opacity: 0.8 }}>{s.status === 'planned' ? s.planned_minutes : s.actual_minutes ?? ''}</span>
    </button>
  );
}

function LegendChip({ cls, text }: { cls: 'done' | 'min' | 'skip' | 'plan'; text: string }) {
  const style =
    cls === 'done'
      ? chipStyle('done', '#0E6B61')
      : cls === 'min'
        ? chipStyle('minimum', '#0E6B61')
        : cls === 'skip'
          ? chipStyle('skipped', '#0E6B61')
          : chipStyle('planned', '#0E6B61');
  return (
    <span className="row-start" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <span style={{ ...style, width: 14, height: 10, borderRadius: 5, display: 'inline-block', textDecoration: 'none' }} />
      {text}
    </span>
  );
}
