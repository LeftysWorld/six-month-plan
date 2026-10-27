import { useState } from 'react';
import { shortDate, weekStart, type GoalGroup } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { groupWeekGoal, opsSetGroupWeek } from '../data/groups.ts';
import { chainFor } from '../data/chain.ts';
import { useToast } from './ui.tsx';

/**
 * The group's week in one line: "AI this week: 250 applications and prereqs done." It rolls up the
 * goals' own week goals (listed under it) so the group is reviewed as one thing.
 */
export function GroupWeekCard({ group }: { group: GoalGroup }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const monday = weekStart(today);
  const current = groupWeekGoal(group, monday);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(current);
  const members = data.goals.filter((g) => g.group_id === group.id && !g.archived_at && !g.completed_at);
  const weekGoals = members
    .map((g) => {
      const plan = view.planForGoal(g);
      if (!plan || view.startFor(g, plan) > today) return null;
      const step = chainFor(data, g, plan, today).week.step;
      return step?.target_note?.trim() ? { g, text: step.target_note.trim(), done: !!step.completed_at } : null;
    })
    .filter((x): x is { g: (typeof members)[number]; text: string; done: boolean } => !!x);
  return (
    <section className="card stack-sm" aria-label="This week, as a group">
      <div className="row-between">
        <span className="label">This week · {shortDate(monday)}</span>
        <button className="link-btn small" onClick={() => (setText(current), setEditing(!editing))}>
          {editing ? 'Cancel' : current ? 'Change' : '+ One line for the group'}
        </button>
      </div>
      {editing ? (
        <form
          className="row-start"
          style={{ gap: 8, flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            const ops = opsSetGroupWeek(group, text, monday);
            if (ops.length) {
              commit(ops);
              toast('Group week goal saved');
            }
            setEditing(false);
          }}
        >
          <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`e.g. ${group.name} this week: …`} />
          <button className="btn small primary" type="submit" style={{ flex: 'none' }}>
            Save
          </button>
        </form>
      ) : current ? (
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>{current}</p>
      ) : (
        <span className="small muted">One sentence that rolls up the goals’ week goals, so the group is reviewed as one thing.</span>
      )}
      {weekGoals.length > 0 && (
        <div className="stack-sm" style={{ gap: 4 }}>
          {weekGoals.map(({ g, text: t, done }) => (
            <span key={g.id} className="xsmall row-start" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <span className="dot" style={{ background: g.color, flex: 'none' }} />
              <span style={{ textDecoration: done ? 'line-through' : undefined, color: done ? 'var(--muted)' : 'var(--ink-2)' }}>
                <b>{g.title}:</b> {t}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
