import { useState } from 'react';
import { shortDate, type ISODate, type Milestone } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { opsAddMilestone } from '../data/ops.ts';
import { opsDeleteMilestone, opsRestoreMilestone, opsUpdateMilestone } from '../data/dated.ts';
import { navigate } from '../router.ts';
import { Sheet, useToast } from './ui.tsx';

/**
 * Add a date to a goal, or change one: the same sheet on the roadmap, the calendar and the goal's
 * page, so a date added anywhere shows everywhere. A date is a milestone: something to have happened
 * by then (class begins, exam day, weigh 200 lb).
 */
export function MilestoneSheet({
  milestone,
  goalIds,
  goalId: goal0,
  date: date0,
  onClose,
}: {
  /** Editing this one; leave out to add. */
  milestone?: Milestone;
  /** Goals to choose from when adding (the first is picked unless goalId says otherwise). */
  goalIds?: string[];
  goalId?: string;
  date?: ISODate;
  onClose: () => void;
}) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const choices = (goalIds ?? (milestone ? [milestone.goal_id] : view.activeGoals.map((g) => g.id))).map((id) => view.goal(id)).filter((g) => !!g);
  const [goalId, setGoalId] = useState(milestone?.goal_id ?? goal0 ?? choices[0]?.id ?? '');
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [date, setDate] = useState(milestone?.due_date ?? date0 ?? today);
  const [done, setDone] = useState(!!milestone?.completed_at);
  const goal = view.goal(goalId);
  const plan = goal ? view.planForGoal(goal) : null;
  const window = goal && plan ? view.plannedWindow(goal, plan) : null;
  const outside = !!window && (date < window.start || date > window.end);
  const valid = !!goal && title.trim().length > 0 && !!date && !outside;
  const example = goal?.type === 'number' ? `e.g. ${goal.unit === 'lb' || goal.unit === 'kg' ? 'Weigh' : 'Reach'} ${goal.target_value ?? 200}${goal.unit ? ` ${goal.unit}` : ''}` : 'e.g. Class begins, Exam day, Module 3 done';

  function save() {
    if (!valid || !goal) return;
    if (!milestone) {
      commit(opsAddMilestone(goal.id, title, date));
      toast(`${title.trim()} added on ${shortDate(date)}. It shows on the roadmap, calendar and ${goal.title}.`);
    } else {
      const before = milestone;
      const ops = opsUpdateMilestone(milestone, { title, due_date: date, completed_at: done ? milestone.completed_at ?? new Date().toISOString() : null });
      if (ops.length) {
        commit(ops);
        toast(`${title.trim()} · ${shortDate(date)}`, () => commit(opsRestoreMilestone(data, before)));
      }
    }
    onClose();
  }

  return (
    <Sheet title={milestone ? 'Edit date' : 'Add a date'} onClose={onClose}>
      {!milestone && choices.length > 1 ? (
        <label className="field">
          Goal
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            {choices.map((g) => (
              <option key={g!.id} value={g!.id}>
                {g!.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        goal && (
          <span className="row-start small muted" style={{ gap: 6, marginTop: -8 }}>
            <span className="dot" style={{ background: goal.color }} /> {goal.title}
          </span>
        )
      )}
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          What happens by then
          <input autoFocus={!milestone} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={example} />
        </label>
        <label className="field">
          Date
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        {outside && window && (
          <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>
            That's outside this goal's dates ({shortDate(window.start)} – {shortDate(window.end)}). Move the goal's dates on the roadmap first if you need it there.
          </span>
        )}
        {milestone && (
          <label className="check-row small">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            <span>Done</span>
          </label>
        )}
        <div className="btn-row">
          <button className="btn primary" type="submit" disabled={!valid}>
            {milestone ? 'Save' : 'Add date'}
          </button>
          {goal && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                onClose();
                navigate(`/goals/${goal.id}`);
              }}
            >
              Open goal
            </button>
          )}
        </div>
      </form>
      {milestone && (
        <button
          type="button"
          className="link-btn small"
          style={{ color: 'var(--danger)', alignSelf: 'flex-start' }}
          onClick={() => {
            const before = milestone;
            commit(opsDeleteMilestone(milestone));
            toast(`${milestone.title} deleted`, () => commit(opsRestoreMilestone({ ...data, milestones: data.milestones.filter((x) => x.id !== before.id) }, before)));
            onClose();
          }}
        >
          Delete this date
        </button>
      )}
      <span className="xsmall muted">Dates show on the roadmap, the calendar and the goal's page. 3-month, month and week goals show there too; change those on the goal's page.</span>
    </Sheet>
  );
}
