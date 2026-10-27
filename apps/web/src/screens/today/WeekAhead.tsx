import { addDays, daysBetween, isTally, shortDate, weekStart, weekdayName } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { fmt } from '../../data/derive.ts';
import { useView } from '../../data/useView.ts';
import { chainFor, isSet, periodStatus } from '../../data/chain.ts';
import { groupWeekGoal } from '../../data/groups.ts';
import { tallyFor, tallyInWeek } from '../../data/tally.ts';
import { href } from '../../router.ts';
import { Icon, useToast } from '../../components/ui.tsx';

/**
 * "By Sunday you'll have": every goal's week goal on Today, so the week's promises sit next to the
 * day's tasks. Tick one off when it's done (the weekly review still asks hit / partly / missed), or
 * set the ones that are missing. Groups with a one-line week goal show it above their goals.
 */
export function WeekAhead() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const left = daysBetween(today, sunday);
  const goals = view.activeGoals.filter((g) => {
    const plan = view.planForGoal(g);
    return !!plan && view.startFor(g, plan) <= today;
  });
  if (goals.length === 0) return null;

  const rows = goals.map((g) => {
    const plan = view.planForGoal(g)!;
    const chain = chainFor(data, g, plan, today);
    const step = chain.week.step;
    const set = isSet(chain.week);
    const value = g.type === 'number' ? step?.target_value ?? null : null;
    const text = set ? [value != null ? `${fmt(value)} ${g.unit ?? ''}`.trim() : '', step?.target_note.trim() ?? ''].filter(Boolean).join(' · ') : '';
    const status = set ? periodStatus(view, data, g, plan, chain.week, today) : null;
    // A running total says what this week added and what the week needs.
    const tally = data.milestones.filter((m) => m.goal_id === g.id && isTally(m) && !m.completed_at).map((m) => ({ m, t: tallyFor(view, m, today) })).find((x) => x.t);
    const tallyLine = tally?.t ? `+${tallyInWeek(data, tally.m, monday)} this week${tally.t.perDay ? ` · ~${tally.t.perDay * Math.min(7, left + 1)} more to stay on pace` : ''}` : null;
    return { g, step, set, text, done: !!step?.completed_at, status, tallyLine };
  });
  const groups = data.groups
    .map((gr) => ({ gr, line: groupWeekGoal(gr, monday), members: rows.filter((r) => r.g.group_id === gr.id) }))
    .filter((x) => x.members.length > 0);
  const loose = rows.filter((r) => !groups.some((x) => x.gr.id === r.g.group_id));
  const setCount = rows.filter((r) => r.set).length;
  const doneCount = rows.filter((r) => r.done).length;

  const toggle = (row: (typeof rows)[number]) => {
    if (!row.step) return;
    const was = row.step.completed_at;
    commit([{ kind: 'update', collection: 'planSteps', id: row.step.id, patch: { completed_at: was ? null : new Date().toISOString() } }]);
    toast(was ? `${row.g.title}: week goal reopened` : `${row.g.title}: week goal done`, () => commit([{ kind: 'update', collection: 'planSteps', id: row.step!.id, patch: { completed_at: was } }]));
  };

  const line = (row: (typeof rows)[number]) => (
    <div key={row.g.id} className="week-ahead-row">
      {row.set ? (
        <button
          type="button"
          className="week-ahead-tick"
          aria-label={row.done ? `${row.g.title} week goal done, tap to reopen` : `Mark ${row.g.title}'s week goal done`}
          onClick={() => toggle(row)}
        >
          <span className={`ring ${row.done ? 'done' : ''}`} style={{ width: 22, height: 22 }}>
            {row.done && <Icon name="check" size={12} stroke={3.2} />}
          </span>
        </button>
      ) : (
        <span className="week-ahead-tick" aria-hidden="true">
          <span className="dot" style={{ width: 8, height: 8, background: row.g.color }} />
        </span>
      )}
      <a href={href(`/goals/${row.g.id}`)} className="week-ahead-body">
        <span className="xsmall muted row-start" style={{ gap: 6 }}>
          {row.set && <span className="dot" style={{ width: 7, height: 7, background: row.g.color }} />}
          {row.g.title}
        </span>
        {row.set ? (
          <span className="small week-ahead-text" style={row.done ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
            {row.text}
          </span>
        ) : (
          <span className="small" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>
            + Set this week’s goal
          </span>
        )}
        {(row.tallyLine || (row.status && !row.done)) && (
          <span className="xsmall" style={{ color: row.status?.label === 'behind' ? 'var(--amber-ink)' : 'var(--muted)' }}>
            {[row.tallyLine, row.status && !row.done ? row.status.text : null].filter(Boolean).join(' · ')}
          </span>
        )}
      </a>
    </div>
  );

  return (
    <section className="card stack-sm week-ahead" aria-label="This week's goals">
      <div className="row-between">
        <span className="label">By {weekdayName(sunday)} you’ll have</span>
        <span className="xsmall muted">
          {left === 0 ? 'last day' : `${left} day${left === 1 ? '' : 's'} left`} · {doneCount} of {setCount} done
        </span>
      </div>
      {groups.map(({ gr, line: groupLine, members }) => (
        <div key={gr.id} className="stack-sm" style={{ gap: 2 }}>
          {groupLine && (
            <span className="small" style={{ fontWeight: 600, fontStyle: 'italic', color: 'var(--ink-2)' }}>
              {gr.name}: {groupLine}
            </span>
          )}
          {members.map(line)}
        </div>
      ))}
      {loose.map(line)}
      <span className="xsmall muted">Week of {shortDate(monday)}. Ticked here, judged in Saturday’s review.</span>
    </section>
  );
}
