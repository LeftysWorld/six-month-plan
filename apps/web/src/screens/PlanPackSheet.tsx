import { useMemo, useState } from 'react';
import { addDays, shortDate, weekdayName } from '@six/core';
import { useStore } from '../data/store.tsx';
import { dayNames, opsApplySplitsPack, OWN_GROUP, previewSplitsPack, PACK } from '../data/planPack.ts';
import { FLEX_GOALS, STRETCH_DAYS } from '../data/plans/splitsBackbend.ts';
import { Sheet, useToast } from '../components/ui.tsx';
import { navigate } from '../router.ts';

/**
 * Review, then apply, the Splits & Backbend Plan to your goals: everything that will change is
 * listed first, and the whole change can be undone from the message afterwards. Applied an earlier
 * version? The same sheet lists what the update changes.
 */
export function PlanPackSheet({ onClose }: { onClose: () => void }) {
  const { data, today, db, commit } = useStore();
  const toast = useToast();
  const p = useMemo(() => previewSplitsPack(data, today), [data, today]);
  const [grouping, setGrouping] = useState<'body' | 'own'>(p.bodyGroup ? 'body' : 'own');
  const [stop, setStop] = useState<string[]>(() => p.stopping.map((s) => s.action.id));
  const [moveWorkouts, setMoveWorkouts] = useState(true);
  const schema = db.schemaWarning?.() ?? null;
  const update = p.state === 'older';
  const blocked = p.state === 'current' ? 'The plan is in your goals and up to date.' : !p.season ? 'Start a season first: the goals need one.' : schema && /stretch/.test(schema) ? schema : null;
  const startText = p.start === today ? 'today' : `${weekdayName(p.start)} ${shortDate(p.start)}`;

  function apply() {
    try {
      const { ops, undo } = opsApplySplitsPack(data, today, { grouping, stop, moveWorkouts });
      commit(ops);
      toast(update ? `${PACK.name} updated: stretching from ${startText}` : `${PACK.name} added: four goals, stretching from ${startText}`, () => commit(undo));
      onClose();
      navigate('/today');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const extras = moveWorkouts ? p.extras : [];

  return (
    <Sheet title={update ? `Update: ${PACK.name}` : PACK.name} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        {update
          ? `Your plan is in from an earlier version. This brings it up to date. Nothing you've logged is lost, and Undo puts it all back.`
          : `Starts ${startText} in ${p.season?.name ?? 'your season'}. Here's everything that will change. Nothing you've logged is lost, and Undo puts it all back.`}
      </span>

      {update && p.updates.length > 0 && (
        <div className="stack-sm">
          <span className="label">What changes</span>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {p.updates.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {!update && (
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
        </div>
      )}
      {p.bodyGroup && (
        <div className="stack-sm">
          {update && <span className="label">Where the goals go</span>}
          <div className="seg" role="radiogroup" aria-label="Where the goals go">
            <button role="radio" aria-checked={grouping === 'body'} onClick={() => setGrouping('body')}>
              In {p.bodyGroup.name}
            </button>
            <button role="radio" aria-checked={grouping === 'own'} onClick={() => setGrouping('own')}>
              Own group: {OWN_GROUP}
            </button>
          </div>
          <span className="xsmall muted">
            {grouping === 'body'
              ? `All four sit in ${p.bodyGroup.name}${p.bodyGroup.prize ? `, and its prize counts all of them` : ''}.`
              : `Your splits goal moves out of ${p.bodyGroup.name}${p.bodyGroup.prize ? `, so ${p.bodyGroup.name}'s prize no longer counts it` : ''}.`}
          </span>
        </div>
      )}

      {!update && (
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
          <span className="xsmall muted">Each one opens like a workout: the holds in order, a timer for each set, last time's times beside them. Wednesday and Sunday off.</span>
        </div>
      )}

      {p.stopping.length > 0 && (
        <div className="stack-sm">
          <span className="label">Stops after {shortDate(addDays(p.start, -1))} (history kept)</span>
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
          <span className="label">Workouts off Wednesday, from this week</span>
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
              {extras.map((s) => (
                <li key={s.id}>
                  Removes the extra {s.title} {s.date ? `on ${weekdayName(s.date)}` : 'this week'}
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
          {update ? 'Update the plan' : 'Apply the plan'}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * On Today, while the plan is waiting to go in (or an earlier version needs its update): one line
 * and a button to review it. "Not now" hides it until there's something new to apply.
 */
export function PlanPackNudge() {
  const { data, today } = useStore();
  const [open, setOpen] = useState(false);
  const p = useMemo(() => previewSplitsPack(data, today), [data, today]);
  const key = `six.planpack.dismissed.${p.state}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (open) return <PlanPackSheet onClose={() => setOpen(false)} />;
  if (hidden || !p.season || p.state === 'current' || (p.state === 'none' && !p.existingGoal)) return null;
  return (
    <div className="banner info row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
      <span className="small">
        {p.state === 'older' ? (
          <>
            <b>{PACK.name}:</b> an update is ready. {p.updates[0] ?? 'This week’s workouts get fixed'}.
          </>
        ) : (
          <>
            <b>{PACK.name}</b> is ready to go in, starting {p.start === today ? 'today' : `${weekdayName(p.start)} ${shortDate(p.start)}`}.
          </>
        )}
      </span>
      <span className="row-start" style={{ gap: 8 }}>
        <button
          type="button"
          className="link-btn small"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(key, '1');
            } catch {
              // storage blocked: hidden for now
            }
          }}
        >
          Not now
        </button>
        <button type="button" className="btn small primary" onClick={() => setOpen(true)}>
          Review
        </button>
      </span>
    </div>
  );
}
