import { seasonArc, type ISODate, type Plan } from '@six/core';
import { href } from '../router.ts';

/**
 * One line under Today's title that knows where in the season you are: "Week 1 of 27 · Oct 26 –
 * Apr 26" and what this part of a season asks of you. A to-do list reads the same on day 1 and
 * day 100; a season doesn't.
 */
export function SeasonLine({ plan, today }: { plan: Plan; today: ISODate }) {
  const arc = seasonArc(plan, today);
  const pct = Math.round(arc.elapsed * 100);
  return (
    <a className="season-line" href={href('/goals')} aria-label={`Season: week ${arc.week} of ${arc.weeks}. ${arc.line}`}>
      <span className="season-line-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="season-line-text">
        <b className="mono">
          Week {arc.week} of {arc.weeks}
        </b>
        <span className="muted"> · {plan.name}</span>
        <span className="season-line-say"> {arc.line}</span>
      </span>
    </a>
  );
}
