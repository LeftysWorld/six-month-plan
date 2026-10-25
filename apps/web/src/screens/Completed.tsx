import { daysBetween, minutesDone, sessionCredit, shortDate, type Goal } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView } from '../data/derive.ts';
import { opsReopenGoal } from '../data/ops.ts';
import { actionLookup } from '../data/insights.ts';
import { href } from '../router.ts';
import { useToast } from '../components/ui.tsx';
import { GoalsSwitch } from './Backlog.tsx';

/** Goals you finished, newest first, with what it took. */
export function Completed() {
  const { data } = useStore();
  const goals = data.goals
    .filter((g) => g.completed_at && !g.archived_at)
    .sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : -1));
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {goals.length} goal{goals.length === 1 ? '' : 's'} finished
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Completed</h1>
      <GoalsSwitch current="completed" />
      {goals.length === 0 ? (
        <div className="card small" style={{ color: 'var(--ink-2)' }}>
          Goals you finish land here, with what it took. Mark a goal complete from its page, or rate it Achieved in the plan retrospective.
        </div>
      ) : (
        <div className="goal-list">
          {goals.map((g) => (
            <CompletedCard key={g.id} goal={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompletedCard({ goal }: { goal: Goal }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const lookup = actionLookup(data);
  const sessions = view.sessionsForGoal(goal.id).filter((s) => s.status !== 'planned' && s.status !== 'moved');
  const done = Math.round(sessions.reduce((sum, s) => sum + sessionCredit(s), 0));
  const minutes = sessions.reduce((sum, s) => sum + minutesDone(s, lookup(s.action_id)), 0);
  const plan = view.plansForGoal(goal.id)[0];
  const started = plan?.start_date ?? goal.baseline_date;
  const finished = goal.completed_at!.slice(0, 10);
  const idea = data.ideas.find((i) => i.goal_id === goal.id);
  const latest = goal.type === 'number' ? view.measurementsFor(goal.measurement_type_id).at(-1) : undefined;
  return (
    <div className="tile" style={{ gap: 10 }}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
        <a href={href(`/goals/${goal.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--ink)', textDecoration: 'none', minWidth: 0 }}>
          <span className="dot" style={{ width: 9, height: 9, flex: 'none', background: goal.color }} />
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>{goal.title}</span>
        </a>
        <span className="mono" style={{ flex: 'none', paddingTop: 4 }}>
          {shortDate(finished).toUpperCase()}
        </span>
      </div>
      {(goal.done_means || goal.target_value != null) && (
        <span className="small" style={{ color: 'var(--ink-2)' }}>
          {goal.type === 'number' && goal.target_value != null ? `Target ${fmt(goal.target_value)} ${goal.unit ?? ''}${latest ? ` · ended at ${fmt(latest.value)}` : ''}` : goal.done_means}
        </span>
      )}
      {goal.completion_note && <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.45 }}>“{goal.completion_note}”</p>}
      <div className="kpis">
        <div>
          <b>{done}</b>
          <span>tasks done</span>
        </div>
        <div>
          <b>{minutes ? minutesText(minutes) : '–'}</b>
          <span>time put in</span>
        </div>
        <div>
          <b>{started ? `${Math.max(1, Math.round(daysBetween(started, finished) / 7))} wk` : '–'}</b>
          <span>start to finish</span>
        </div>
      </div>
      <div className="row-between" style={{ gap: 8 }}>
        <span className="xsmall muted">{idea ? 'Started from your backlog' : plan ? plan.name : ''}</span>
        <button
          type="button"
          className="link-btn small"
          onClick={() => {
            commit(opsReopenGoal(data, goal));
            toast(`${goal.title} is active again`);
          }}
        >
          Reopen
        </button>
      </div>
    </div>
  );
}
