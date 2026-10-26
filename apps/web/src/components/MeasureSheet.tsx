import { useState } from 'react';
import { shortDate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { lastReading, opsLogMeasure, readingOn } from '../data/connect.ts';
import { Sheet, useToast } from './ui.tsx';

/** Check off a measure task: type the day's number (pre-filled with the last reading) and save. */
export function MeasureSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const action = view.action(session.action_id);
  const type = data.measurementTypes.find((t) => t.id === action?.measurement_type_id);
  const day = session.date ?? today;
  const last = lastReading(data, type?.id);
  const [value, setValue] = useState<string>(() => {
    const already = readingOn(data, type?.id, day);
    return already != null ? String(already) : last ? String(last.value) : '';
  });
  const num = value.trim() === '' ? null : Number(value);
  const ok = num != null && Number.isFinite(num);

  function save() {
    if (!action || !ok) return;
    const { ops, undo } = opsLogMeasure(data, session, action, num!, day);
    commit(ops);
    toast(`${type?.name ?? action.title}: ${fmt(num!)}${type?.unit ? ` ${type.unit}` : ''}`, () => commit(undo));
    onClose();
  }

  return (
    <Sheet title={action?.title ?? 'Log it'} onClose={onClose}>
      {!type ? (
        <span className="small muted">This task doesn't record a measurement yet. Edit it on its goal page and choose what it records.</span>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="field">
            {type.name}
            {type.unit ? ` (${type.unit})` : ''}
            <input autoFocus type="number" inputMode="decimal" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          {last && <span className="xsmall muted">Last: {fmt(last.value)}{type.unit ? ` ${type.unit}` : ''} on {shortDate(last.date)}. Saving checks the task off and updates every goal that tracks {type.name.toLowerCase()}.</span>}
          <button className="btn primary" type="submit" disabled={!ok}>
            Save and check off
          </button>
        </form>
      )}
    </Sheet>
  );
}
