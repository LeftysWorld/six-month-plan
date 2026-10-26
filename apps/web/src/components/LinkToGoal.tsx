import { useState } from 'react';
import type { Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsLinkOneOff, opsUnlinkOneOff } from '../data/calendar.ts';
import { withOps } from '../data/breakdown.ts';
import { opsSetTaskGoals } from '../data/connect.ts';
import { isHabit } from '../data/habits.ts';
import { useToast } from './ui.tsx';

/** Does this session need a "Link to a goal" line (a one-off, or a one-day task with no goal)? */
export function needsGoalLink(data: import('../data/model.ts').AppData, session: Session): boolean {
  if (!session.action_id) return true;
  return !data.actionGoals.some((ag) => ag.action_id === session.action_id) && !isHabit(data, session.action_id);
}

/** A one-off (no goal): say so, and offer to link it to a goal, which makes it a one-day task of that goal. */
export function LinkToGoal({ session }: { session: Session }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const goals = view.activeGoals;
  return (
    <div className="stack-sm" style={{ marginTop: -8 }}>
      <div className="row-start small muted" style={{ gap: 6 }}>
        <span>{session.action_id ? 'Not for a goal' : 'One-off · not for a goal'}</span>
        {goals.length > 0 && (
          <button className="link-btn small" onClick={() => setOpen(!open)} style={{ padding: '0 4px' }}>
            {open ? 'Cancel' : 'Link to a goal'}
          </button>
        )}
      </div>
      {open && (
        <div className="chips" role="group" aria-label="Link to a goal">
          {goals.map((g) => (
            <button
              key={g.id}
              className="chip"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 34 }}
              onClick={() => {
                // A task with no goal (a workout added for a day) just gains the goal; a one-off becomes a task.
                const ops = session.action_id ? opsSetTaskGoals(data, session.action_id, [g.id]) : opsLinkOneOff(data, session, g.id);
                if (!ops.length) return;
                const after = withOps(data, ops);
                const actionId = after.sessions.find((x) => x.id === session.id)!.action_id!;
                commit(ops);
                const undo = session.action_id
                  ? after.actionGoals.filter((ag) => ag.action_id === actionId).map((ag) => ({ kind: 'delete' as const, collection: 'actionGoals' as const, id: ag.id }))
                  : opsUnlinkOneOff(session, actionId, after);
                toast(`${session.title} now counts for ${g.title}`, () => commit(undo));
                setOpen(false);
              }}
            >
              <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
              {g.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

