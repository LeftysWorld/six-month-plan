import { addDays, shortDate, weekStart } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { fmt } from '../../data/derive.ts';
import { deloadFor, opsPhase, opsSkipDeload, phasePrompt } from '../../data/progress.ts';
import { useToast } from '../../components/ui.tsx';

/**
 * Training notices on Today: a deload week (it starts on its own; "Not this week" moves it), and
 * the end of the cut (asked first: switch to build, or not yet for a week).
 */
export function TrainingNotices() {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const monday = weekStart(today);
  const deload = deloadFor(data, monday);
  const phase = phasePrompt(data, today);
  if (!deload.now && !phase) return null;
  const weekDone = data.sessions.some((s) => s.date && weekStart(s.date) === monday && s.status !== 'planned' && data.actions.find((a) => a.id === s.action_id)?.kind === 'workout');
  return (
    <>
      {deload.now && (
        <div className="banner info deload-banner" role="status">
          <span>
            <b>Deload week</b>
            {deload.reason ? ` · ${deload.reason}` : ''}. Each workout has half its sets at the same weights, with 3–4 reps left on every set.
          </span>
          {!weekDone && (
            <button
              type="button"
              className="link-btn small"
              onClick={() => {
                const { ops, undo } = opsSkipDeload(data, monday);
                commit(ops);
                toast('Deload moved to next week', () => commit(undo));
              }}
            >
              Not this week
            </button>
          )}
        </div>
      )}
      {phase && (
        <div className="card stack-sm phase-card" role="status">
          <span className="label">The cut is done</span>
          <span>
            Your 7-day average is <b>{fmt(phase.average)} lb</b>, at or under {fmt(phase.target)}. Switch to build? Calories go to maintenance or a small surplus (+200–300 a day). The training rules stay the same.
          </span>
          <span className="btn-row" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn primary small"
              onClick={() => {
                const { ops, undo } = opsPhase(data, { build: true, today });
                commit(ops);
                toast('Switched to build', () => commit(undo));
              }}
            >
              Switch to build
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const until = addDays(today, 7);
                const { ops, undo } = opsPhase(data, { snooze: until });
                commit(ops);
                toast(`Asking again after ${shortDate(until)}`, () => commit(undo));
              }}
            >
              Not yet
            </button>
          </span>
        </div>
      )}
    </>
  );
}

