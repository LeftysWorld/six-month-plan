import { addDays, shortDate, weekStart, type ISODate, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { minutesText } from '../data/derive.ts';

/**
 * Load, not just dates: under the roadmap, one bar per week of planned minutes against the time
 * you've said you have. Overcommitment shows before it happens: the weeks where JHU coursework,
 * AIGP study and applications stack up go amber. Nobody else has both the dates and the minutes.
 */
export function LoadStrip({ plan, lo, hi }: { plan: Plan; lo: ISODate; hi: ISODate }) {
  const { data, today } = useStore();
  const view = useView();
  const available = data.profile.available_minutes.reduce((a, b) => a + b, 0);
  const weeks: { monday: ISODate; planned: number; done: number; past: boolean }[] = [];
  const first = weekStart(lo > plan.start_date ? lo : plan.start_date);
  const last = hi < plan.end_date ? hi : plan.end_date;
  const projected = view.projectedSessions({ start: first, end: last });
  for (let monday = first; monday <= last; monday = addDays(monday, 7)) {
    const end = addDays(monday, 6);
    const inWeek = projected.filter((s) => (s.date ? s.date >= monday && s.date <= end : s.week_start === monday) && s.status !== 'moved');
    const planned = inWeek.filter((s) => s.status !== 'skipped').reduce((sum, s) => sum + s.planned_minutes, 0);
    const done = inWeek.filter((s) => s.status === 'done' || s.status === 'partial' || s.status === 'minimum').reduce((sum, s) => sum + (s.actual_minutes ?? s.planned_minutes), 0);
    weeks.push({ monday, planned, done, past: end < today });
  }
  if (weeks.length === 0) return null;
  const max = Math.max(available, ...weeks.map((w) => w.planned), 1);
  const heavy = weeks.filter((w) => !w.past && w.planned > available * 1.1);
  const thisWeek = weeks.find((w) => w.monday === weekStart(today));
  return (
    <section className="card stack-sm" aria-label="Load by week">
      <div className="row-between">
        <span className="label">Load, week by week</span>
        <span className="xsmall muted">You have about {minutesText(available)} a week</span>
      </div>
      <div className="load-strip" role="img" aria-label={weeks.map((w) => `Week of ${shortDate(w.monday)}: ${minutesText(w.planned)} planned`).join('; ')}>
        {weeks.map((w) => {
          const over = w.planned > available * 1.1;
          const h = Math.round((w.planned / max) * 100);
          const hd = Math.round((w.done / max) * 100);
          return (
            <span key={w.monday} className={`load-col ${w.monday === weekStart(today) ? 'now' : ''} ${w.past ? 'past' : ''}`} title={`Week of ${shortDate(w.monday)} · ${minutesText(w.planned)} planned${w.done ? ` · ${minutesText(w.done)} done` : ''}`}>
              <span className={`load-bar ${over ? 'over' : ''}`} style={{ height: `${h}%` }}>
                {w.done > 0 && <span className="load-done" style={{ height: `${Math.min(100, (hd / Math.max(h, 1)) * 100)}%` }} />}
              </span>
            </span>
          );
        })}
        <span className="load-line" style={{ bottom: `${Math.round((available / max) * 100)}%` }} aria-hidden />
      </div>
      <span className="xsmall muted">
        {thisWeek ? `This week: ${minutesText(thisWeek.planned)} planned.` : ''}
        {heavy.length > 0
          ? ` ${heavy.length} week${heavy.length === 1 ? '' : 's'} ahead ${heavy.length === 1 ? 'is' : 'are'} over what you have (${heavy
              .slice(0, 3)
              .map((w) => shortDate(w.monday))
              .join(', ')}${heavy.length > 3 ? '…' : ''}). Move a start date, or trim a task, before you get there.`
          : ' Nothing ahead is over what you have.'}
      </span>
    </section>
  );
}
