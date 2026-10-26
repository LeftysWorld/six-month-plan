import { useState, type MouseEvent } from 'react';
import { daysBetween, shortDate, weekDates, weekStart, type Goal, type GoalGroup, type ISODate, type PaceLabel, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { type View } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { CHAIN_LEVELS, catchUpPlan, chainFor, isSet, type Chain, type ChainLevel, type CatchUp } from '../data/chain.ts';
import type { AppData } from '../data/model.ts';
import { firstCheckpoint, goalTrack, groupTrack, nextCheckpoint, nextReviewWord, nextSeasonDates, type Seasons } from '../data/season.ts';
import { GroupSheet } from '../components/Connections.tsx';
import { sharedTasksOf } from '../components/Connections.tsx';
import type { DragApi, GoalDrag } from '../components/goalDrag.ts';
import { href } from '../router.ts';
import { Icon } from '../components/ui.tsx';

/**
 * The Goals page's building blocks: the horizon of two seasons, the season's numbers, "By … you'll
 * have", and group cards holding goals as rows. The group page reuses the rows and cards.
 */

export interface GoalCardData {
  goal: Goal;
  chain: Chain;
  pace: PaceLabel;
  fix: CatchUp | null;
  gaps: ChainLevel[];
  /** Something to do now: behind, a level not set, an overdue milestone or an old reading. */
  needs: boolean;
  /** Why it needs you, in a few words (null when it doesn't). */
  reason: string | null;
  /** Lower sorts first. */
  rank: number;
}

const LEVEL_WORD: Record<ChainLevel, string> = { quarter: '3-month', month: 'month', week: 'week' };

/** Every goal in the plan with what it needs, goals that need you first. */
export function goalCards(view: View, data: AppData, plan: Plan, today: ISODate): GoalCardData[] {
  return view
    .goalsForPlan(plan.id)
    .map((goal, i) => {
      // Judged from the goal's own start (a later start on the roadmap, or after another goal).
      const start = view.startFor(goal, plan);
      const started = start <= today;
      const chain = chainFor(data, goal, plan, started ? today : start);
      // A goal waiting on another isn't judged yet: it sits at the bottom, asking nothing.
      if (view.waitingOn(goal)) return { goal, chain, pace: 'none' as PaceLabel, fix: null, gaps: [], needs: false, reason: null, rank: 5000 + i };
      const pace = started ? view.goalPace(goal, plan).label : 'none';
      const fix = started ? catchUpPlan(view, data, goal, plan, today) : null;
      const gaps = CHAIN_LEVELS.filter((l) => !isSet(chain[l]));
      const overdue = data.milestones.some((m) => m.goal_id === goal.id && !m.completed_at && m.due_date < today);
      const age = goal.type === 'number' ? readingAge(view, goal, today) : 0;
      const stale = started && (age == null || age > 7);
      const needs = started && (!!fix || gaps.length > 0 || overdue || stale);
      const rank = (fix ? 0 : overdue ? 1 : gaps.length ? 2 : stale ? 3 : 10) * 100 + i;
      const reason = !needs
        ? null
        : fix
          ? fix.text
          : overdue
            ? 'A date to hit has passed'
            : gaps.length
              ? `Set this ${gaps.map((l) => LEVEL_WORD[l]).join(', ')} goal`
              : age == null
                ? 'No reading yet'
                : `Last reading ${age} days ago`;
      return { goal, chain, pace, fix, gaps, needs, reason, rank };
    })
    .sort((a, b) => a.rank - b.rank);
}

/** Days since the goal's last reading, or null with no readings. */
export function readingAge(view: View, goal: Goal, today: ISODate): number | null {
  const last = view.measurementsFor(goal.measurement_type_id).at(-1);
  return last ? daysBetween(last.measured_on, today) : null;
}


export type SeasonKey = 'current' | 'next' | 'other';

export interface Placed {
  card: GoalCardData;
  plan: Plan;
  /** On its own clock (not a batch). */
  own: boolean;
  season: SeasonKey;
}

/**
 * Every goal you're working on, once, in the window it runs in now, with the season it belongs to.
 * Own-clock goals belong to the season they run in (one that starts later belongs to the next).
 */
export function placeGoals(view: View, data: AppData, today: ISODate, seasons: Seasons): Placed[] {
  const { current, next } = seasons;
  const windows = view.livePlans;
  const all: Placed[] = windows.flatMap((plan) =>
    goalCards(view, data, plan, today).map((card) => {
      const own = !!plan.solo;
      let season: SeasonKey;
      if (!own) season = plan.id === current?.id ? 'current' : plan.id === next?.id ? 'next' : 'other';
      else season = plan.start_date > today && next && plan.start_date >= next.start_date ? 'next' : 'current';
      return { card, plan, own, season };
    }),
  );
  // A goal in more than one live window is listed once, in the window it runs in now.
  const best = new Map<string, Placed>();
  for (const p of all) {
    const want = view.planForGoal(p.card.goal)?.id;
    const have = best.get(p.card.goal.id);
    if (!have || (p.plan.id === want && have.plan.id !== want)) best.set(p.card.goal.id, p);
  }
  return [...best.values()].sort((a, b) => a.card.rank - b.card.rank);
}

export const GRIP = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" />
    <circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" />
    <circle cx="15" cy="18" r="1.6" />
  </svg>
);

const STATUS_INK: Record<string, string> = { ahead: 'var(--blue-ink)', behind: 'var(--amber-ink)', on_track: 'var(--ink-2)', none: 'var(--muted)' };

/** One goal as a row: name and status, a track against even pace, and where it is → what done is. */
export function GoalRow({ placed, dnd, onMove }: { placed: Placed; dnd?: DragApi; onMove?: (g: Goal) => void }) {
  const view = useView();
  const { goal } = placed.card;
  const t = goalTrack(view, goal, placed.plan);
  const ink = t.started ? STATUS_INK[t.label] ?? 'var(--ink-2)' : 'var(--muted)';
  const dragging = !!dnd?.drag && !dnd.drag.group && dnd.drag.goal.id === goal.id;
  const over = dnd?.drag?.target === `goal:${goal.id}`;
  const due = shortDate(t.by);
  return (
    <div
      className={`season-row${dragging ? ' lifted' : ''}${over ? ' drop-on' : ''}${t.waiting ? ' waiting' : ''}`}
      data-drop={goal.group_id ? undefined : `goal:${goal.id}`}
      onPointerDown={(e) => {
        if (!dnd || (e.target as HTMLElement).closest('button')) return;
        dnd.start(e, { goal, group: null, goals: [goal] });
      }}
    >
      {dnd && (
        <button
          type="button"
          className="season-grip"
          aria-label={`Drag ${goal.title} onto a goal, a group or a season. Or press to choose.`}
          onPointerDown={(e) => {
            e.stopPropagation();
            dnd.start(e, { goal, group: null, goals: [goal] }, true);
          }}
          onClick={() => !dnd.consumeClick() && onMove?.(goal)}
        >
          {GRIP}
        </button>
      )}
      <a href={href(`/goals/${goal.id}`)} draggable={false} className="season-row-link" onClick={(e) => dnd?.consumeClick() && e.preventDefault()}>
        <span className="season-row-head">
          <span className="dot" style={{ width: 8, height: 8, flex: 'none', background: goal.color }} />
          <span className="season-row-title">{goal.title}</span>
          <span className="season-row-status" style={{ color: ink }}>
            {t.status}
          </span>
          <Icon name="chevron" size={14} stroke={2.2} />
        </span>
        {t.started ? (
          <>
            <span className="season-track" aria-label={`${t.prog}% done, even pace ${t.exp}%`}>
              <span className="season-fill" style={{ width: `${t.prog}%`, background: goal.color }} />
              <span className="season-tick" style={{ left: `${t.exp}%` }} />
            </span>
            <span className="season-row-foot">
              <span className="num">{t.now}</span>
              <span className="muted">
                {t.target} by {due}
              </span>
            </span>
          </>
        ) : (
          <span className="season-row-foot">
            <span className="muted">
              {t.waiting ? `After ${t.waiting} · ` : ''}
              {t.target} by {due}
            </span>
          </span>
        )}
        {placed.card.reason && (
          <span className="season-row-needs xsmall" style={{ color: 'var(--amber-ink)' }}>
            {placed.card.reason}
          </span>
        )}
      </a>
    </div>
  );
}

/** A group's goals in one card: the name and counts in the header (opens the group), goals as rows. */
export function GroupRowsCard({ group, members, dnd, onMove, onMoveGroup }: { group: GoalGroup; members: Placed[]; dnd?: DragApi; onMove?: (g: Goal) => void; onMoveGroup?: () => void }) {
  const view = useView();
  const shared = sharedTasksOf(view, members.map((m) => m.card.goal));
  const over = dnd?.drag?.target === `group:${group.id}`;
  const lifted = dnd?.drag?.group?.id === group.id;
  return (
    <section className={`season-card${over ? ' drop-on' : ''}${lifted ? ' lifted' : ''}`} data-drop={`group:${group.id}`} aria-label={`Group: ${group.name}`}>
      <div className="season-card-head">
        {dnd && (
          <button
            type="button"
            className="season-grip"
            aria-label={`Drag ${group.name} onto a season to move its goals. Or press to choose.`}
            onPointerDown={(e) => {
              e.stopPropagation();
              dnd.start(e, { goal: members[0]!.card.goal, group, goals: members.map((m) => m.card.goal) }, true);
            }}
            onClick={() => !dnd.consumeClick() && onMoveGroup?.()}
          >
            {GRIP}
          </button>
        )}
        <a href={href(`/goals/group/${group.id}`)} className="season-card-title">
          <b>{group.name}</b>
          <span className="xsmall muted">
            {members.length} goal{members.length === 1 ? '' : 's'}
            {shared.length ? ` · ${shared.length} shared task${shared.length === 1 ? '' : 's'}` : ''}
          </span>
          <span className="season-open">
            Open <Icon name="chevron" size={14} stroke={2.4} />
          </span>
        </a>
      </div>
      <GroupRollup group={group} />
      {over && <span className="season-drop-hint">Release to add to {group.name}</span>}
      {members.map((m) => (
        <GoalRow key={m.card.goal.id} placed={m} dnd={dnd} onMove={onMove} />
      ))}
    </section>
  );
}

/**
 * What a group's goals add up to: its outcome in a line and one bar for all of them (each goal
 * counts equally, finished ones fully), against where an even pace would be. Without an outcome
 * it offers to add one.
 */
export function GroupRollup({ group, big = false }: { group: GoalGroup; big?: boolean }) {
  const view = useView();
  const [editing, setEditing] = useState(false);
  const r = groupTrack(view, group.id);
  const open = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditing(true);
  };
  if (!group.outcome?.trim()) {
    return (
      <>
        <button type="button" className="group-outcome-add" onClick={open}>
          + What do these goals add up to?
        </button>
        {editing && <GroupSheet group={group} onClose={() => setEditing(false)} />}
      </>
    );
  }
  const ink = STATUS_INK[r.label] ?? 'var(--ink-2)';
  const word = r.done === r.count ? 'All done' : r.label === 'ahead' ? 'Ahead' : r.label === 'behind' ? 'Behind' : r.label === 'on_track' ? 'On pace' : 'Not started';
  return (
    <div className={`group-rollup${big ? ' big' : ''}`}>
      <div className="group-outcome">
        <span className="group-outcome-text">{group.outcome}</span>
        <span className="small" style={{ color: ink, whiteSpace: 'nowrap' }}>
          {word}
        </span>
      </div>
      <span className="season-track" style={{ marginLeft: 0 }} aria-label={`${r.prog}% of the outcome done, even pace ${r.exp}%`}>
        <span className="season-fill" style={{ width: `${r.prog}%`, background: 'var(--gradient)' }} />
        {r.exp > 0 && <span className="season-tick" style={{ left: `${r.exp}%` }} />}
      </span>
      <span className="season-row-foot" style={{ marginLeft: 0 }}>
        <span className="num">
          {r.done} of {r.count} goal{r.count === 1 ? '' : 's'} done
        </span>
        {r.by && <span className="muted">by {shortDate(r.by)}</span>}
      </span>
    </div>
  );
}

/** Goals not in a group, in the same card style. It also takes a goal dragged out of its group. */
export function LooseCard({ title, members, dnd, onMove }: { title: string; members: Placed[]; dnd?: DragApi; onMove?: (g: Goal) => void }) {
  const over = dnd?.drag?.target === 'loose';
  return (
    <section className={`season-card${over ? ' drop-on' : ''}`} data-drop="loose" aria-label={title}>
      <div className="season-card-head">
        <span className="season-card-title">
          <b>{title}</b>
          {dnd?.drag && !dnd.drag.group && dnd.drag.goal.group_id ? <span className="xsmall muted">Drop here to take it out of its group</span> : null}
        </span>
      </div>
      {members.length === 0 && <span className="small muted" style={{ padding: '12px 16px' }}>None</span>}
      {members.map((m) => (
        <GoalRow key={m.card.goal.id} placed={m} dnd={dnd} onMove={onMove} />
      ))}
    </section>
  );
}

/**
 * Both seasons on one line: this season and the next, today's mark, each season's 3-month
 * checkpoint, and dots where own-clock goals end. Tap a half to show that season. While dragging,
 * each half takes a goal or a group.
 */
export function SeasonHorizon({
  seasons,
  selected,
  onSelect,
  placed,
  dnd,
  onPlanNext,
  onMenu,
}: {
  seasons: Seasons;
  selected: 'current' | 'next';
  onSelect: (s: 'current' | 'next') => void;
  placed: Placed[];
  dnd?: DragApi;
  onPlanNext: () => void;
  onMenu: (plan: Plan) => void;
}) {
  const { today } = useStore();
  const { current, next } = seasons;
  if (!current) return null;
  const nextDates = next ? { start: next.start_date, end: next.end_date } : nextSeasonDates(current);
  const start = current.start_date;
  const end = nextDates.end;
  const total = Math.max(1, daysBetween(start, end));
  const at = (d: ISODate) => Math.max(0, Math.min(100, (daysBetween(start, d) / total) * 100));
  const split = at(current.end_date);
  const goalsIn = (plan: Plan | null) => (plan ? placed.filter((p) => p.plan.id === plan.id).map((p) => p.card.goal.id) : []);
  const target = dnd?.drag?.target ?? '';
  const half = (key: 'current' | 'next', plan: Plan | null) => {
    const on = selected === key;
    const over = plan && (target === `plan:${plan.id}` || target === `already:${plan.id}`);
    return (
      <button
        type="button"
        className={`horizon-bar ${key}${on ? ' on' : ''}${!plan ? ' empty' : ''}${over ? ' drop-on' : ''}`}
        style={key === 'current' ? { left: 0, width: `${split}%` } : { left: `calc(${split}% + 3px)`, right: 0 }}
        aria-label={key === 'current' ? 'Show this season' : 'Show next season'}
        aria-pressed={on}
        onClick={() => onSelect(key)}
        data-drop={plan ? `plan:${plan.id}` : undefined}
        data-goals={goalsIn(plan).join(',')}
      />
    );
  };
  const ends = placed.filter((p) => p.own && p.plan.end_date <= end && p.plan.end_date !== current.end_date);
  const cps = [firstCheckpoint(current), ...(next ? [firstCheckpoint(next)] : [])];
  const dayNo = Math.max(1, Math.min(daysBetween(current.start_date, today) + 1, daysBetween(current.start_date, current.end_date) + 1));
  const days = daysBetween(current.start_date, current.end_date) + 1;
  const plannedNext = placed.filter((p) => p.season === 'next').length;
  return (
    <div className="horizon">
      <div className="horizon-line">
        {half('current', current)}
        {half('next', next)}
        {today >= start && today <= end && (
          <>
            <span className="horizon-today" style={{ left: `${at(today)}%` }} aria-hidden="true" />
            <span className="horizon-today-label mono" style={{ left: `${at(today)}%` }}>
              TODAY
            </span>
          </>
        )}
        {cps.map((d) => (
          <span key={d} className="horizon-cp" style={{ left: `${at(d)}%` }} title={`3-month checkpoint ${shortDate(d)}`} aria-hidden="true" />
        ))}
        {ends.map((p) => (
          <span key={p.card.goal.id} className="horizon-end" style={{ left: `${at(p.plan.end_date)}%`, background: p.card.goal.color }} title={`${p.card.goal.title} ends ${shortDate(p.plan.end_date)}`} aria-hidden="true" />
        ))}
      </div>
      <div className="horizon-labels">
        <span className="horizon-label">
          <button type="button" className={`horizon-name${selected === 'current' ? ' on' : ''}`} onClick={() => onSelect('current')}>
            This season
          </button>
          <span className="xsmall muted">
            {today < current.start_date ? `Starts ${shortDate(current.start_date)}` : `Day ${dayNo} of ${days}`} · ends {shortDate(current.end_date)}
          </span>
          {selected === 'current' && (
            <button type="button" className="link-btn xsmall" onClick={() => onMenu(current)} style={{ padding: 0, alignSelf: 'flex-start' }}>
              Season settings
            </button>
          )}
        </span>
        <span className="horizon-label right">
          <button type="button" className={`horizon-name${selected === 'next' ? ' on' : ''}`} onClick={() => onSelect('next')}>
            Next season
          </button>
          <span className="xsmall muted">
            {shortDate(nextDates.start)} – {shortDate(nextDates.end)}
            {next ? ` · ${plannedNext} planned` : ''}
          </span>
          {!next ? (
            <button type="button" className="link-btn xsmall" onClick={onPlanNext} style={{ padding: 0, alignSelf: 'flex-end' }}>
              Plan next season
            </button>
          ) : (
            selected === 'next' && (
              <button type="button" className="link-btn xsmall" onClick={() => onMenu(next)} style={{ padding: 0, alignSelf: 'flex-end' }}>
                Season settings
              </button>
            )
          )}
        </span>
      </div>
      {dnd?.drag && <span className="xsmall" style={{ color: 'var(--accent-ink)' }}>Drop on a season to move {dnd.drag.group ? dnd.drag.group.name : dnd.drag.goal.title} there</span>}
    </div>
  );
}

/** On pace, the next checkpoint and the next review, as three tiles that wrap instead of crowding. */
export function SeasonStats({ season, members }: { season: Plan; members: Placed[] }) {
  const view = useView();
  const { today, data } = useStore();
  const weekReviewed = data.reviews.some((r) => r.kind === 'weekly' && r.status === 'done' && r.period_start === weekStart(today));
  if (season.start_date > today) {
    return (
      <div className="season-stats">
        <div className="season-stat">
          <span className="mono">STARTS</span>
          <b>{shortDate(season.start_date)}</b>
        </div>
        <div className="season-stat">
          <span className="mono">PLANNED</span>
          <b className="num">
            {members.length} <small>goal{members.length === 1 ? '' : 's'}</small>
          </b>
        </div>
        <div className="season-stat">
          <span className="mono">CHECKPOINT</span>
          <b>{shortDate(firstCheckpoint(season))}</b>
        </div>
      </div>
    );
  }
  const paced = members.filter((m) => goalTrack(view, m.card.goal, m.plan).label !== 'none');
  const behind = paced.filter((m) => goalTrack(view, m.card.goal, m.plan).label === 'behind').length;
  const cp = nextCheckpoint(season, today);
  return (
    <div className="season-stats">
      <div className="season-stat">
        <span className="mono">ON PACE</span>
        <b className="num">
          {paced.length - behind} <small>of {paced.length}</small>
        </b>
      </div>
      <div className="season-stat">
        <span className="mono">CHECKPOINT</span>
        <b className="num">
          {Math.max(0, daysBetween(today, cp))} <small>days</small>
        </b>
        <small>{shortDate(cp)}</small>
      </div>
      <div className="season-stat">
        <span className="mono">REVIEW</span>
        <b>{nextReviewWord(today, weekReviewed)}</b>
        <small>Weekly</small>
      </div>
    </div>
  );
}

/** "By Apr 24 you'll have": every goal's outcome, once. Early finishers show their date; goals behind say so. */
export function SeasonOutcomes({ season, members, onPlan }: { season: Plan; members: Placed[]; onPlan?: () => void }) {
  const view = useView();
  const { today } = useStore();
  const future = season.start_date > today;
  return (
    <section className="season-card outcomes" aria-label={`By ${shortDate(season.end_date)}`}>
      <div className="outcomes-head">
        <b>By {shortDate(season.end_date)} you’ll have</b>
        <span className="xsmall muted">{future ? 'Planned for next season' : 'If you keep your pace'}</span>
      </div>
      {members.length === 0 && <span className="small muted outcome-row">Nothing planned yet.</span>}
      {members.map((m, i) => {
        // A group with an outcome is one line: what its goals add up to.
        const group = m.card.goal.group_id ? view.data.groups.find((g) => g.id === m.card.goal.group_id && g.outcome?.trim()) : undefined;
        if (group) {
          if (members.findIndex((x) => x.card.goal.group_id === group.id) !== i) return null;
          const r = groupTrack(view, group.id);
          const early = !!r.by && r.by < season.end_date;
          return (
            <div key={`g-${group.id}`} className="outcome-row">
              <span className="outcome-mark group" aria-hidden="true">
                <span />
              </span>
              <span className="small">{group.outcome}</span>
              <span className="xsmall" style={{ color: r.label === 'behind' ? 'var(--amber-ink)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                {r.label === 'behind' ? 'at risk' : early ? `by ${shortDate(r.by!)}` : `${r.done} of ${r.count}`}
              </span>
            </div>
          );
        }
        const t = goalTrack(view, m.card.goal, m.plan);
        const early = t.by < season.end_date;
        return (
          <div key={m.card.goal.id} className="outcome-row">
            <span className="outcome-mark" style={{ borderColor: m.card.goal.color }}>
              <span style={{ background: m.card.goal.color }} />
            </span>
            <span className="small">{t.target}</span>
            <span className="xsmall" style={{ color: t.label === 'behind' ? 'var(--amber-ink)' : early ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
              {early ? `by ${shortDate(t.by)}` : t.label === 'behind' ? 'at risk' : ''}
            </span>
          </div>
        );
      })}
      {onPlan && (
        <a className="btn small" href={href('/goals/backlog')} onClick={onPlan} style={{ margin: '10px 16px 4px' }}>
          Plan this season from your backlog
        </a>
      )}
    </section>
  );
}

/** Monday to Sunday: which days a task was logged this week (today outlined). */
export function WeekStrip({ actionId }: { actionId: string }) {
  const { data, today } = useStore();
  const days = weekDates(weekStart(today));
  const L = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <span className="week-strip" aria-label="This week">
      {days.map((d, i) => {
        const done = data.sessions.some((s) => s.action_id === actionId && s.date === d && (s.status === 'done' || s.status === 'partial' || s.status === 'minimum'));
        return (
          <span key={d} className={`week-day${done ? ' done' : ''}${d === today ? ' today' : ''}`} title={`${L[i]}${done ? ' · logged' : ''}`}>
            {L[i]}
          </span>
        );
      })}
    </span>
  );
}

/** What letting go would do, shown on the dragged card. */
export function dropHint(d: GoalDrag): string {
  if (d.target?.startsWith('already:')) return 'Already in this season';
  if (d.target?.startsWith('plan:')) return 'Move into this season';
  if (d.target === 'own') return d.group ? 'Each on its own clock' : 'Put on its own clock';
  if (d.target === 'loose') return 'Take out of its group';
  if (d.target?.startsWith('group:')) return 'Add to this group';
  return 'Make a group';
}

