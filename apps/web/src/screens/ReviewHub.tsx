import { addDays, blockIndex, blockRange, isoWeekday, planWeekNumber, quarterRange, shortDate, weekStart, type ISODate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import type { AppData } from '../data/model.ts';
import { href } from '../router.ts';

/**
 * Which week a weekly review covers: the current week from Saturday on, otherwise last
 * week if it hasn't been reviewed yet. Returns null when there's nothing to review.
 */
export function weekToReview(data: AppData, today: ISODate): { monday: ISODate; overdue: boolean; done: boolean } {
  const thisMonday = weekStart(today);
  const lastMonday = addDays(thisMonday, -7);
  const reviewed = (monday: ISODate) => data.reviews.some((r) => r.kind === 'weekly' && r.period_start === monday && r.status === 'done');
  const hasSessions = (monday: ISODate) => data.sessions.some((s) => s.week_start === monday);
  if (!reviewed(lastMonday) && hasSessions(lastMonday) && isoWeekday(today) < 6) {
    return { monday: lastMonday, overdue: true, done: false };
  }
  return { monday: thisMonday, overdue: false, done: reviewed(thisMonday) };
}

export function ReviewHub() {
  const { data, today } = useStore();
  const view = useView();
  const plan = view.mainPlan;
  const target = weekToReview(data, today);
  const weekLabel = plan && plan.start_date <= target.monday ? `Week ${planWeekNumber(plan, addDays(target.monday, 6))} review` : `Review of ${shortDate(target.monday)}`;
  const past = [...data.reviews].filter((r) => r.status === 'done').sort((a, b) => (a.period_start < b.period_start ? 1 : -1));
  const due = view.measurementsDue(addDays(target.monday, 6));

  const upcoming = plan
    ? [
        { tag: 'B', kind: 'block', title: `Block ${blockIndex(plan, today) + 1} review`, date: blockRange(plan, blockIndex(plan, today)).end, detail: 'Milestones, block targets, set the next block · ~25 min', color: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
        { tag: '3M', kind: 'quarter', title: '3-month checkpoint', date: quarterRange(plan, today).end, detail: 'Does each goal still make sense? · ~40 min', color: 'var(--blue-soft)', ink: 'var(--blue-ink)' },
        { tag: '6M', kind: 'retro', title: 'Plan retrospective', date: plan.end_date, detail: 'What worked, what carries into the next plan', color: 'var(--gold-soft)', ink: 'var(--gold-ink)' },
      ].filter((u) => u.date >= today)
    : [];

  return (
    <div className="stack">
      <h1 style={{ fontSize: 34 }}>Review</h1>
      <div className="card dark stack">
        <div className="row-between" style={{ alignItems: 'baseline' }}>
          <h2 style={{ color: 'var(--hero-ink)' }}>{weekLabel}</h2>
          <span className="xsmall muted">
            {target.done ? 'Done' : target.overdue ? 'Still open' : 'Due Sunday'} · ~15 min
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--hero-muted)' }}>
          {target.done
            ? 'This week is reviewed. The next one opens on Saturday.'
            : `${shortDate(target.monday)} – ${shortDate(addDays(target.monday, 6))}. ${
                due.length ? `${due.length} measurement${due.length === 1 ? '' : 's'} due. ` : ''
              }You'll look back, reflect, adjust and plan the next week.`}
        </p>
        {!target.done && (
          <a className="btn" style={{ background: 'var(--hero-ink)', color: 'var(--hero-bg)' }} href={href(`/review/run?kind=weekly&week=${target.monday}`)}>
            Start review
          </a>
        )}
      </div>

      {upcoming.length > 0 && (
        <div className="card stack-sm">
          <span className="label">Coming up</span>
          {upcoming.map((u) => (
            <a key={u.tag} className="list-row" href={href(`/review/run?kind=${u.kind}&week=${weekStart(today)}`)}>
              <span className="num" style={{ width: 38, height: 38, borderRadius: 12, background: u.color, color: u.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flex: 'none' }}>
                {u.tag}
              </span>
              <div className="grow">
                <div className="strong small">{u.title}</div>
                <div className="xsmall muted">
                  {shortDate(u.date)} · {u.detail}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      <div className="card stack-sm">
        <span className="label">Past reviews</span>
        {past.length === 0 && <span className="small muted">Your first review will show up here.</span>}
        {past.map((r) => (
          <div key={r.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
            <div className="row-between small">
              <b>
                {r.kind === 'weekly' ? 'Week' : r.kind === 'block' ? 'Block' : r.kind === 'quarter' ? '3-month' : 'Retro'} · {shortDate(r.period_start)}
              </b>
              <span className="muted">
                {fmt(r.actions_done)} of {r.actions_planned}
              </span>
            </div>
            {(r.change_next || r.obstacles.length > 0) && (
              <div className="xsmall muted">
                {r.change_next ? `Next: ${r.change_next}` : ''}
                {r.obstacles.length ? ` · ${r.obstacles.join(', ')}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="xsmall muted" style={{ textAlign: 'center' }}>
        Missed a review? It stays open until you do the next one.
      </p>
    </div>
  );
}
