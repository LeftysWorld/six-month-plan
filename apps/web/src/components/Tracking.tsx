import { useState } from 'react';
import { addDays, shortDate, type Goal, type MeasurementType } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { fmt } from '../data/derive.ts';
import { findMeasure, measureLabel, measureOnToday, measuredDaily } from '../data/connect.ts';
import { daysText, opsAddPhotoTracker, opsStopPhotoTracker, photoTrackers } from '../data/tracking.ts';
import { opsAddMeasurementType, opsDeleteMeasurement, opsLogReading, opsUpdateGoal } from '../data/ops.ts';
import { NumberInput } from './ui.tsx';

/**
 * Tracking, shared by a goal's page and a group's page: one row per thing tracked (a number like
 * "Center split", or a photo), with its latest reading and the change since the
 * first, a box to log today's, and the form to track something new and link it to a goal.
 */

/** Every number a goal tracks: its own measurements and its main number. */
export function goalMeasures(data: ReturnType<typeof useStore>['data'], goal: Goal): MeasurementType[] {
  const types = data.measurementTypes.filter((t) => !t.archived_at && (t.goal_id === goal.id || t.id === goal.measurement_type_id));
  return [...types].sort((a, b) => Number(b.id === goal.measurement_type_id) - Number(a.id === goal.measurement_type_id));
}

/** Track a new number or photo. With more than one goal to pick from, it asks which goal it belongs to. */
export function TrackForm({ goals, goalId: initialGoal, onDone }: { goals: Goal[]; goalId?: string; onDone: (msg: string) => void }) {
  const { data, today, commit } = useStore();
  const [kind, setKind] = useState<'number' | 'photo'>('number');
  const [goalId, setGoalId] = useState(initialGoal ?? goals[0]?.id ?? '');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('in');
  const [cadence, setCadence] = useState(7);
  const [photoName, setPhotoName] = useState('Progress photo');
  const [photoDays, setPhotoDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [first, setFirst] = useState<number | null>(null);
  const goal = goals.find((g) => g.id === goalId);

  const goalPicker = goals.length > 1 && (
    <label className="field">
      For which goal
      <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
        {goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="stack-sm track-form">
      <div className="seg" role="tablist" aria-label="What to track">
        <button role="tab" aria-selected={kind === 'number'} onClick={() => setKind('number')}>
          A number
        </button>
        <button role="tab" aria-selected={kind === 'photo'} onClick={() => setKind('photo')}>
          A photo
        </button>
      </div>
      {kind === 'number' ? (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !goal) return;
            if (findMeasure(data, goal.id, name, unit)) {
              onDone(`Already tracking ${name.trim().toLowerCase()}`);
              return;
            }
            const ops = opsAddMeasurementType({ name: name.trim(), unit: unit.trim(), cadence_days: cadence, goal_id: goal.id });
            const typeId = ops[0]!.kind === 'insert' ? ops[0]!.rows[0]!.id : null;
            commit([...ops, ...(first != null && typeId ? opsLogReading(data, typeId, first, today) : [])]);
            onDone(`Added ${name.trim()}${goals.length > 1 ? ` to ${goal.title}` : ''}`);
          }}
        >
          {goalPicker}
          <div className="grid-3">
            <label className="field">
              Name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Waist" />
            </label>
            <label className="field">
              Unit
              <input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            <label className="field">
              Every (days)
              <input type="number" min={1} max={90} value={cadence} onChange={(e) => setCadence(Number(e.target.value))} />
            </label>
          </div>
          <NumberInput label={`Today's reading (${unit || 'optional'}), optional`} value={first} onChange={setFirst} />
          <span className="xsmall muted">{cadence <= 1 ? 'Every day: it shows on Today with your other numbers.' : 'It shows on its goal page and the group page; turn on “Show on Today” in its settings to log it from Today too.'}</span>
          <button className="btn small primary" type="submit" disabled={!name.trim() || !goal}>
            Track it
          </button>
        </form>
      ) : (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!goal) return;
            commit(opsAddPhotoTracker(data, goal.id, photoName, photoDays, today));
            onDone(`Added ${photoName.trim() || 'Progress photo'}${goals.length > 1 ? ` to ${goal.title}` : ''}`);
          }}
        >
          {goalPicker}
          <label className="field">
            Name
            <input value={photoName} onChange={(e) => setPhotoName(e.target.value)} placeholder="Progress photo" />
          </label>
          <div className="chips" role="group" aria-label="Days">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => {
              const on = photoDays.includes(i + 1);
              return (
                <button key={d} type="button" className="chip" aria-pressed={on} onClick={() => setPhotoDays(on ? photoDays.filter((x) => x !== i + 1) : [...photoDays, i + 1])}>
                  {d}
                </button>
              );
            })}
            <button type="button" className="chip" onClick={() => setPhotoDays([1, 2, 3, 4, 5, 6, 7])}>
              Every day
            </button>
          </div>
          <span className="xsmall muted">On those days it shows on Today with your numbers, with a camera button. Photos collect on the goal.</span>
          <button className="btn small primary" type="submit" disabled={photoDays.length === 0 || !goal}>
            Track this photo
          </button>
        </form>
      )}
    </div>
  );
}

/** "−1.5 in since Oct 30", or nothing with fewer than two readings. */
function changeText(first: { value: number; measured_on: string } | undefined, last: { value: number; measured_on: string } | undefined, unit: string): string {
  if (!first || !last || first === last) return '';
  const d = last.value - first.value;
  if (Math.abs(d) < 1e-9) return `no change since ${shortDate(first.measured_on)}`;
  return `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))} ${unit} since ${shortDate(first.measured_on)}`.replace('  ', ' ');
}

/**
 * One tracked number: latest reading and the change since the first, a box to log today's (a
 * second entry the same day replaces the first), every reading, and its settings. `goals` adds a
 * picker to link it to another goal (on a group's page).
 */
export function MeasureRow({ type, goal, goals, canLog = true, onMsg }: { type: MeasurementType; goal: Goal; goals?: Goal[]; canLog?: boolean; onMsg: (msg: string) => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const [value, setValue] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; unit: string } | null>(null);
  const [settings, setSettings] = useState(false);
  const main = type.id === goal.measurement_type_id;
  const readings = view.measurementsFor(type.id);
  const first = readings[0];
  const last = readings.at(-1);
  const onToday = measureOnToday(data, type.id);
  const update = (patch: Partial<MeasurementType>) => commit([{ kind: 'update', collection: 'measurementTypes', id: type.id, patch }]);
  const due = !last || last.measured_on <= addDays(today, -type.cadence_days);

  return (
    <div className="track-row">
      {renaming ? (
        <form
          className="row-start"
          style={{ flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!renaming.name.trim()) return;
            update({ name: renaming.name.trim(), unit: renaming.unit.trim() });
            if (main && goal.unit !== renaming.unit.trim()) commit(opsUpdateGoal(goal, { unit: renaming.unit.trim() }));
            onMsg(`Renamed to ${measureLabel({ name: renaming.name.trim(), unit: renaming.unit })}`);
            setRenaming(null);
          }}
        >
          <input className="input" aria-label="Measurement name" autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
          <input className="input" aria-label="Unit" style={{ width: 72, flex: 'none' }} value={renaming.unit} onChange={(e) => setRenaming({ ...renaming, unit: e.target.value })} />
          <button className="btn small primary" type="submit" style={{ flex: 'none', minHeight: 44 }}>
            Save
          </button>
          <button className="btn small" type="button" style={{ flex: 'none', minHeight: 44 }} onClick={() => setRenaming(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="track-row-head">
          <span className="track-row-name">
            <b className="small">{type.name}</b>
            <span className="xsmall muted">
              {main ? 'main number · ' : ''}every {type.cadence_days <= 1 ? 'day' : `${type.cadence_days} days`}
              {onToday ? ' · on Today' : ''}
              {due && canLog ? ' · due' : ''}
            </span>
          </span>
          <span className="track-row-value">
            <b className="num">{last ? `${fmt(last.value)} ${type.unit}` : '—'}</b>
            <span className="xsmall muted">{last ? `${shortDate(last.measured_on)}${changeText(first, last, type.unit) ? ` · ${changeText(first, last, type.unit)}` : ''}` : 'no readings yet'}</span>
          </span>
        </div>
      )}
      {canLog && (
        <form
          className="track-log"
          onSubmit={(e) => {
            e.preventDefault();
            if (value == null) return;
            commit(opsLogReading(data, type.id, value, today));
            onMsg(`Logged ${fmt(value)} ${type.unit}: ${type.name.toLowerCase()}`);
            setValue(null);
          }}
        >
          <NumberInput label={`Today (${type.unit || 'value'})`} value={value} onChange={setValue} />
          <button className="btn small" type="submit" disabled={value == null} style={{ alignSelf: 'end', minHeight: 44 }}>
            Log
          </button>
        </form>
      )}
      <div className="row-start" style={{ gap: 14 }}>
        {readings.length > 0 && (
          <details className="track-readings">
            <summary className="xsmall muted">All {readings.length} reading{readings.length === 1 ? '' : 's'}</summary>
            <table className="table">
              <tbody>
                {[...readings].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>{shortDate(r.measured_on)}</td>
                    <td>
                      {fmt(r.value)} {type.unit}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="link-btn xsmall" onClick={() => commit(opsDeleteMeasurement(r.id))} aria-label={`Delete reading from ${shortDate(r.measured_on)}`}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        <button type="button" className="link-btn xsmall" onClick={() => setSettings(!settings)} aria-expanded={settings}>
          {settings ? 'Done' : 'Settings'}
        </button>
      </div>
      {settings && (
        <div className="stack-sm track-settings">
          <label className="row-start small" style={{ gap: 6, cursor: measuredDaily(type) ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={onToday}
              disabled={measuredDaily(type)}
              onChange={(e) => {
                update({ on_today: e.target.checked });
                onMsg(e.target.checked ? `Showing ${type.name.toLowerCase()} on Today` : `Hidden ${type.name.toLowerCase()} from Today`);
              }}
            />
            {measuredDaily(type) ? 'On Today every day (it’s a daily number)' : 'Show on Today'}
          </label>
          <label className="row-start small" style={{ gap: 6 }}>
            Every
            <input className="input" type="number" min={1} max={90} style={{ width: 70 }} value={type.cadence_days} onChange={(e) => Number(e.target.value) > 0 && update({ cadence_days: Number(e.target.value) })} aria-label="Every how many days" />
            days
          </label>
          {goals && goals.length > 1 && !main && (
            <label className="row-start small" style={{ gap: 6 }}>
              Goal
              <select
                value={goal.id}
                onChange={(e) => {
                  const to = goals.find((g) => g.id === e.target.value);
                  if (!to) return;
                  update({ goal_id: to.id });
                  onMsg(`${type.name} now belongs to ${to.title}`);
                }}
              >
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="row-start" style={{ gap: 14 }}>
            <button type="button" className="link-btn xsmall" onClick={() => setRenaming({ name: type.name, unit: type.unit })}>
              Rename
            </button>
            {!main && (
              <button
                type="button"
                className="link-btn xsmall"
                onClick={() => {
                  // Archived, not deleted: past readings stay in your export.
                  update({ archived_at: new Date().toISOString() });
                  onMsg(`Stopped tracking ${type.name.toLowerCase()}`);
                }}
              >
                Stop tracking
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/** A photo tracker: how many photos, the last one, and stop. */
export function PhotoRow({ goalId, onMsg }: { goalId: string; onMsg: (msg: string) => void }) {
  const { data, today, commit } = useStore();
  const photos = photoTrackers(data, goalId, today);
  return (
    <>
      {photos.map(({ action, schedule }) => {
        const taken = data.attachments.filter((f) => data.sessions.some((s) => s.id === f.session_id && s.action_id === action.id));
        const lastDay = data.sessions.filter((s) => s.action_id === action.id && data.attachments.some((f) => f.session_id === s.id)).map((s) => s.date ?? '').sort().at(-1);
        return (
          <div key={action.id} className="track-row">
            <div className="track-row-head">
              <span className="track-row-name">
                <b className="small">{action.title}</b>
                <span className="xsmall muted">photo · {schedule ? daysText(schedule.days) : ''}</span>
              </span>
              <span className="track-row-value">
                <b className="num">{taken.length}</b>
                <span className="xsmall muted">{taken.length ? `photo${taken.length === 1 ? '' : 's'} · last ${shortDate(lastDay!)}` : 'no photos yet'}</span>
              </span>
            </div>
            <div className="row-start" style={{ gap: 14 }}>
              <span className="xsmall muted">Shows on Today on its days</span>
              <button
                type="button"
                className="link-btn xsmall"
                onClick={() => {
                  commit(opsStopPhotoTracker(data, action, today));
                  onMsg(`Stopped tracking ${action.title.toLowerCase()}`);
                }}
              >
                Stop tracking
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * Everything a group's goals track, goal by goal, and the one place to track something new for
 * any of them (picking which goal it belongs to).
 */
export function GroupTracking({ goals, onMsg }: { goals: Goal[]; onMsg: (msg: string) => void }) {
  const { data, today } = useStore();
  const [adding, setAdding] = useState(false);
  const rows = goals.map((g) => ({ goal: g, types: goalMeasures(data, g), photos: photoTrackers(data, g.id, today).length }));
  const total = rows.reduce((n, r) => n + r.types.length + r.photos, 0);
  return (
    <section className="card stack-sm" aria-label="Tracking">
      <div className="row-between">
        <span className="stack-sm" style={{ gap: 0 }}>
          <span className="label">Tracking</span>
          <span className="xsmall muted">
            {total} thing{total === 1 ? '' : 's'} across {goals.length} goal{goals.length === 1 ? '' : 's'}
          </span>
        </span>
        <button className="btn small" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ Track something'}
        </button>
      </div>
      {adding && (
        <TrackForm
          goals={goals}
          onDone={(msg) => {
            onMsg(msg);
            if (!/^Already/.test(msg)) setAdding(false);
          }}
        />
      )}
      <div className="track-groups">
        {rows.map(({ goal, types, photos }) => (
          <div key={goal.id} className="track-goal">
            <a className="track-goal-name small" href={`#/goals/${goal.id}`}>
              <span className="dot" style={{ background: goal.color }} />
              {goal.title}
            </a>
            {types.length === 0 && photos === 0 && <span className="xsmall muted">Nothing tracked yet.</span>}
            {types.map((t) => (
              <MeasureRow key={t.id} type={t} goal={goal} goals={goals} onMsg={onMsg} />
            ))}
            <PhotoRow goalId={goal.id} onMsg={onMsg} />
          </div>
        ))}
      </div>
    </section>
  );
}
