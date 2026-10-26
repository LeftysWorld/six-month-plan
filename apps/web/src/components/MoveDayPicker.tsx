import { addDays, shortDate, weekDates, weekStart, weekdayName, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import type { View } from '../data/derive.ts';
import { opsMoveSession, opsRestoreSession } from '../data/ops.ts';
import { useToast } from './ui.tsx';

/** The days a session can move to: this week and next, from today on, skipping days that already have the task. */
export function moveDatesFor(view: View, session: Session, today: ISODate): ISODate[] {
  const monday = weekStart(session.date ?? today);
  return [...weekDates(monday), ...weekDates(addDays(monday, 7))].filter((d) => d >= today && d !== session.date && view.canPlace(session, d));
}

/**
 * "Move to another day" as a row of day chips. Moving saves at once (with Undo) and calls onMoved.
 * One picker for the log sheet, the workout log and anything else that moves a task.
 */
export function MoveDayPicker({ session, onMoved, label = 'Move to' }: { session: Session; onMoved?: () => void; label?: string }) {
  const { today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const dates = moveDatesFor(view, session, today);
  if (dates.length === 0) return <span className="xsmall muted">No free day to move it to in the next two weeks.</span>;
  return (
    <div className="chips" role="group" aria-label={label}>
      {dates.map((d) => (
        <button
          key={d}
          type="button"
          className="chip"
          onClick={() => {
            const before = session;
            commit(opsMoveSession(session, d));
            toast(`Moved to ${weekdayName(d)} ${shortDate(d)}`, () => commit(opsRestoreSession(before)));
            onMoved?.();
          }}
        >
          {d === today ? 'Today' : `${weekdayName(d)} ${Number(d.slice(8))}`}
        </button>
      ))}
    </div>
  );
}
