import { useState } from 'react';
import { daysBetween, minutesDone, sessionCredit, shortDate, type Attachment, type Goal, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { goalPrizes } from '../data/prizes.ts';
import { opsUpdateGoal } from '../data/ops.ts';
import { actionLookup } from '../data/insights.ts';
import { goalTrack } from '../data/season.ts';
import { href } from '../router.ts';
import { BackLink, Empty, useToast } from '../components/ui.tsx';
import { FileThumb } from '../components/Attachments.tsx';

/**
 * Then vs now: the page the whole plan is for. One card per goal — why it mattered, where you
 * started and where you are, what you actually did, the first and latest photo — and a box for your
 * own words. Open any time; the retrospective points here.
 */
export function ThenNow({ planId }: { planId?: string | null }) {
  const { data, today } = useStore();
  const view = useView();
  // Windows running now, plus ones that ended in the last four months (a retrospective looks back).
  const plans = [...view.livePlans, ...data.plans.filter((p) => !p.archived_at && p.end_date < today && daysBetween(p.end_date, today) <= 120)]
    .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const plan = (planId ? data.plans.find((p) => p.id === planId) : undefined) ?? plans[0] ?? null;
  // Every goal that has run in this window, finished ones included (archived ones are gone on purpose).
  const goals = plan ? view.goalsForPlan(plan.id, true).filter((g) => !g.archived_at) : [];
  const started = plan ? plan.start_date <= today : false;

  return (
    <div className="stack">
      <BackLink label="Review" fallback="/review" />
      <div className="row-between">
        <h1 style={{ margin: 0 }}>Then vs now</h1>
        {plan && goals.length > 0 && (
          <button className="btn small no-print" onClick={() => window.print()}>
            Save as PDF
          </button>
        )}
      </div>
      {!plan ? (
        <Empty title="Nothing to look back on yet." />
      ) : (
        <>
          <p className="small muted" style={{ marginTop: -8 }}>
            {plan.name} · {shortDate(plan.start_date)} – {shortDate(plan.end_date)} · day {Math.max(1, daysBetween(plan.start_date, today > plan.end_date ? plan.end_date : today) + 1)} of {daysBetween(plan.start_date, plan.end_date) + 1}
          </p>
          {plans.length > 1 && (
            <div className="chips" role="group" aria-label="Window">
              {plans.map((p) => (
                <a key={p.id} className="chip" aria-pressed={p.id === plan.id} href={href(`/review/then-now?plan=${p.id}`)}>
                  {p.name}
                </a>
              ))}
            </div>
          )}
          {!started && <Empty title="This window hasn't started. Come back once there's a then." />}
          {goals.length === 0 && started && <Empty title="No goals in this window yet." />}
          {goals.map((g) => (
            <GoalThenNow key={g.id} goal={g} plan={plan} />
          ))}
          {goals.length > 0 && <WholePerson plan={plan} goals={goals} />}
        </>
      )}
    </div>
  );
}

/** First and latest photo on a goal's tasks, if it has photos. */
function photoPair(data: ReturnType<typeof useStore>['data'], goalId: string): { first: Attachment; latest: Attachment } | null {
  const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === goalId).map((ag) => ag.action_id));
  const sessionIds = new Set(data.sessions.filter((s) => s.action_id && actionIds.has(s.action_id)).map((s) => s.id));
  const photos = data.attachments
    .filter((a) => /^image\//.test(a.mime_type) && (sessionIds.has(a.session_id) || (a.action_id && actionIds.has(a.action_id))))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  if (photos.length < 2) return null;
  return { first: photos[0]!, latest: photos[photos.length - 1]! };
}

function GoalThenNow({ goal, plan }: { goal: Goal; plan: Plan }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [text, setText] = useState(goal.reflection ?? '');
  const dirty = text.trim() !== (goal.reflection ?? '').trim();
  const t = goalTrack(view, goal, plan);
  const from = view.startFor(goal, plan);
  const lookup = actionLookup(data);
  const sessions = view.sessionsForGoal(goal.id).filter((s) => s.status !== 'planned' && s.status !== 'moved' && (s.date ?? s.week_start) >= from);
  const done = Math.round(sessions.reduce((sum, s) => sum + sessionCredit(s), 0));
  const minutes = sessions.reduce((sum, s) => sum + minutesDone(s, lookup(s.action_id)), 0);
  const days = new Set(sessions.filter((s) => s.status !== 'skipped').map((s) => s.date ?? s.week_start)).size;
  const readings = view.measurementsFor(goal.measurement_type_id).filter((m) => m.measured_on >= (goal.baseline_date ?? from));
  const first = readings[0];
  const latest = readings[readings.length - 1];
  const milestones = view.milestonesOf(goal.id);
  const msDone = milestones.filter((m) => m.completed_at).length;
  const photos = photoPair(data, goal.id);
  const finished = !!goal.completed_at;
  const prizes = goalPrizes(view, goal, today, plan);

  function save() {
    const before = goal.reflection ?? '';
    commit(opsUpdateGoal(goal, { reflection: text.trim() }));
    toast(`${goal.title}: your words saved`, () => commit(opsUpdateGoal(goal, { reflection: before })));
  }

  return (
    <section className="card stack-sm then-now" aria-label={goal.title}>
      <div className="row-between">
        <span className="row-start" style={{ gap: 8, minWidth: 0 }}>
          <span className="dot" style={{ background: goal.color, flex: 'none' }} />
          <a className="strong" href={href(`/goals/${goal.id}`)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {goal.title}
          </a>
        </span>
        <span className="xsmall muted" style={{ flex: 'none' }}>
          {finished ? `Done ${shortDate(view.dayOf(goal.completed_at!))}` : t.status}
        </span>
      </div>
      {goal.why.trim() && (
        <p className="then-now-why">“{goal.why.trim()}”</p>
      )}
      <div className="then-now-grid">
        <div className="then-now-col">
          <span className="label">Then · {shortDate(goal.baseline_date ?? from)}</span>
          {goal.type === 'number' ? (
            <b className="num">{first ? `${fmt(first.value)} ${goal.unit ?? ''}` : goal.baseline_value != null ? `${fmt(goal.baseline_value)} ${goal.unit ?? ''}` : '—'}</b>
          ) : goal.type === 'finish' ? (
            <b className="num">0 of {milestones.length}</b>
          ) : (
            <b className="num">0 done</b>
          )}
          {photos && <FileThumb file={photos.first} caption={shortDate(view.dayOf(photos.first.created_at))} />}
        </div>
        <div className="then-now-col">
          <span className="label">Now · {shortDate(finished ? view.dayOf(goal.completed_at!) : today)}</span>
          {goal.type === 'number' ? (
            <b className="num">{latest ? `${fmt(latest.value)} ${goal.unit ?? ''}` : '—'}</b>
          ) : goal.type === 'finish' ? (
            <b className="num">
              {msDone} of {milestones.length}
            </b>
          ) : (
            <b className="num">{done} done</b>
          )}
          {photos && <FileThumb file={photos.latest} caption={shortDate(view.dayOf(photos.latest.created_at))} />}
        </div>
      </div>
      <span className="small muted">
        {goal.type === 'number' && first && latest && first.id !== latest.id
          ? `${fmt(Math.abs(latest.value - first.value))} ${goal.unit ?? ''} ${latest.value < first.value ? 'down' : 'up'} · aiming for ${t.target}. `
          : goal.type !== 'number'
            ? `Aiming for: ${t.target}. `
            : ''}
        {done > 0 ? `${done} task${done === 1 ? '' : 's'} on ${days} day${days === 1 ? '' : 's'}${minutes ? `, ${minutesText(minutes)}` : ''}.` : 'Nothing logged yet.'}
      </span>
      {prizes.length > 0 && (
        <span className="small muted">
          What it earned:{' '}
          {prizes
            .map((p) => `${p.title} (${p.lost ? 'missed' : p.status === 'earned' ? 'earned' : p.status === 'late' ? 'earned late' : 'open'}${p.claimedAt ? ', claimed' : ''})`)
            .join(' · ')}
        </span>
      )}
      <label className="field">
        In your own words: who were you then, who are you now?
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={finished ? 'What it took, what changed, what you’d tell yourself in week 1' : 'What’s different so far, what isn’t yet'} />
      </label>
      {dirty && (
        <button type="button" className="btn small primary" style={{ alignSelf: 'flex-start' }} onClick={save}>
          Save
        </button>
      )}
    </section>
  );
}

/** The whole six months in a few numbers, under the goal cards. */
function WholePerson({ plan, goals }: { plan: Plan; goals: Goal[] }) {
  const { data, today } = useStore();
  const view = useView();
  const lookup = actionLookup(data);
  const end = today > plan.end_date ? plan.end_date : today;
  const ids = new Set(goals.map((g) => g.id));
  const actionIds = new Set(data.actionGoals.filter((ag) => ids.has(ag.goal_id)).map((ag) => ag.action_id));
  const logged = data.sessions.filter((s) => s.action_id && actionIds.has(s.action_id) && s.status !== 'planned' && s.status !== 'moved' && s.status !== 'skipped' && (s.date ?? s.week_start) >= plan.start_date && (s.date ?? s.week_start) <= end);
  const days = new Set(logged.map((s) => s.date ?? s.week_start)).size;
  const minutes = logged.reduce((sum, s) => sum + minutesDone(s, lookup(s.action_id)), 0);
  const elapsed = Math.max(1, daysBetween(plan.start_date, end) + 1);
  const finished = goals.filter((g) => g.completed_at).length;
  const reviews = data.reviews.filter((r) => r.status === 'done' && r.period_start >= plan.start_date && r.period_end <= plan.end_date).length;
  return (
    <section className="card dark stack-sm" aria-label="The whole picture">
      <span className="label">The whole picture</span>
      <div className="grid-3">
        <Tile label="Days you showed up" value={`${days} of ${elapsed}`} />
        <Tile label="Time put in" value={minutesText(minutes)} />
        <Tile label="Goals finished" value={`${finished} of ${goals.length}`} />
      </div>
      <span className="xsmall muted">
        {reviews} review{reviews === 1 ? '' : 's'} saved · {view.activeGoals.filter((g) => ids.has(g.id)).length} still running
      </span>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack-sm" style={{ gap: 2 }}>
      <span className="xsmall muted">{label}</span>
      <b className="num" style={{ fontSize: 20 }}>
        {value}
      </b>
    </div>
  );
}
