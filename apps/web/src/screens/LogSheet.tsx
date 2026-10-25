import { useState } from 'react';
import { addDays, shortDate, weekDates, weekStart, weekdayName, type Session, type SessionStatus } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsLogSession, opsMoveSession, opsRestoreSession } from '../data/ops.ts';
import { href } from '../router.ts';
import { OBSTACLES, Sheet, useToast } from '../components/ui.tsx';
import { SessionFiles } from '../components/Attachments.tsx';
import { lastReading, opsRecordReading, readingOn } from '../data/connect.ts';

/** Log an item beyond a one-tap check: amount, state, obstacles, note, or move it. */
export function LogSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const { data, commit, today } = useStore();
  const view = useView();
  const toast = useToast();
  const action = view.action(session.action_id);
  const goal = view.goalsForAction(session.action_id)[0];
  const countBased = session.planned_count != null;

  const [status, setStatus] = useState<SessionStatus>(session.status === 'planned' ? 'done' : session.status);
  const [count, setCount] = useState<number>(session.actual_count ?? session.planned_count ?? 0);
  const [minutes, setMinutes] = useState<number | null>(session.actual_minutes ?? (session.planned_minutes || null));
  const [obstacles, setObstacles] = useState<string[]>(session.obstacles);
  const [note, setNote] = useState(session.note);
  const [moving, setMoving] = useState(false);
  // A measure task records the day's number (e.g. weight) along with the log.
  const isMeasure = action?.kind === 'measure';
  const measureType = isMeasure ? data.measurementTypes.find((t) => t.id === action?.measurement_type_id) : undefined;
  const [reading, setReading] = useState<string>(() => {
    if (!measureType) return '';
    const day = readingOn(data, measureType.id, session.date ?? today);
    return day != null ? String(day) : String(lastReading(data, measureType.id)?.value ?? '');
  });
  const noTime = action?.kind === 'measure' || action?.kind === 'photo';

  const minLabel = action?.min_label;
  const states: { value: SessionStatus; title: string; sub: string; amber?: boolean }[] = [
    { value: 'done', title: 'Done', sub: 'Full target met' },
    { value: 'partial', title: 'Partial', sub: countBased ? `${count} of ${session.planned_count}` : 'Some of it', amber: true },
    { value: 'minimum', title: 'Minimum kept', sub: minLabel ? `Showed up: ${minLabel}` : 'Showed up', amber: true },
    { value: 'skipped', title: 'Skip today', sub: 'No penalty' },
  ];

  function save() {
    const before = session;
    const value = reading.trim() === '' ? null : Number(reading);
    const record = measureType && status !== 'skipped' && value != null && Number.isFinite(value) ? opsRecordReading(data, measureType.id, value, session.date ?? today) : { ops: [], undo: [] };
    commit([
      ...record.ops,
      ...opsLogSession(session, {
        status,
        actual_count: countBased ? count : null,
        actual_minutes: noTime ? minutes ?? 0 : minutes,
        obstacles,
        note,
        on: today,
      }),
    ]);
    toast(`${session.title}: ${states.find((s) => s.value === status)?.title.toLowerCase()}`, () => commit([...record.undo, ...opsRestoreSession(before)]));
    onClose();
  }

  function moveTo(date: string | null) {
    const before = session;
    commit(opsMoveSession(session, date));
    toast(date ? `Moved to ${weekdayName(date)} ${shortDate(date)}` : 'Moved to any day this week', () => commit(opsRestoreSession(before)));
    onClose();
  }

  const monday = weekStart(session.date ?? today);
  // A task happens at most once a day, so days that already have it aren't offered.
  const moveDates = [...weekDates(monday), ...weekDates(addDays(monday, 7))].filter((d) => d >= today && d !== session.date && view.canPlace(session, d));

  return (
    <Sheet title={session.title} onClose={onClose}>
      {goal && (
        <div className="row-start small muted" style={{ marginTop: -8 }}>
          <span className="dot" style={{ background: goal.color }} />
          Supports: {goal.title}
          {action?.cue ? ` · ${action.cue}` : ''}
        </div>
      )}
      {moving ? (
        <div className="stack-sm">
          <div className="small muted">Move this one only. To change how often it happens, edit the task on its goal page.</div>
          <div className="grid-3">
            {moveDates.map((d) => (
              <button key={d} className="btn small" onClick={() => moveTo(d)}>
                {d === today ? 'Today' : `${weekdayName(d)} ${shortDate(d).split(' ')[1]}`}
              </button>
            ))}
          </div>
          {session.origin === 'scheduled' && (
            <button className="btn small" onClick={() => moveTo(null)}>
              Back to "any day this week"
            </button>
          )}
          {goal && (
            <a className="small" href={href(`/goals/${goal.id}`)} onClick={onClose}>
              Change how often it happens instead
            </a>
          )}
          <button className="link-btn" onClick={() => setMoving(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          {countBased ? (
            <div className="card tight row-between">
              <div>
                <div className="xsmall muted">Done</div>
                <div className="xsmall muted">
                  Planned {session.planned_count}
                  {action?.min_count ? ` · minimum ${action.min_count}` : ''}
                </div>
              </div>
              <div className="stepper">
                <button aria-label="Decrease" onClick={() => setCount(Math.max(0, count - 1))}>
                  −
                </button>
                <span className="num" style={{ fontSize: 28, width: 28, textAlign: 'center' }}>
                  {count}
                </span>
                <button aria-label="Increase" onClick={() => setCount(count + 1)}>
                  +
                </button>
              </div>
            </div>
          ) : null}
          {measureType && (
            <label className="field">
              {measureType.name}
              {measureType.unit ? ` (${measureType.unit})` : ''}
              <input type="number" inputMode="decimal" step="any" value={reading} onChange={(e) => setReading(e.target.value)} />
            </label>
          )}
          {!noTime && (
            <label className="field">
              Minutes spent {session.planned_minutes ? `(planned ${session.planned_minutes})` : ''}
              <input type="number" inputMode="numeric" min={0} value={minutes ?? ''} onChange={(e) => setMinutes(e.target.value === '' ? null : Number(e.target.value))} />
            </label>
          )}
          <div className="grid-2" role="radiogroup" aria-label="How did it go?">
            {states.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={status === s.value}
                aria-pressed={status === s.value}
                className={`choice ${s.amber ? 'amber' : ''}`}
                onClick={() => setStatus(s.value)}
              >
                <b>{s.title}</b>
                <span>{s.sub}</span>
              </button>
            ))}
          </div>
          <div className="stack-sm">
            <div className="xsmall muted">What got in the way? (optional)</div>
            <div className="chips">
              {OBSTACLES.map((o) => (
                <button
                  key={o}
                  className="chip"
                  aria-pressed={obstacles.includes(o)}
                  onClick={() => setObstacles(obstacles.includes(o) ? obstacles.filter((x) => x !== o) : [...obstacles, o])}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            Note
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <SessionFiles session={session} />
          <div className="btn-row">
            <button className="btn" onClick={() => setMoving(true)}>
              Move to another day
            </button>
            <button className="btn primary" onClick={save}>
              Save
            </button>
          </div>
          {session.status !== 'planned' && (
            <button
              className="link-btn"
              onClick={() => {
                commit(opsLogSession(session, { status: 'planned', actual_count: null, actual_minutes: null }));
                onClose();
              }}
            >
              Clear this log
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}
