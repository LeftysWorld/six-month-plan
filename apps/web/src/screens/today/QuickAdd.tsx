import { useState } from 'react';
import { shortDate, weekStart, weekdayName, type ISODate } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { useView } from '../../data/useView.ts';
import { parseQuickAdd } from '../../data/parse.ts';
import { blankTask, opsAddTask, withOps } from '../../data/breakdown.ts';
import { chainFor, opsEnsureStep, stepFor } from '../../data/chain.ts';
import { opsAddOneOff, opsLogSession, opsLogUnplanned } from '../../data/ops.ts';
import { opsAddIdea } from '../../data/backlog.ts';
import { Sheet, WEEKDAY_NAMES, useToast } from '../../components/ui.tsx';

/** The dock's "Add or log" sheet: a task in plain words, an extra log of a task you have, or a goal idea. */
export function QuickAdd({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [tab, setTab] = useState<'task' | 'log' | 'idea'>('task');
  const [idea, setIdea] = useState('');
  const [text, setText] = useState('');
  const [minutesEdit, setMinutesEdit] = useState<number | null>(null);
  const [priorityEdit, setPriority] = useState(false);
  const [goalPick, setGoalPick] = useState<string | null>(null);
  const actions = data.actions.filter((a) => !a.archived_at);
  const [actionId, setActionId] = useState(actions[0]?.id ?? '');
  const [logMinutes, setLogMinutes] = useState(20);

  const goals = view.activeGoals;
  const parsed = parseQuickAdd(text, today);
  const target = parsed.date ?? date;
  const dayWord = target === today ? 'today' : weekdayName(target);
  const tagged = parsed.goalTag ? goals.find((g) => g.title.toLowerCase().includes(parsed.goalTag!)) : undefined;
  const goal = goals.find((g) => g.id === goalPick) ?? tagged ?? null;
  const minutes = minutesEdit ?? parsed.minutes ?? 15;
  const priority = priorityEdit || parsed.priority;
  const repeats = parsed.days.length > 0;
  const canAdd = parsed.title.length > 0 && (!repeats || !!goal);
  const preview = [
    repeats ? (parsed.days.length === 7 ? 'Every day' : parsed.days.map((d) => WEEKDAY_NAMES[d - 1]).join(' · ')) : target === today ? 'Today' : `${weekdayName(target)} ${shortDate(target)}`,
    `${minutes} min`,
    priority ? 'Priority' : null,
    goal ? goal.title : null,
  ].filter(Boolean);

  function add() {
    if (!canAdd) return;
    const plan = goal ? view.planForGoal(goal) : null;
    if (goal && plan) {
      const chain = chainFor(data, goal, plan, target < plan.start_date ? plan.start_date : target);
      const week = stepFor(goal, plan, chain, 'week');
      const ensure = opsEnsureStep(data, week);
      const input = repeats
        ? { ...blankTask(week, today), title: parsed.title, minutes, priority, when: 'days' as const, days: parsed.days, through: null }
        : { ...blankTask(week, today), title: parsed.title, minutes, priority, when: 'once' as const, date: target };
      commit([...ensure, ...opsAddTask(withOps(data, ensure), goal, week, input, today)]);
    } else {
      commit(opsAddOneOff({ title: parsed.title, minutes, priority, date: target }));
    }
    toast(`Added ${parsed.title}${repeats ? ' (repeats)' : ''}`);
    onClose();
  }

  return (
    <Sheet title="Add" onClose={onClose}>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'task'} onClick={() => setTab('task')}>
          New task
        </button>
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')} disabled={actions.length === 0}>
          Log extra
        </button>
        <button role="tab" aria-selected={tab === 'idea'} onClick={() => setTab('idea')}>
          Goal idea
        </button>
      </div>
      {tab === 'idea' ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!idea.trim()) return;
            commit(opsAddIdea(data, idea).ops);
            toast('Added to your goal backlog');
            onClose();
          }}
        >
          <label className="field">
            Goal idea
            <input autoFocus value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Run a half marathon" />
          </label>
          <span className="xsmall muted" style={{ marginTop: -8 }}>
            It goes to the bottom of your backlog. Order it and select it from Goals › Backlog.
          </span>
          <button className="btn primary" type="submit" disabled={!idea.trim()}>
            Add to backlog
          </button>
        </form>
      ) : tab === 'task' ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="field">
            Task
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. guitar 20m mon wed fri #guitar" aria-describedby="quick-add-hint" />
          </label>
          <span id="quick-add-hint" className="xsmall muted" style={{ marginTop: -8 }}>
            Type it the way you'd say it: "tomorrow", "fri", "mon wed fri", "daily", "20m", "1h", "!" for priority, "#goal".
          </span>
          {parsed.title && (
            <div className="row-start" style={{ gap: 6 }}>
              {preview.map((p) => (
                <span key={p} className="pill none">
                  {p}
                </span>
              ))}
            </div>
          )}
          <div className="grid-2">
            <label className="field">
              For goal
              <select value={goal?.id ?? ''} onChange={(e) => setGoalPick(e.target.value || null)}>
                <option value="">{repeats ? 'Pick a goal' : 'No goal (one-off)'}</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Minutes
              <input type="number" min={0} value={minutes} onChange={(e) => setMinutesEdit(Number(e.target.value))} />
            </label>
          </div>
          {repeats && !goal && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>A repeating task belongs to a goal. Pick one, or add #goal.</span>}
          <label className="row-start small">
            <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} style={{ width: 20, height: 20 }} />
            Priority
          </label>
          <button className="btn primary" type="submit" disabled={!canAdd}>
            {repeats ? 'Add repeating task' : `Add to ${dayWord}`}
          </button>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const a = actions.find((x) => x.id === actionId);
            if (!a) return;
            const on = date <= today ? date : today;
            // A task happens at most once a day: use the session already on that day, or one of this
            // week's "any day" sessions, before adding an extra one.
            const sameDay = data.sessions.find((x) => x.action_id === a.id && x.date === on && x.status !== 'moved');
            if (sameDay && sameDay.status !== 'planned') {
              toast(`${a.title} is already logged ${on === today ? 'today' : `on ${weekdayName(on)}`}`);
              return;
            }
            const anyDay = sameDay ? undefined : data.sessions.find((x) => x.action_id === a.id && !x.date && x.week_start === weekStart(on) && x.status === 'planned');
            const target = sameDay ?? anyDay;
            if (target) commit(opsLogSession(target, { status: 'done', actual_minutes: logMinutes, on }));
            else commit(opsLogUnplanned(data, a, on, logMinutes));
            toast(`Logged ${a.title}`);
            onClose();
          }}
        >
          <label className="field">
            What did you do?
            <select value={actionId} onChange={(e) => setActionId(e.target.value)}>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Minutes
            <input type="number" min={0} value={logMinutes} onChange={(e) => setLogMinutes(Number(e.target.value))} />
          </label>
          <button className="btn primary" type="submit">
            Log it
          </button>
        </form>
      )}
    </Sheet>
  );
}

/**
 * Today's numbers: the measurements you've set to show on Today (a goal's main number by default),
 * logged right here so you never have to open each goal. Stopped measurements never show. One
 * that already has a "Log a number" task today is left to that task.
 */
