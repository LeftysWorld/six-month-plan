import { useState } from 'react';
import { addDays, describeSchedule, scheduleForWeek, shortDate, weekStart, type Action } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsArchiveAction, opsChangeSchedule, opsCreateAction, opsUpdateAction, type ActionInput } from '../data/ops.ts';
import { goBack, navigate } from '../router.ts';
import { ActionFields, blankAction } from '../components/ActionFields.tsx';
import { BackLink, Empty, useToast } from '../components/ui.tsx';

/** Create a new action for a goal, or edit an existing one (schedule changes apply from next Monday). */
export function ActionEdit({ id, goalId }: { id: string | null; goalId: string | null }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const existing = id ? view.action(id) : undefined;
  const [value, setValue] = useState<ActionInput>(() => (existing ? toInput(existing, data) : blankAction()));
  const goal = goalId ? view.goal(goalId) : view.goalsForAction(existing?.id ?? null)[0];

  if (id && !existing) return <Empty title="Action not found." />;
  const nextMonday = addDays(weekStart(today), 7);
  const current = existing ? scheduleForWeek(data.schedules, existing.id, nextMonday) : null;

  function save() {
    if (!value.title.trim()) return;
    if (!existing) {
      if (!goal) return;
      const { ops } = opsCreateAction(data, value, [goal.id], today);
      commit(ops);
      toast(`Added ${value.title.trim()}`);
      navigate(`/goals/${goal.id}`);
      return;
    }
    const ops = opsUpdateAction(existing, {
      title: value.title.trim(),
      kind: value.kind,
      planned_minutes: value.planned_minutes,
      planned_count: value.planned_count,
      min_label: value.min_label.trim(),
      min_minutes: value.min_minutes,
      min_count: value.min_count,
      priority: value.priority,
    });
    const scheduleChanged =
      !current ||
      current.rule !== value.rule ||
      (value.rule === 'per_week' ? current.per_week !== value.per_week : [...current.days].sort().join() !== [...value.days].sort().join());
    if (scheduleChanged) ops.push(...opsChangeSchedule(data, existing, value, today));
    commit(ops);
    toast(scheduleChanged ? `Saved. New schedule starts ${shortDate(nextMonday)}` : 'Saved');
    goBack(goal ? `/goals/${goal.id}` : '/plans');
  }

  return (
    <div className="stack">
      <BackLink label={goal?.title ?? 'Back'} fallback={goal ? `/goals/${goal.id}` : '/plans'} />
      <h1>{existing ? existing.title : 'New action'}</h1>
      {goal && (
        <div className="small muted row-start">
          <span className="dot" style={{ background: goal.color }} />
          Supports: {goal.title}
        </div>
      )}
      {existing && current && (
        <div className="banner info">
          <span>
            Now: {describeSchedule(current)}. Schedule changes apply from {shortDate(nextMonday)}; past weeks keep their old plan.
          </span>
        </div>
      )}
      <ActionFields value={value} onChange={setValue} />
      <button className="btn primary" onClick={save} disabled={!value.title.trim()}>
        {existing ? 'Save changes' : 'Add action'}
      </button>
      {existing && (
        <button
          className="btn danger"
          onClick={() => {
            commit(opsArchiveAction(existing, !existing.archived_at));
            toast(existing.archived_at ? 'Action restored' : 'Action archived; logs are kept');
            goBack('/plans');
          }}
        >
          {existing.archived_at ? 'Restore action' : 'Stop this action'}
        </button>
      )}
    </div>
  );
}

function toInput(a: Action, data: ReturnType<typeof useStore>['data']): ActionInput {
  const schedule = data.schedules
    .filter((s) => s.action_id === a.id && s.effective_to == null)
    .sort((x, y) => (x.effective_from < y.effective_from ? 1 : -1))[0];
  return {
    title: a.title,
    kind: a.kind,
    planned_minutes: a.planned_minutes,
    planned_count: a.planned_count,
    min_label: a.min_label,
    min_minutes: a.min_minutes,
    min_count: a.min_count,
    priority: a.priority,
    rule: schedule?.rule ?? 'per_week',
    days: schedule?.days ?? [1, 3, 5],
    per_week: schedule?.per_week ?? 3,
  };
}
