import { useState } from 'react';
import { STARTER_ROUTINE, WAKE_CHOICES, afterWaking, cleanRoutine, clockMinutes, clockValue, dailyRoutine, timeOfDay, type RoutineItem } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { opsProfile } from '../../data/ops.ts';
import { Sheet, useToast } from '../../components/ui.tsx';

type Row = RoutineItem & { key: string };
const newKey = () => crypto.randomUUID();

/**
 * Your day, yours to write: the wake-up time and each thing you do at a set time (a meal, a walk,
 * vitamins, lights out). Every time is kept as "so long after waking", so moving the wake-up moves
 * the day with it. A routine not set up yet starts from the two ends of the day. Saved on your
 * profile only.
 */
export function RoutineEditor({ onClose }: { onClose: () => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const before = data.profile.daily_routine ?? null;
  const saved = dailyRoutine(before);
  const [wake, setWake] = useState(saved.wake);
  const [rows, setRows] = useState<Row[]>(() => (saved.items.length ? saved.items : STARTER_ROUTINE.items).map((item) => ({ ...item, key: newKey() })));

  const change = (key: string, patch: Partial<RoutineItem>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRows((list) => list.filter((r) => r.key !== key));
  const add = () =>
    setRows((list) => {
      const latest = list.reduce((m, r) => Math.max(m, r.at), 0);
      // An hour after the latest so far, and inside the day.
      return [...list, { key: newKey(), at: Math.min(1439, latest + 60), what: '' }];
    });

  const save = () => {
    const next = cleanRoutine(wake, rows.map(({ key: _key, ...item }) => item));
    commit(opsProfile({ daily_routine: next }));
    toast(next.items.length ? `Your day is saved · up at ${timeOfDay(next.wake)}` : 'Your day is cleared', () => commit(opsProfile({ daily_routine: before })));
    onClose();
  };

  const wakeChoices = WAKE_CHOICES.includes(wake) ? WAKE_CHOICES : [...WAKE_CHOICES, wake].sort((a, b) => a - b);

  return (
    <Sheet title="Your day" onClose={onClose}>
      <label className="field">
        Up at
        <select value={wake} onChange={(e) => setWake(Number(e.target.value))}>
          {wakeChoices.map((m) => (
            <option key={m} value={m}>
              {timeOfDay(m)}
            </option>
          ))}
        </select>
      </label>
      <div className="small muted">Each time is kept as so long after you wake, so changing your wake-up moves the whole day with it.</div>
      <div className="stack-sm">
        {rows.map((r) => (
          <div key={r.key} className="card stack-sm">
            <div className="row-start" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <input
                className="input"
                type="time"
                aria-label="Time"
                style={{ width: 'auto', flex: 'none' }}
                value={clockValue(wake + r.at)}
                onChange={(e) => {
                  const clock = clockMinutes(e.target.value);
                  if (clock != null) change(r.key, { at: afterWaking(wake, clock) });
                }}
              />
              <input className="input" type="text" aria-label="What you do" placeholder="e.g. Breakfast, Walk, Vitamins" style={{ flex: 1, minWidth: 0 }} value={r.what} onChange={(e) => change(r.key, { what: e.target.value })} />
            </div>
            <input
              className="input"
              type="text"
              aria-label="Note"
              placeholder="A note (optional)"
              value={r.note ?? ''}
              // A rest-day wording belonged to the note it replaced.
              onChange={(e) => change(r.key, { note: e.target.value, rest_note: undefined })}
            />
            <div className="row-between" style={{ gap: 8 }}>
              <select
                className="input"
                aria-label="Which days"
                style={{ width: 'auto' }}
                value={r.on ?? ''}
                onChange={(e) => {
                  const on: string = e.target.value;
                  change(r.key, { on: on === 'lift' || on === 'rest' ? on : undefined });
                }}
              >
                <option value="">Every day</option>
                <option value="lift">Workout days only</option>
                <option value="rest">Rest days only</option>
              </select>
              <button type="button" className="link-btn small" onClick={() => remove(r.key)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={add}>
          Add a time
        </button>
      </div>
      <div className="row-between" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
