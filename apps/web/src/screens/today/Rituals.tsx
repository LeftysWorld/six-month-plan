import { addDays, type Session } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { minutesText } from '../../data/derive.ts';
import { useView } from '../../data/useView.ts';
import { opsLogSession, opsMoveSession, opsRestoreSession } from '../../data/ops.ts';
import { useToast } from '../../components/ui.tsx';

/** Morning: yesterday's leftovers, today's load against your time, then "Start my day". */
export function MorningPlan({ sessions, available, onDone }: { sessions: Session[]; available: number; onDone: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const yesterday = addDays(today, -1);
  const leftovers = data.sessions.filter((s) => s.date === yesterday && s.status === 'planned');
  const planned = sessions.filter((s) => s.status === 'planned');
  const load = planned.reduce((sum, s) => sum + (s.planned_minutes ?? 0), 0);
  const over = load - available;
  const tomorrow = addDays(today, 1);
  return (
    <div className="tile" style={{ gap: 12, borderColor: 'var(--accent-ink)' }}>
      <div className="row-between">
        <span className="label" style={{ color: 'var(--accent-ink)' }}>Plan your day</span>
        <span className="label">1 minute</span>
      </div>
      {leftovers.length > 0 && (
        <div className="stack-sm">
          <span className="small strong">Left from yesterday</span>
          {leftovers.map((s) => (
            <div key={s.id} className="row-between" style={{ gap: 8 }}>
              <span className="small grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
              {view.canPlace(s, today) && (
                <button className="btn small" onClick={() => { commit(opsMoveSession(s, today)); toast(`${s.title} moved to today`, () => commit(opsRestoreSession(s))); }}>
                  Today
                </button>
              )}
              <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'skipped' })); toast(`${s.title} skipped`, () => commit(opsRestoreSession(s))); }}>
                Let go
              </button>
            </div>
          ))}
        </div>
      )}
      {over > 0 ? (
        <div className="stack-sm">
          <span className="small" style={{ color: 'var(--amber-ink)' }}>
            Today has {minutesText(over)} more than your {minutesText(available)}. Move something to tomorrow?
          </span>
          {planned.slice(-3).reverse().map((s) => (
            <div key={s.id} className="row-between" style={{ gap: 8 }}>
              <span className="small grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.title} · {minutesText(s.planned_minutes)}
              </span>
              {view.canPlace(s, tomorrow) ? (
                <button className="btn small" onClick={() => { commit(opsMoveSession(s, tomorrow)); toast(`${s.title} moved to tomorrow`, () => commit(opsRestoreSession(s))); }}>
                  Tomorrow
                </button>
              ) : (
                <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'skipped' })); toast(`${s.title} skipped today`, () => commit(opsRestoreSession(s))); }}>
                  Skip today
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <span className="small" style={{ color: 'var(--ink-2)' }}>
          {planned.length ? `${planned.length} task${planned.length === 1 ? '' : 's'}, ${minutesText(load)} of your ${minutesText(available)}. It fits.` : 'Nothing planned yet. Add one thing with +.'}
        </span>
      )}
      <button className="btn primary" onClick={onDone}>
        Start my day
      </button>
    </div>
  );
}

/** Evening: tick what you did, roll the rest to tomorrow, done. */
export function EveningWrap({ sessions, onDone }: { sessions: Session[]; onDone: () => void }) {
  const { today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const open = sessions.filter((s) => s.status === 'planned');
  const tomorrow = addDays(today, 1);
  // Only tasks that aren't already on tomorrow can roll over; the rest are simply missed today.
  const movable = open.filter((s) => view.canPlace(s, tomorrow));
  return (
    <div className="tile" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ color: 'var(--accent-ink)' }}>Wrap up today</span>
        <span className="label">{open.length} open</span>
      </div>
      {open.length === 0 ? (
        <span className="small" style={{ color: 'var(--ink-2)' }}>Everything is logged. Good day.</span>
      ) : (
        <div className="stack-sm">
          {open.map((s) => (
            <div key={s.id} className="row-between" style={{ gap: 8 }}>
              <span className="small grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
              <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'done' })); toast(`${s.title} done`, () => commit(opsRestoreSession(s))); }}>
                Did it
              </button>
              {movable.includes(s) ? (
                <button className="btn small" onClick={() => { commit(opsMoveSession(s, tomorrow)); toast(`${s.title} moved to tomorrow`, () => commit(opsRestoreSession(s))); }}>
                  Tomorrow
                </button>
              ) : (
                <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'skipped' })); toast(`${s.title} skipped today`, () => commit(opsRestoreSession(s))); }}>
                  Skip
                </button>
              )}
            </div>
          ))}
          {movable.length > 1 && (
            <button
              className="btn small ghost"
              onClick={() => {
                commit(movable.flatMap((s) => opsMoveSession(s, tomorrow)));
                toast(`Moved ${movable.length} to tomorrow`, () => commit(movable.flatMap((s) => opsRestoreSession(s))));
              }}
            >
              Move {movable.length === open.length ? `all ${open.length}` : `the ${movable.length} that can go`} to tomorrow
            </button>
          )}
        </div>
      )}
      <button className="btn primary" onClick={onDone}>
        Done for today
      </button>
    </div>
  );
}
