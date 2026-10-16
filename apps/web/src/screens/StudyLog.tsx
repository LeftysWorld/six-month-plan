import { useEffect, useState } from 'react';
import { weekStart } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import { opsLogSession, opsToggleMilestone } from '../data/ops.ts';
import { navigate } from '../router.ts';
import { BackLink, Bar, Empty, useToast } from '../components/ui.tsx';

interface TimerState {
  /** Seconds banked before the current run. */
  banked: number;
  /** When the current run started (ms), or null when paused. */
  runningSince: number | null;
}

/** A study timer that survives reloads and switching apps. */
function useStudyTimer(key: string) {
  const [state, setState] = useState<TimerState>(() => {
    try {
      return (JSON.parse(localStorage.getItem(key) ?? 'null') as TimerState) ?? { banked: 0, runningSince: Date.now() };
    } catch {
      return { banked: 0, runningSince: Date.now() };
    }
  });
  const [, tick] = useState(0);
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const seconds = state.banked + (state.runningSince ? Math.floor((Date.now() - state.runningSince) / 1000) : 0);
  const toggle = () =>
    setState((s) => (s.runningSince ? { banked: s.banked + Math.floor((Date.now() - s.runningSince) / 1000), runningSince: null } : { ...s, runningSince: Date.now() }));
  const clear = () => localStorage.removeItem(key);
  return { seconds, running: state.runningSince != null, toggle, clear };
}

export function StudyLog({ id }: { id: string }) {
  const { data, commit, today } = useStore();
  const view = useView();
  const toast = useToast();
  const session = data.sessions.find((s) => s.id === id);
  const timer = useStudyTimer(`six.study.${id}`);
  const [manual, setManual] = useState<number | null>(null);
  const [showManual, setShowManual] = useState(false);

  if (!session) return <Empty title="This session isn't here anymore." />;
  const goals = view.goalsForAction(session.action_id);
  const milestones = data.milestones
    .filter((m) => goals.some((g) => g.id === m.goal_id))
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const nextMilestone = milestones.find((m) => !m.completed_at);

  const monday = weekStart(today);
  const weekSessions = data.sessions.filter((s) => s.action_id === session.action_id && s.week_start === monday);
  const weekPlanned = weekSessions.reduce((sum, s) => sum + s.planned_minutes, 0);
  const weekDone = weekSessions.reduce((sum, s) => sum + (s.status !== 'planned' ? s.actual_minutes ?? 0 : 0), 0);
  const minutes = Math.round(timer.seconds / 60);
  const planned = session.planned_minutes || 60;
  const pct = Math.min(1, timer.seconds / 60 / planned);
  const r = 82;
  const circumference = 2 * Math.PI * r;

  function finish(total: number) {
    if (!session) return;
    const status = total >= planned ? 'done' : total > 0 ? 'partial' : 'skipped';
    commit(opsLogSession(session, { status, actual_minutes: total }));
    timer.clear();
    toast(`Logged ${total} min`);
    navigate('/today');
  }

  return (
    <div className="stack">
      <BackLink label="Today" fallback="/today" />
      <div>
        <h1>{session.title}</h1>
        {goals[0] && (
          <div className="small muted row-start" style={{ marginTop: 4 }}>
            <span className="dot" style={{ background: goals[0].color }} />
            {goals[0].title}
          </div>
        )}
      </div>
      <div className="card stack" style={{ alignItems: 'center', padding: '22px 16px' }}>
        <div style={{ position: 'relative', width: 190, height: 190 }}>
          <svg width="190" height="190" viewBox="0 0 190 190" role="img" aria-label={`${minutes} of ${planned} planned minutes`}>
            <circle cx="95" cy="95" r={r} fill="none" stroke="#E2E5DF" strokeWidth="12" />
            <circle
              cx="95"
              cy="95"
              r={r}
              fill="none"
              stroke={goals[0]?.color ?? '#7A6416'}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct)}
              transform="rotate(-90 95 95)"
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="num" style={{ fontSize: 40 }}>
              {String(Math.floor(timer.seconds / 60)).padStart(2, '0')}:{String(timer.seconds % 60).padStart(2, '0')}
            </div>
            <div className="small muted">of {planned} min planned</div>
          </div>
        </div>
        <div className="btn-row" style={{ width: '100%' }}>
          <button className="btn" onClick={timer.toggle}>
            {timer.running ? 'Pause' : 'Resume'}
          </button>
          <button className="btn primary" onClick={() => finish(minutes)}>
            Stop &amp; log {minutes} min
          </button>
        </div>
        {showManual ? (
          <form
            className="row-start"
            style={{ width: '100%', flexWrap: 'nowrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (manual != null) finish(manual);
            }}
          >
            <input className="input" type="number" min={0} placeholder="Minutes" aria-label="Minutes studied" value={manual ?? ''} onChange={(e) => setManual(e.target.value === '' ? null : Number(e.target.value))} />
            <button className="btn small" type="submit" style={{ minHeight: 44 }}>
              Log
            </button>
          </form>
        ) : (
          <button className="link-btn small" onClick={() => setShowManual(true)}>
            Studied without the timer? Enter minutes
          </button>
        )}
      </div>

      <div className="card tight stack-sm">
        <div className="row-between small">
          <b>This week</b>
          <span className="muted">
            {fmt(weekDone / 60)} of {fmt(weekPlanned / 60)} h
          </span>
        </div>
        <Bar value={weekPlanned ? weekDone / weekPlanned : 0} color={goals[0]?.color} />
        {nextMilestone && (
          <div className="row-between small">
            <span className="muted">Next milestone: {nextMilestone.title}</span>
            <button
              className="link-btn small"
              onClick={() => {
                commit(opsToggleMilestone(nextMilestone));
                toast(`${nextMilestone.title} complete`);
              }}
            >
              Mark done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
