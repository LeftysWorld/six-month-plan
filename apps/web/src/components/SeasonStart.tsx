import { hasPrize, seasonArc, type Goal, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { pathsOf } from '../data/paths.ts';
import { href } from '../router.ts';
import { Icon } from './ui.tsx';

/**
 * The start of a season as a short ceremony: five things to have in place by the end of week 2.
 * Shown on the Goals page until they're done or the season is under way; each row links to where
 * it happens. A to-do app has an empty list on day one; a season has a start.
 */
export function SeasonStart({ plan, goals }: { plan: Plan; goals: Goal[] }) {
  const { data, today } = useStore();
  const view = useView();
  const arc = seasonArc(plan, today);
  if (arc.phase !== 'before' && arc.phase !== 'start') return null;
  const live = goals.filter((g) => !g.archived_at && !g.completed_at);
  const paths = pathsOf(data);
  const withWhy = live.filter((g) => g.why.trim());
  const withDates = live.filter((g) => view.milestonesOf(g.id).length > 0 || g.type === 'number');
  const withPrize = live.filter((g) => hasPrize(g) || view.milestonesOf(g.id).some(hasPrize));
  const onPath = live.filter((g) => g.path_id);
  const steps: { done: boolean; text: string; to: string; sub?: string }[] = [
    { done: paths.length > 0 && onPath.length === live.length && live.length > 0, text: 'Look at your paths, and point each goal at the life it’s a bet on', to: '/paths', sub: paths.length ? `${onPath.length} of ${live.length} goals on a path` : 'No paths yet' },
    { done: live.length >= 3 && live.length <= 5, text: 'Pick 3–4 goals this season prototypes', to: '/goals/new', sub: `${live.length} goal${live.length === 1 ? '' : 's'} so far${live.length > 5 ? ' — that’s a lot for six months' : ''}` },
    { done: live.length > 0 && withDates.length === live.length, text: 'Put the dates to hit on the roadmap', to: '/roadmap', sub: `${withDates.length} of ${live.length} goals have dates` },
    { done: live.length > 0 && withPrize.length === live.length, text: 'Name a prize on every goal', to: '/goals', sub: `${withPrize.length} of ${live.length} goals have a prize` },
    { done: live.length > 0 && withWhy.length === live.length, text: 'Write the line you’ll read on bad days (each goal’s why)', to: '/goals', sub: `${withWhy.length} of ${live.length} have a why` },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0 && arc.phase === 'start' && arc.week > 1) return null;
  return (
    <section className="card stack-sm" aria-label="Season start">
      <div className="row-between">
        <span className="label">{arc.phase === 'before' ? 'Before it starts' : `Week ${arc.week}: the start`}</span>
        <span className="xsmall muted">{left === 0 ? 'All set' : `${left} to go`}</span>
      </div>
      {steps.map((s) => (
        <a key={s.text} className="list-row" href={href(s.to)} style={{ padding: '8px 0' }}>
          <span className={`ring ${s.done ? 'done' : ''}`} style={{ width: 22, height: 22, flex: 'none' }}>
            {s.done && <Icon name="check" size={12} stroke={3.2} />}
          </span>
          <span className="stack-sm grow" style={{ gap: 0 }}>
            <span className="small" style={{ color: s.done ? 'var(--muted)' : undefined }}>
              {s.text}
            </span>
            {s.sub && <span className="xsmall muted">{s.sub}</span>}
          </span>
          <Icon name="chevron" size={16} />
        </a>
      ))}
      <span className="xsmall muted">{arc.line}</span>
    </section>
  );
}
