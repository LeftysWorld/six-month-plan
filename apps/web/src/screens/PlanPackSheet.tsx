import { useMemo, useState } from 'react';
import { shortDate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { dayNames, opsApplySplitsPack, previewSplitsPack, PACK } from '../data/planPack.ts';
import { FLEX_GOALS, STRETCH_DAYS } from '../data/plans/splitsBackbend.ts';
import { Sheet, useToast } from '../components/ui.tsx';
import { navigate } from '../router.ts';

/**
 * Review, then apply, the Splits & Backbend Plan to your goals: everything that will change is
 * listed first, and the whole change can be undone from the message afterwards.
 */
export function PlanPackSheet({ onClose }: { onClose: () => void }) {
  const { data, today, db, commit } = useStore();
  const toast = useToast();
  const p = useMemo(() => previewSplitsPack(data, today), [data, today]);
  const [grouping, setGrouping] = useState<'own' | 'existing'>('own');
  const [stop, setStop] = useState<string[]>(() => p.stopping.map((s) => s.action.id));
  const [moveWorkouts, setMoveWorkouts] = useState(true);
  const schema = db.schemaWarning?.() ?? null;
  const blocked = p.alreadyApplied ? 'The plan is already in your goals.' : !p.season ? 'Start a season first: the goals need one.' : schema && /stretching/.test(schema) ? schema : null;

  function apply() {
    try {
      const { ops, undo } = opsApplySplitsPack(data, today, { grouping, stop, moveWorkouts });
      commit(ops);
      toast(`${PACK.name} added: four goals, five stretching days from ${shortDate(p.start)}`, () => commit(undo));
      onClose();
      navigate('/goals');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <Sheet title={PACK.name} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        Starts {shortDate(p.start)} in {p.season?.name ?? 'your season'}. Here's everything that will change. Nothing you've logged is lost, and Undo puts it all back.
      </span>

      <div className="stack-sm">
        <span className="label">Goals</span>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {FLEX_GOALS.map((g) => (
            <li key={g.key}>
              <b>{g.title}</b>
              {g.key === 'front' && p.existingGoal ? ` (your “${p.existingGoal.title}” goal, renamed)` : ' (new)'}
              {g.measures.length ? ` · measures: ${g.measures.map((m) => m.name.split(':')[0]).join(', ')}` : ''}
            </li>
          ))}
        </ul>
        {p.existingGroup && (
          <div className="seg" role="radiogroup" aria-label="Where the goals go">
            <button role="radio" aria-checked={grouping === 'own'} onClick={() => setGrouping('own')}>
              Own group: Splits & backbend
            </button>
            <button role="radio" aria-checked={grouping === 'existing'} onClick={() => setGrouping('existing')}>
              In {p.existingGroup.name}
            </button>
          </div>
        )}
        {p.existingGroup && (
          <span className="xsmall muted">
            {grouping === 'own'
              ? `Your splits goal moves out of ${p.existingGroup.name}${p.existingGroup.prize ? `, so ${p.existingGroup.name}'s prize no longer counts it` : ''}.`
              : `All four join ${p.existingGroup.name}${p.existingGroup.prize ? `, so its prize counts all of them` : ''}.`}
          </span>
        )}
      </div>

      <div className="stack-sm">
        <span className="label">Stretching tasks, shared by all four goals</span>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {STRETCH_DAYS.map((d) => (
            <li key={d.day}>
              {d.title} · {d.plan.holds.length} holds · about {d.minutes} min
            </li>
          ))}
          {p.checks.length > 0 && <li>Monthly flexibility check: {p.checks.map(shortDate).join(', ')}</li>}
        </ul>
        <span className="xsmall muted">Wednesday and Sunday off.</span>
      </div>

      {p.stopping.length > 0 && (
        <div className="stack-sm">
          <span className="label">Stops {shortDate(p.start)} (history kept)</span>
          {p.stopping.map((s) => (
            <label key={s.action.id} className="check-row small">
              <input type="checkbox" checked={stop.includes(s.action.id)} onChange={(e) => setStop(e.target.checked ? [...stop, s.action.id] : stop.filter((x) => x !== s.action.id))} />
              <span>
                <b>{s.action.title}</b>: {s.why}
              </span>
            </label>
          ))}
        </div>
      )}

      {p.moving.length > 0 && (
        <div className="stack-sm">
          <span className="label">Workouts off Wednesday, from {shortDate(p.start)}</span>
          <label className="check-row small">
            <input type="checkbox" checked={moveWorkouts} onChange={(e) => setMoveWorkouts(e.target.checked)} />
            <span>Train Mon, Tue, Thu, Fri, Sat; rest Wed and Sun</span>
          </label>
          {moveWorkouts && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {p.moving.map((m) => (
                <li key={m.action.id}>
                  {m.action.title}: {dayNames(m.from)} → <b>{dayNames(m.to)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {blocked && <div className="banner warn">{blocked}</div>}
      <div className="row-between">
        <button type="button" className="link-btn" onClick={onClose}>
          Not now
        </button>
        <button type="button" className="btn primary" disabled={!!blocked} onClick={apply}>
          Apply the plan
        </button>
      </div>
    </Sheet>
  );
}
