import { useState } from 'react';
import { evenSteps, shortDate, tallyText, type Goal, type MeasurementType, type Plan } from '@six/core';
import { tallyFor } from '../data/tally.ts';
import { opsAbandonGoal } from '../data/backlog.ts';
import { photoTrackers } from '../data/tracking.ts';
import { useStore } from '../data/store.tsx';
import { fmt } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import {
  opsAddMilestone,
  opsArchiveGoal,
  opsCompleteGoal,
  opsReopenGoal,
  opsToggleMilestone,
  opsUpdateGoal,
} from '../data/ops.ts';
import { navigate } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';
import { MilestoneSheet } from '../components/MilestoneSheet.tsx';
import { PrizeTag } from '../components/Prize.tsx';
import { goalPrizes } from '../data/prizes.ts';
import { WeightChart } from '../components/WeightChart.tsx';
import { GoalFiles } from '../components/Attachments.tsx';
import { MeasureRow, PhotoRow, TrackForm } from '../components/Tracking.tsx';
import { GoalGroupCard } from '../components/Connections.tsx';
import { MoveSheet } from '../components/MoveSheet.tsx';

/**
 * The lower half of the goal page: why it matters, the path chart, milestones,
 * measurements, change history and archiving. The chain and daily tasks sit above it (Flow.tsx).
 */
export function GoalExtras({ goal, plan }: { goal: Goal; plan: Plan | null }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [msTitle, setMsTitle] = useState('');
  const [msDate, setMsDate] = useState(today);
  const plans = view.plansForGoal(goal.id);
  const pace = view.goalPace(goal, plan);
  const actions = view.actionsForGoal(goal.id, true);
  const milestones = data.milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const types = data.measurementTypes.filter((t) => !t.archived_at && (t.goal_id === goal.id || t.id === goal.measurement_type_id));
  const actionIds = new Set(actions.map((a) => a.id));
  const history = data.changeLog
    .filter((c) => c.entity_id === goal.id || actionIds.has(c.entity_id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <>
      <div className="card stack-sm">
        <div className="row-between">
          <span className="label">Why it matters</span>
          <button className="link-btn small" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
        {editing ? (
          <GoalEdit goal={goal} onSaved={() => setEditing(false)} />
        ) : (
          <>
            {goal.why ? <div style={{ fontSize: 16, fontStyle: 'italic' }}>"{goal.why}"</div> : <span className="small muted">Add a line about why this matters. It helps on hard days.</span>}
            {goal.done_means && (
              <div className="small" style={{ color: 'var(--ink-2)' }}>
                Done means: {goal.done_means}
              </div>
            )}
          </>
        )}
      </div>

      <GoalGroupCard goal={goal} />

      {goal.type === 'number' && pace.number && plan && (
        <div className="card stack-sm">
          <div className="row-between">
            <span className="label">Path</span>
            {pace.number.aheadBy != null && (
              <span className="small muted">
                {pace.number.aheadBy >= 0 ? `${fmt(pace.number.aheadBy)} ${goal.unit} ahead` : `${fmt(-pace.number.aheadBy)} ${goal.unit} behind`}
              </span>
            )}
          </div>
          <WeightChart
            start={pace.number.start}
            path={view.pathFor(goal)}
            readings={view.measurementsFor(goal.measurement_type_id)}
            range={{ start: pace.number.start.date, end: goal.target_date ?? plan.end_date }}
            today={today}
            unit={goal.unit ?? ''}
            color={goal.color}
            initial={30}
          />
        </div>
      )}

      <Measurements goal={goal} types={types} onAdd={toast} />

      <GoalFiles actionIds={actionIds} />

      {(goal.type === 'finish' || milestones.length > 0) && (
        <div className="card stack-sm">
          <span className="label">Milestones</span>
          {milestones.length === 0 && <span className="small muted">No milestones yet.</span>}
          {milestones.map((m) => (
            <div key={m.id} className="list-row">
              <button
                aria-label={m.completed_at ? `${m.title} complete, tap to reopen` : `Mark ${m.title} complete`}
                onClick={() => commit(opsToggleMilestone(m))}
                style={{ width: 44, height: 44, border: 0, background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: -10 }}
              >
                <span className={`ring ${m.completed_at ? 'done' : ''}`} style={{ width: 22, height: 22 }}>
                  {m.completed_at && <Icon name="check" size={12} stroke={3.2} />}
                </span>
              </button>
              <div className="grow">
                <div style={{ textDecoration: m.completed_at ? 'line-through' : undefined, color: m.completed_at ? 'var(--muted)' : undefined }}>
                  {m.title}
                  {m.value != null && !m.count_action_id ? <span className="muted"> · {fmt(m.value)} {goal.unit ?? ''}</span> : null}
                </div>
                {(() => {
                  const t = tallyFor(view, m, today);
                  if (!t) return null;
                  return (
                    <div className="stack-sm" style={{ gap: 4, marginTop: 4 }}>
                      <span className="xsmall" style={{ color: t.label === 'behind' ? 'var(--amber-ink)' : 'var(--muted)' }}>
                        {tallyText(t)}
                        {!t.reached && t.label !== 'none' ? ` · ${t.label === 'behind' ? `behind (${t.expected} expected by now)` : t.label === 'ahead' ? 'ahead' : 'on track'}` : ''}
                      </span>
                      <span className="tally-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round(t.share * 100)}%`, background: goal.color }} />
                        {!t.reached && <i style={{ left: `${Math.min(100, Math.round((t.expected / t.target) * 100))}%` }} />}
                      </span>
                    </div>
                  );
                })()}
                <div className="xsmall muted">
                  {shortDate(m.due_date)}
                  {!m.completed_at && m.due_date < today ? ' · past due' : ''}
                  {m.prize?.trim() ? ` · prize: ${m.prize.trim()}` : ''}
                </div>
              </div>
            </div>
          ))}
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!msTitle.trim()) return;
              commit(opsAddMilestone(goal.id, msTitle, msDate));
              setMsTitle('');
            }}
          >
            <input className="input" placeholder="New milestone" aria-label="New milestone" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} />
            <div className="row-start" style={{ flexWrap: 'wrap' }}>
              <input className="input" type="date" aria-label="Milestone date" value={msDate} onChange={(e) => setMsDate(e.target.value)} style={{ flex: '1 1 150px', minWidth: 0 }} />
              <button className="btn small" type="submit" style={{ flex: 'none' }}>
                Add milestone
              </button>
            </div>
          </form>
        </div>
      )}

      {history.length > 0 && (
        <details className="card tight">
          <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            Change history · {history.length}
          </summary>
          {history.map((c) => (
            <div key={c.id} className="list-row small">
              <span className="grow">{c.summary}</span>
              <span className="xsmall muted">from {shortDate(c.effective_from)}</span>
            </div>
          ))}
        </details>
      )}

      <CompleteGoal goal={goal} />

      <div className="row-between xsmall muted">
        <span className="row-start" style={{ gap: 6 }}>
          In: {plans.filter((p) => !p.archived_at && p.end_date >= today).map((p) => p.name).join(', ') || 'no running season'}
          {!goal.archived_at && !goal.completed_at && (
            <button className="link-btn small" onClick={() => setMoving(true)} style={{ padding: '0 4px' }}>
              Move to…
            </button>
          )}
        </span>
        <button
          className="link-btn small"
          style={{ color: 'var(--danger)' }}
          onClick={() => {
            const was = goal.archived_at;
            commit(opsArchiveGoal(goal, !was));
            toast(was ? 'Goal restored' : `${goal.title} archived. Find it under Completed → Archived.`, was ? undefined : () => commit(opsArchiveGoal(goal, false)));
            if (!was) navigate('/goals');
          }}
        >
          {goal.archived_at ? 'Restore goal' : 'Archive goal'}
        </button>
      </div>
      {moving && <MoveSheet goals={[goal]} onClose={() => setMoving(false)} />}
    </>
  );
}

/** "Why it matters", as one quiet line under the goal's title. Tap to edit it (and what done means). */
export function WhyLine({ goal }: { goal: Goal }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="card tight stack-sm">
        <GoalEdit goal={goal} onSaved={() => setEditing(false)} />
        <button className="link-btn small" onClick={() => setEditing(false)} style={{ alignSelf: 'flex-start' }}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="why-line" onClick={() => setEditing(true)} aria-label="Edit why it matters">
      {goal.why ? `“${goal.why}”` : 'Add a line about why this matters. It helps on hard days.'}
    </button>
  );
}

/**
 * The goal's record: milestones (for "finish" goals or any that have them), photos and files, and
 * other measurements. A number goal's readings and path live in its progress card instead.
 */
export function GoalRecord({ goal }: { goal: Goal }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [msTitle, setMsTitle] = useState('');
  const [msDate, setMsDate] = useState(today);
  const [splitting, setSplitting] = useState(false);
  const [stepName, setStepName] = useState('');
  const [stepCount, setStepCount] = useState(4);
  const plan = view.planForGoal(goal);
  const stepFrom = plan ? (view.startFor(goal, plan) > today ? view.startFor(goal, plan) : today) : today;
  const stepTo = goal.target_date ?? plan?.end_date ?? today;
  const actions = view.actionsForGoal(goal.id, true);
  const actionIds = new Set(actions.map((a) => a.id));
  const [editingMs, setEditingMs] = useState<string | null>(null);
  const msEditing = editingMs ? data.milestones.find((x) => x.id === editingMs) : undefined;
  const milestones = data.milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const types = data.measurementTypes.filter((t) => !t.archived_at && (t.goal_id === goal.id || t.id === goal.measurement_type_id));
  const prizes = goalPrizes(view, goal, today, plan);
  const prizeOf = (id: string) => prizes.find((p) => p.key === `m:${id}`);
  return (
    <>
      {/* What it tracks first: the numbers you log, above the dates you're working toward. */}
      <Measurements goal={goal} types={types} onAdd={toast} />
      {/* Every goal can have milestones: checkpoints inside it (class begins, exam booked, module 5). */}
      {(
        <div className="card stack-sm">
          <div className="row-between">
            <span className="label">Milestones</span>
            <button className="link-btn small" onClick={() => setSplitting(!splitting)}>
              {splitting ? 'Cancel' : '+ Split into steps'}
            </button>
          </div>
          {splitting && (
            <form
              className="stack-sm"
              onSubmit={(e) => {
                e.preventDefault();
                if (stepCount < 1 || stepTo < stepFrom) return;
                const rows = evenSteps(stepName || 'Step', stepCount, stepFrom, stepTo).map((m) => ({ id: crypto.randomUUID(), goal_id: goal.id, title: m.title, due_date: m.due_date, completed_at: null }));
                commit([{ kind: 'insert', collection: 'milestones', rows }]);
                toast(`Added ${rows.length} milestones`);
                setSplitting(false);
              }}
            >
              <span className="xsmall muted">
                Evenly spaced from {shortDate(stepFrom)} to {shortDate(stepTo)}
                {goal.target_date ? '' : ' (set “Finish by” on the goal for an earlier end)'}
              </span>
              <div className="row-start" style={{ flexWrap: 'nowrap' }}>
                <input className="input" aria-label="Step name" placeholder="e.g. Module, Week, Domain" value={stepName} onChange={(e) => setStepName(e.target.value)} />
                <input className="input" aria-label="How many steps" type="number" min={1} max={60} value={stepCount} onChange={(e) => setStepCount(Number(e.target.value))} style={{ width: 76, flex: 'none' }} />
                <button className="btn small" type="submit" style={{ flex: 'none', minHeight: 44 }}>
                  Add
                </button>
              </div>
            </form>
          )}
          {milestones.length === 0 && !splitting && <span className="small muted">No milestones yet: dates inside this goal, like class begins or weigh 200 lb by Jan 1. Split it into steps (modules, chapters, domains) or add them one by one. They show on the roadmap and the calendar.</span>}
          {milestones.map((m) => (
            <div key={m.id} className="list-row">
              <button
                aria-label={m.completed_at ? `${m.title} complete, tap to reopen` : `Mark ${m.title} complete`}
                onClick={() => commit(opsToggleMilestone(m))}
                style={{ width: 44, height: 44, border: 0, background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: -10 }}
              >
                <span className={`ring ${m.completed_at ? 'done' : ''}`} style={{ width: 22, height: 22 }}>
                  {m.completed_at && <Icon name="check" size={12} stroke={3.2} />}
                </span>
              </button>
              <button type="button" className="grow cal-row-btn" onClick={() => setEditingMs(m.id)} aria-label={`Change ${m.title}`}>
                <div style={{ textDecoration: m.completed_at ? 'line-through' : undefined, color: m.completed_at ? 'var(--muted)' : undefined }}>
                  {m.title}
                  {m.value != null ? <span className="muted"> · {fmt(m.value)} {goal.unit ?? ''}</span> : null}
                </div>
                <div className="xsmall muted row-start" style={{ gap: 6 }}>
                  <span>
                    {shortDate(m.due_date)}
                    {!m.completed_at && m.due_date < today ? ' · past due' : ''}
                  </span>
                  {prizeOf(m.id) && <PrizeTag p={prizeOf(m.id)!} />}
                </div>
              </button>
            </div>
          ))}
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!msTitle.trim()) return;
              commit(opsAddMilestone(goal.id, msTitle, msDate));
              setMsTitle('');
            }}
          >
            <input className="input" placeholder="New milestone" aria-label="New milestone" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} />
            <div className="row-start" style={{ flexWrap: 'wrap' }}>
              <input className="input" type="date" aria-label="Milestone date" value={msDate} onChange={(e) => setMsDate(e.target.value)} style={{ flex: '1 1 150px', minWidth: 0 }} />
              <button className="btn small" type="submit" style={{ flex: 'none' }}>
                Add milestone
              </button>
            </div>
          </form>
        </div>
      )}

      {msEditing && <MilestoneSheet milestone={msEditing} onClose={() => setEditingMs(null)} />}
      <GoalFiles actionIds={actionIds} goalId={goal.id} />
    </>
  );
}

/** Everything done rarely, folded away: complete, move, change history, archive. */
export function GoalManage({ goal }: { goal: Goal }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const plans = view.plansForGoal(goal.id);
  const actions = view.actionsForGoal(goal.id, true);
  const actionIds = new Set(actions.map((a) => a.id));
  const history = data.changeLog
    .filter((c) => c.entity_id === goal.id || actionIds.has(c.entity_id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <div className="card manage-card">
      <button type="button" className="manage-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Manage goal</span>
        <span style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', display: 'inline-flex' }}>
          <Icon name="chevron" size={16} stroke={2.2} />
        </span>
      </button>
      {open && (
        <div className="stack-sm" style={{ padding: '0 16px 14px' }}>
          <CompleteGoal goal={goal} />
          <div className="row-between small" style={{ gap: 8 }}>
            <span className="muted">
              In {plans.filter((p) => !p.archived_at && p.end_date >= today).map((p) => p.name).join(', ') || 'no running season'}
            </span>
            {!goal.archived_at && !goal.completed_at && (
              <button className="link-btn small" onClick={() => setMoving(true)}>
                Move to…
              </button>
            )}
          </div>
      {history.length > 0 && (
        <details className="card tight">
          <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            Change history · {history.length}
          </summary>
          {history.map((c) => (
            <div key={c.id} className="list-row small">
              <span className="grow">{c.summary}</span>
              <span className="xsmall muted">from {shortDate(c.effective_from)}</span>
            </div>
          ))}
        </details>
      )}

          {!goal.archived_at && !goal.completed_at && (
            <button
              className="link-btn small"
              style={{ alignSelf: 'flex-start', paddingLeft: 0 }}
              onClick={() => {
                const before = data.ideas.find((i) => i.goal_id === goal.id);
                const { ops, ideaId } = opsAbandonGoal(data, goal);
                commit(ops);
                toast(`${goal.title} is back at the top of your backlog. Its history stays under Completed → Archived.`, () =>
                  commit([{ kind: 'update', collection: 'goals', id: goal.id, patch: { archived_at: null } }, ...(before ? [{ kind: 'update' as const, collection: 'ideas' as const, id: before.id, patch: before as unknown as Record<string, unknown> }] : [{ kind: 'delete' as const, collection: 'ideas' as const, id: ideaId }])]),
                );
                navigate('/goals/backlog');
              }}
            >
              Back to the backlog (abandon this goal)
            </button>
          )}
          <button
            className="link-btn small"
            style={{ color: 'var(--danger)', alignSelf: 'flex-start', paddingLeft: 0 }}
            onClick={() => {
              const was = goal.archived_at;
              commit(opsArchiveGoal(goal, !was));
              toast(was ? 'Goal restored' : `${goal.title} archived. Find it under Completed → Archived.`, was ? undefined : () => commit(opsArchiveGoal(goal, false)));
              if (!was) navigate('/goals');
            }}
          >
            {goal.archived_at ? 'Restore goal' : 'Archive goal'}
          </button>
        </div>
      )}
      {moving && <MoveSheet goals={[goal]} onClose={() => setMoving(false)} />}
    </div>
  );
}

/** Finish the goal (it moves to Completed with a note on how it ended), or reopen a finished one. */
function CompleteGoal({ goal }: { goal: Goal }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (goal.completed_at) {
    return (
      <div className="card tight row-between small" style={{ gap: 10 }}>
        <span>
          <b>Completed {shortDate(view.dayOf(goal.completed_at))}.</b>
          {goal.completion_note ? <span className="muted"> “{goal.completion_note}”</span> : null}
        </span>
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
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        Mark goal complete
      </button>
    );
  }
  return (
    <form
      className="card stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        commit(opsCompleteGoal(data, goal, note, today));
        toast(`${goal.title} completed`);
        navigate('/goals/completed');
      }}
    >
      <span className="label">Mark goal complete</span>
      <label className="field">
        How did it end? (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Recorded all three songs; the morning slot made it work" rows={2} autoFocus />
      </label>
      <span className="xsmall muted">It moves to Completed and its tasks come off your list. Its history is kept, and you can reopen it.</span>
      <div className="btn-row">
        <button className="btn small primary" type="submit">
          Complete goal
        </button>
        <button className="btn small" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function GoalEdit({ goal, onSaved }: { goal: Goal; onSaved?: () => void }) {
  const { commit } = useStore();
  const [title, setTitle] = useState(goal.title);
  const [why, setWhy] = useState(goal.why);
  const [done, setDone] = useState(goal.done_means);
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        commit(opsUpdateGoal(goal, { title: title.trim() || goal.title, why: why.trim(), done_means: done.trim() }));
        onSaved?.();
      }}
    >
      <label className="field">
        Goal
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Why
        <input value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <label className="field">
        Done means
        <input value={done} onChange={(e) => setDone(e.target.value)} />
      </label>
      <button className="btn primary small" type="submit">
        Save
      </button>
    </form>
  );
}

/**
 * Everything this goal tracks: its numbers (each with its latest reading, the change since the
 * first and a box to log today's) and photos, and the form to track something new. A number goal's
 * main measurement is logged and charted in its progress card, so it isn't logged here.
 */
function Measurements({ goal, types, onAdd }: { goal: Goal; types: MeasurementType[]; onAdd: (msg: string) => void }) {
  const { data, today } = useStore();
  const [adding, setAdding] = useState(false);
  const photos = photoTrackers(data, goal.id, today);
  return (
    <div className="card stack-sm">
      <div className="row-between">
        <span className="label">Measurements</span>
        <button className="link-btn small" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ Track something'}
        </button>
      </div>
      {adding && (
        <TrackForm
          goals={[goal]}
          goalId={goal.id}
          onDone={(msg) => {
            onAdd(msg);
            if (!/^Already/.test(msg)) setAdding(false);
          }}
        />
      )}
      {types.length === 0 && photos.length === 0 && !adding && <span className="small muted">Track a number (like a distance with a tape measure) or a photo (like a monthly progress photo).</span>}
      {types.map((t) => (
        <MeasureRow key={t.id} type={t} goal={goal} canLog={t.id !== goal.measurement_type_id || goal.type !== 'number'} onMsg={onAdd} />
      ))}
      <PhotoRow goalId={goal.id} onMsg={onAdd} />
    </div>
  );
}

/** Where this goal is right now in its breakdown: 3 months → month → week → today's tasks. */
