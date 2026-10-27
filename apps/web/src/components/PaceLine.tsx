import { useState } from 'react';
import { currentTargets, daysBetween, projectNumberGoal, shortDate, suggestPath, type Goal, type ISODate, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { fmt } from '../data/derive.ts';
import { opsReplacePath } from '../data/ops.ts';
import type { Op } from '../data/model.ts';
import { useToast } from './ui.tsx';

/**
 * Pace in plain words, with a lever. "You're 1.8 lb behind the path. At your last four weeks'
 * rate you reach 155 on May 14, 18 days after your date." Then two buttons: move the date to the
 * projection (the app says what that does to the on-time bonus), or open the week goal and change
 * what you do. The number is never left for you to interpret.
 */
export function PaceLine({ goal, plan, onWeek }: { goal: Goal; plan: Plan; onWeek: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  if (goal.type !== 'number' || goal.target_value == null) return null;
  const pace = view.goalPace(goal, plan).number;
  const readings = view.measurementsFor(goal.measurement_type_id);
  const by = goal.target_date ?? plan.end_date;
  const proj = projectNumberGoal({ target_value: goal.target_value, target_date: by }, readings, today);
  const unit = goal.unit ?? '';
  if (!pace || pace.trend == null) return null;

  const parts: string[] = [];
  if (pace.aheadBy != null && Math.abs(pace.aheadBy) >= 0.1) parts.push(`You’re ${fmt(Math.abs(pace.aheadBy))} ${unit} ${pace.aheadBy > 0 ? 'ahead of' : 'behind'} the path.`);
  else parts.push('You’re on the path.');
  let lever: 'move' | 'none' = 'none';
  if (proj.points >= 3 && proj.ratePerWeek != null) {
    const rate = `${fmt(Math.abs(proj.ratePerWeek))} ${unit} a week`;
    if (!proj.eta) parts.push(`Over the last four weeks the trend is ${proj.ratePerWeek === 0 ? 'flat' : `${rate} the wrong way`}; at that rate ${fmt(goal.target_value)} doesn’t arrive.`);
    else if (proj.daysOff != null && proj.daysOff > 7) {
      parts.push(`At the last four weeks’ rate (${rate}) you reach ${fmt(goal.target_value)} on ${shortDate(proj.eta)}, ${proj.daysOff} days after ${shortDate(by)}.`);
      lever = 'move';
    } else if (proj.daysOff != null && proj.daysOff < -7) parts.push(`At the last four weeks’ rate (${rate}) you get there ${shortDate(proj.eta)}, ${-proj.daysOff} days early.`);
    else parts.push(`At the last four weeks’ rate (${rate}) you get there about on time.`);
  } else if (proj.points < 3) parts.push('A few more readings and this will say when you get there at your current rate.');

  const bonusFixed = !!goal.prize_on_time?.trim();
  const limit = plan.end_date;
  const canMove = lever === 'move' && proj.eta && proj.eta <= limit && !moving;

  return (
    <div className="pace-line stack-sm">
      <span className="small" style={{ lineHeight: 1.5 }}>
        {parts.join(' ')}
      </span>
      {lever === 'move' && (
        <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
          {canMove ? (
            <button
              className="btn small"
              onClick={() => {
                // A number goal finishes where its path does: redraw the path from where you are
                // today to the target on the projected day, and move the goal's date with it.
                setMoving(true);
                const eta = proj.eta as ISODate;
                const from = pace.trend ?? pace.latest ?? pace.start.value;
                const points = suggestPath(from, goal.target_value!, today, eta, plan.block_days);
                const replace = opsReplacePath(data, goal, points, today);
                const oldIds = currentTargets(data.goalTargets, goal.id).map((t) => t.id);
                const inserted = replace.flatMap((op) => (op.kind === 'insert' && op.collection === 'goalTargets' ? op.rows.map((r) => r.id) : []));
                commit([...replace, { kind: 'update', collection: 'goals', id: goal.id, patch: { target_date: eta } }]);
                const undo: Op[] = [
                  ...inserted.map((id): Op => ({ kind: 'delete', collection: 'goalTargets', id })),
                  ...oldIds.map((id): Op => ({ kind: 'update', collection: 'goalTargets', id, patch: { superseded_at: null } })),
                  { kind: 'update', collection: 'goals', id: goal.id, patch: { target_date: goal.target_date ?? null } },
                ];
                toast(`Finish moved to ${shortDate(eta)}; the path now runs from ${fmt(from)} to ${fmt(goal.target_value!)}${bonusFixed ? ` · the on-time bonus still judges against ${shortDate(goal.target_date_at_set ?? by)}` : ''}`, () => commit(undo));
                setMoving(false);
              }}
            >
              Move the date to {shortDate(proj.eta!)}
            </button>
          ) : (
            proj.eta && proj.eta > limit && <span className="xsmall muted">{shortDate(proj.eta)} is past the season ({shortDate(limit)}); the date can’t move that far.</span>
          )}
          <button className="btn small" onClick={onWeek}>
            Tighten this week
          </button>
          {bonusFixed && <span className="xsmall muted">Moving the date doesn’t move the bonus.</span>}
        </div>
      )}
      {lever === 'none' && proj.eta && proj.daysOff != null && proj.daysOff < -14 && daysBetween(today, proj.eta) > 14 && (
        <span className="xsmall muted">Ahead by weeks: you could pull the date in on the roadmap, or hold it and enjoy the margin.</span>
      )}
    </div>
  );
}
