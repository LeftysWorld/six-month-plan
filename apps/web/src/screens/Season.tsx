import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { daysBetween, seasonArc, seasonChapters, shortDate, weekDates, weekStart, type Chapter, type Goal, type GoalGroup, type GoalIdea, type ISODate, type PaceLabel, type Plan } from '@six/core';
import { chapterSpan, chapterView, weekRecord, weekTotals } from '../data/chapters.ts';
import { useStore } from '../data/store.tsx';
import { type View } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { CHAIN_LEVELS, catchUpPlan, chainFor, isSet, type Chain, type ChainLevel, type CatchUp } from '../data/chain.ts';
import type { AppData } from '../data/model.ts';
import { goalPrizes } from '../data/prizes.ts';
import { PrizeTag } from '../components/Prize.tsx';
import { firstCheckpoint, goalTrack, groupSentence, groupTrack, nextCheckpoint, nextDue, nextReviewWord, nextSeasonDates, weekDots, type Seasons } from '../data/season.ts';
import { sharedTasksOf } from '../components/Connections.tsx';
import type { DragApi, GoalDrag } from '../components/goalDrag.ts';
import { href } from '../router.ts';
import { pathLetter } from '../data/paths.ts';
import { waitOf } from '../data/waiting.ts';
import { WaitBadge } from '../components/Waiting.tsx';
import { Icon } from '../components/ui.tsx';
import { gradientSlots, groupGradient } from '../data/palette.ts';

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

const LEVEL_WORD: Record<ChainLevel, string> = { week: 'week' };

/** Every goal in the plan with what it needs, goals that need you first. */
export function goalCards(view: View, data: AppData, plan: Plan, today: ISODate): GoalCardData[] {
  return view
    .goalsForPlan(plan.id)
    .map((goal, i) => {
      // Judged from the goal's own start (a later start on the roadmap, or after another goal).
      const start = view.startFor(goal, plan);
      const started = start <= today;
      const chain = chainFor(data, goal, plan, started ? today : start);
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
      const season: SeasonKey = plan.id === current?.id ? 'current' : plan.id === next?.id ? 'next' : 'other';
      return { card, plan, season };
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

/** "Starts Mon Nov 2 · in 4 days" for a goal that hasn't started. */
function startsLine(start: ISODate, today: ISODate): string {
  const n = daysBetween(today, start);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${start}T00:00:00Z`).getUTCDay()];
  return `Starts ${day} ${shortDate(start)} · ${n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}`;
}

const STATUS_INK: Record<string, string> = { ahead: 'var(--blue-ink)', behind: 'var(--amber-ink)', on_track: 'var(--ink-2)', none: 'var(--muted)' };

/** One goal as a row: name and status, a track against even pace, and where it is → what done is. */
export function GoalRow({ placed, dnd, onMove, hidePath = false, onSelect, selected = false }: { placed: Placed; dnd?: DragApi; onMove?: (g: Goal) => void; hidePath?: boolean; onSelect?: (g: Goal) => void; selected?: boolean }) {
  const view = useView();
  const { goal } = placed.card;
  const path = goal.path_id ? view.data.paths.find((p) => p.id === goal.path_id && !p.archived_at) : undefined;
  const t = goalTrack(view, goal, placed.plan);
  const ink = t.started ? STATUS_INK[t.label] ?? 'var(--ink-2)' : 'var(--muted)';
  const dragging = !!dnd?.drag && !dnd.drag.group && dnd.drag.goal.id === goal.id;
  const over = dnd?.drag?.target === `goal:${goal.id}`;
  const insert = dnd?.drag?.target === `order:${goal.id}:before` ? ' insert-before' : dnd?.drag?.target === `order:${goal.id}:after` ? ' insert-after' : '';
  const due = shortDate(t.by);
  const dots = t.started ? weekDots(view, goal.id) : [];
  const next = nextDue(view, goal.id);
  const pct = Math.round(t.prog);
  // The next prize still open on this goal: a date's, then the finish, then the bonus.
  const nextPrize = goalPrizes(view, goal, view.today, placed.plan).find((p) => (p.status === 'open' || p.status === 'due') && !p.lost) ?? null;
  return (
    <div
      className={`season-row${dragging ? ' lifted' : ''}${over ? ' drop-on' : ''}${insert}${selected ? ' selected' : ''}`}
      data-drop={goal.group_id ? undefined : `goal:${goal.id}`}
      data-row={goal.id}
      data-container={goal.group_id ?? 'loose'}
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
      <a
        href={href(`/goals/${goal.id}`)}
        draggable={false}
        className="season-row-link"
        aria-current={selected ? 'true' : undefined}
        onClick={(e) => {
          if (dnd?.consumeClick()) return e.preventDefault();
          // In Goal focus, a click shows the goal beside the list instead of opening it.
          if (onSelect && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            onSelect(goal);
          }
        }}
      >
        <span className="season-row-head">
          <span className="dot" style={{ width: 8, height: 8, flex: 'none', background: goal.color }} />
          <span className="season-row-title">{goal.title}</span>
          {path && !hidePath && (
            <span className="path-chip" title={path.name}>
              <i style={{ background: path.color }} />
              {pathLetter(view.data, path).replace('Path ', '')}
            </span>
          )}
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
              <span className="num">
                {t.now} <span className="muted" style={{ fontWeight: 500 }}>· {pct}%</span>
              </span>
              <span className="muted">
                {t.target} by {due}
              </span>
            </span>
            <span className="season-row-week">
              <span className="week-dots" aria-label={`Last 7 days: ${dots.map((d) => d.state).join(', ')}`}>
                {dots.map((d) => (
                  <i key={d.date} className={d.state} style={d.state === 'done' || d.state === 'part' ? { background: goal.color } : undefined} />
                ))}
              </span>
              {next && (
                <span className="xsmall" style={{ color: next.late ? 'var(--amber-ink)' : 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Next: {next.title} · {next.late ? 'was ' : ''}{shortDate(next.date)}
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="season-row-foot">
              <span className="muted">
                {t.target} by {due}
              </span>
            </span>
            <span className="season-row-week">
              <span className="xsmall" style={{ color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                {startsLine(view.startFor(goal, placed.plan), view.today)}
              </span>
              {next && (
                <span className="xsmall muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  First: {next.title} · {shortDate(next.date)}
                </span>
              )}
            </span>
          </>
        )}
        {placed.card.reason && (
          <span className="season-row-needs xsmall" style={{ color: 'var(--amber-ink)' }}>
            {placed.card.reason}
          </span>
        )}
        {nextPrize && (
          <span className="xsmall row-start" style={{ gap: 6, marginTop: 2 }}>
            <PrizeTag p={nextPrize} />
            <span className="muted">{nextPrize.dueDate ? `by ${shortDate(nextPrize.dueDate)}` : ''}</span>
          </span>
        )}
      </a>
    </div>
  );
}

/** A group's goals in one card: the name and counts in the header (opens the group), goals as rows. */
/** An idea planned for a season, not a goal yet: a dashed row with its rough dates (it's a dashed bar on the Roadmap too). */
export function PlannedIdeaRow({ idea, plan }: { idea: GoalIdea; plan: Plan }) {
  const from = idea.planned_start ?? plan.start_date;
  const to = idea.planned_end ?? plan.end_date;
  return (
    <a className="season-row idea-planned" href={href(idea.group_id ? `/goals/group/${idea.group_id}` : '/goals/backlog')}>
      <span className="idea-planned-dot" aria-hidden="true" />
      <span className="idea-planned-text">
        <b>{idea.title}</b>
        <span className="xsmall muted">
          Planned idea · {shortDate(from)} – {shortDate(to)}
        </span>
      </span>
      <Icon name="chevron" size={14} stroke={2.4} />
    </a>
  );
}

export function GroupRowsCard({ group, members, ideas = [], plan, dnd, onMove, onMoveGroup }: { group: GoalGroup; members: Placed[]; ideas?: GoalIdea[]; plan?: Plan | null; dnd?: DragApi; onMove?: (g: Goal) => void; onMoveGroup?: () => void }) {
  const view = useView();
  const groupWait = waitOf(view.data, group, view.today);
  const shared = sharedTasksOf(view, members.map((m) => m.card.goal));
  const over = dnd?.drag?.target === `group:${group.id}`;
  const lifted = dnd?.drag?.group?.id === group.id;
  const insert = dnd?.drag?.target === `gorder:${group.id}:before` ? ' insert-before' : dnd?.drag?.target === `gorder:${group.id}:after` ? ' insert-after' : '';
  // The group's own colour: a wash of its goals' colours, so the tray reads as the container and the white rows as the goals.
  const gradient = groupGradient(group.id, members.map((m) => m.card.goal.color), 100, gradientSlots(view.data).get(group.id));
  return (
    <section
      className={`season-card group-card${over ? ' drop-on' : ''}${lifted ? ' lifted' : ''}${insert}`}
      data-drop={`group:${group.id}`}
      data-gcard={group.id}
      aria-label={`Group: ${group.name}`}
      style={{ ['--group-gradient' as string]: gradient }}
    >
      <div className="season-card-head group-head">
        {dnd && members.length > 0 && (
          <button
            type="button"
            className="season-grip"
            aria-label={`Drag ${group.name} above or below another group, or onto a season to move its goals. Or press to choose.`}
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
            {ideas.length ? ` · ${ideas.length} planned idea${ideas.length === 1 ? '' : 's'}` : ''}
            {shared.length ? ` · ${shared.length} shared task${shared.length === 1 ? '' : 's'}` : ''}
          </span>
          {groupWait && <WaitBadge info={groupWait} />}
          <span className="season-open">
            Open <Icon name="chevron" size={14} stroke={2.4} />
          </span>
        </a>
      </div>
      {members.length > 0 && <GroupRollup group={group} />}
      {over && <span className="season-drop-hint">Release to add to {group.name}</span>}
      {members.map((m) => (
        <GoalRow key={m.card.goal.id} placed={m} dnd={dnd} onMove={onMove} />
      ))}
      {plan && ideas.map((i) => <PlannedIdeaRow key={i.id} idea={i} plan={plan} />)}
    </section>
  );
}

/**
 * A group's goals as one bar (each goal counts equally, finished ones fully), against where an
 * even pace would be.
 */
export function GroupRollup({ group, big = false }: { group: GoalGroup; big?: boolean }) {
  const view = useView();
  const r = groupTrack(view, group.id);
  if (r.count < 2) return null;
  const ink = STATUS_INK[r.label] ?? 'var(--ink-2)';
  const word = r.done === r.count ? 'All done' : r.label === 'ahead' ? 'Ahead' : r.label === 'behind' ? 'Behind' : r.label === 'on_track' ? 'On pace' : 'Not started';
  return (
    <div className={`group-rollup${big ? ' big' : ''}`}>
      <div className="group-outcome">
        <span className="group-outcome-text">{group.name}, all together</span>
        <span className="small" style={{ color: ink, whiteSpace: 'nowrap' }}>
          {word}
        </span>
      </div>
      <span className="season-track" style={{ marginLeft: 0 }} aria-label={`${r.prog}% of the group done, even pace ${r.exp}%`}>
        <span className="season-fill" style={{ width: `${r.prog}%`, background: 'var(--gradient)' }} />
        {r.exp > 0 && <span className="season-tick" style={{ left: `${r.exp}%` }} />}
      </span>
      <span className="season-row-foot" style={{ marginLeft: 0 }}>
        <span className="num">
          {r.done} of {r.count} goal{r.count === 1 ? '' : 's'} done
        </span>
        {r.by && <span className="muted">by {shortDate(r.by)}</span>}
      </span>
      {big && <span className="small" style={{ color: 'var(--ink-2)', padding: '0 0 4px' }}>{groupSentence(view, group)}</span>}
    </div>
  );
}

/** Goals not in a group, in the same card style. It also takes a goal dragged out of its group. */
export function LooseCard({ title, members, dnd, onMove, onNewGroup }: { title: string; members: Placed[]; dnd?: DragApi; onMove?: (g: Goal) => void; onNewGroup?: (g: Goal) => void }) {
  const over = dnd?.drag?.target === 'loose';
  const [picking, setPicking] = useState(false);
  const { data } = useStore();
  const gradient = groupGradient('loose', members.map((m) => m.card.goal.color), 100, gradientSlots(data).get('loose'));
  return (
    <section className={`season-card group-card${over ? ' drop-on' : ''}`} data-drop="loose" aria-label={title} style={{ ['--group-gradient' as string]: gradient }}>
      <div className="season-card-head group-head">
        <span className="season-card-title">
          <b>{title}</b>
          {dnd?.drag && !dnd.drag.group && dnd.drag.goal.group_id ? <span className="xsmall muted">Drop here to take it out of its group</span> : null}
          {onNewGroup && members.length > 0 && !dnd?.drag && (
            <button type="button" className="season-open" style={{ border: 0, background: 'none', font: 'inherit', cursor: 'pointer', marginLeft: 'auto' }} onClick={() => setPicking((p) => !p)}>
              {picking ? 'Cancel' : '+ New group'}
            </button>
          )}
        </span>
      </div>
      {picking && (
        <div className="season-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: '10px 16px 12px' }}>
          <span className="xsmall muted">Start a group with one of these (add more by dragging them onto it later):</span>
          <div className="chips">
            {members.map((m) => (
              <button key={m.card.goal.id} type="button" className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }} onClick={() => (setPicking(false), onNewGroup?.(m.card.goal))}>
                <span className="dot" style={{ width: 7, height: 7, background: m.card.goal.color }} />
                {m.card.goal.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {members.length === 0 && <span className="small muted" style={{ padding: '12px 16px' }}>None</span>}
      {members.map((m) => (
        <GoalRow key={m.card.goal.id} placed={m} dnd={dnd} onMove={onMove} />
      ))}
    </section>
  );
}

/**
 * The season header: the season as five chapters (Start · Build · Middle · Push · Finish), the
 * weeks that make them up as a ribbon coloured by each weekly review, the dates under both, and a
 * panel for the chapter you're in: its coaching line and what's due before it ends. Tap a chapter
 * to read another one; hover or tap a week to see how it went. The strip takes a dragged goal for
 * this season; the next-season line takes one for the next.
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
  const { today, data } = useStore();
  const view = useView();
  const { current, next } = seasons;
  const chapters = useMemo(() => (current ? seasonChapters(current) : []), [current?.start_date, current?.end_date]);
  const nowIndex = Math.max(0, chapters.findIndex((c) => today >= c.start && today <= c.end));
  const [pick, setPick] = useState<number | null>(null);
  const [peek, setPeek] = useState<{ n: number; x: number; pinned: boolean } | null>(null);
  // Always starts folded: the season details open on tap, for this visit only.
  const [open, setOpen] = useState(false);
  const toggleOpen = () => setOpen((o) => !o);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(320);
  useEffect(() => {
    const el = ribbonRef.current;
    if (!el) return;
    const measure = () => setWrapWidth(el.getBoundingClientRect().width || 320);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [current?.id]);
  useEffect(() => setPick(null), [current?.id]);
  useEffect(() => {
    if (!peek?.pinned) return;
    const off = () => setPeek(null);
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [peek?.pinned]);
  if (!current) return null;

  const arc = seasonArc(current, today);
  const nextDates = next ? { start: next.start_date, end: next.end_date } : nextSeasonDates(current);
  const goalsIn = (plan: Plan | null) => (plan ? placed.filter((p) => p.plan.id === plan.id).map((p) => p.card.goal.id) : []);
  const target = dnd?.drag?.target ?? '';
  const overCurrent = target === `plan:${current.id}` || target === `already:${current.id}`;
  const overNext = !!next && (target === `plan:${next.id}` || target === `already:${next.id}`);
  const index = pick ?? nowIndex;
  const panel = chapterView(view, data, current, index, today);
  const cells = weekRecord(data, current, today);
  const totals = weekTotals(cells);
  const cp = firstCheckpoint(current);
  const cpIndex = chapters.findIndex((c) => cp >= c.start && cp <= c.end);
  const plannedNext = placed.filter((p) => p.season === 'next').length + (next ? data.ideas.filter((i) => i.status === 'backlog' && i.plan_id === next.id).length : 0);
  const phaseWord: Record<string, string> = { before: 'Before the start', start: 'The start', build: 'Building', middle: 'The middle', push: 'The push', finish: 'The finish', after: 'Finished' };
  const span = (c: Chapter) => Math.max(1, daysBetween(c.start, c.end) + 1);
  const grid = chapters.map((c) => `${span(c)}fr`).join(' ');
  const elapsedIn = (c: Chapter) => Math.min(100, Math.max(0, ((daysBetween(c.start, today) + 1) / span(c)) * 100));
  const showPeek = (n: number, el: HTMLElement, pinned: boolean) => {
    const wrap = ribbonRef.current;
    if (!wrap) return;
    const wb = wrap.getBoundingClientRect();
    const bb = el.getBoundingClientRect();
    setPeek({ n, x: bb.left - wb.left + bb.width / 2, pinned });
  };
  const peekCell = peek ? cells.find((c) => c.n === peek.n) : null;
  const popWidth = Math.min(300, wrapWidth);
  const popLeft = peek ? Math.max(0, Math.min(wrapWidth - popWidth, peek.x - popWidth / 2)) : 0;

  return (
    <section className={`season-hz card${overCurrent ? ' drop-on' : ''}${peek ? ' peeking' : ''}`} aria-label="Season" data-drop={`plan:${current.id}`} data-goals={goalsIn(current).join(',')}>
      <div className="season-hz-head">
        <button type="button" className="hz-titlebtn" onClick={() => onSelect('current')} aria-pressed={selected === 'current'}>
          <span className="hz-title" title={current.name}>
            <span className="hz-title-pre">Season: </span>
            {current.name}
          </span>
          <span className="small muted">
            {arc.phase === 'before' ? `Starts ${shortDate(current.start_date)} · ${arc.weeks} weeks` : `Week ${arc.week} of ${arc.weeks} · ${phaseWord[arc.phase]} · ends ${shortDate(current.end_date)}`}
          </span>
        </button>
        <button type="button" className="hz-gear" onClick={() => onMenu(current)} aria-label={`${current.name} settings`}>
          <Icon name="edit" size={16} stroke={2} />
        </button>
      </div>

      <div className="hz-chap" style={{ gridTemplateColumns: grid }} role="tablist" aria-label="Chapters">
        {chapters.map((c, i) => (
          <button
            key={c.phase}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={`hz-ch${i < nowIndex || today > current.end_date ? ' done' : ''}${i === nowIndex && today >= current.start_date && today <= current.end_date ? ' now' : ''}${i === index && pick != null ? ' sel' : ''}`}
            style={i === nowIndex ? ({ ['--p' as string]: `${elapsedIn(c)}%` } as CSSProperties) : undefined}
            title={`${c.name} · ${chapterSpan(c)}`}
            onClick={() => setPick(i === nowIndex ? null : i)}
          >
            <span className="hz-ch-name">{c.name}</span>
            {i === cpIndex && <span className="hz-ch-cp">◆</span>}
          </button>
        ))}
      </div>

      <div className="hz-ribbonwrap" ref={ribbonRef}>
        <div className="hz-weeks" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }} aria-label={`${totals.hit} of ${totals.reviewed} reviewed weeks hit`}>
          {cells.map((c) => (
            <button
              key={c.monday}
              type="button"
              className={`hz-wk ${c.result}${c.current ? ' now' : ''}${c.reviewed ? ' rev' : ''}${peek?.n === c.n ? ' hov' : ''}`}
              aria-label={`Week ${c.n}, ${shortDate(c.monday)}${c.result === 'none' ? '' : `: ${c.result === 'hit' ? 'all week goals hit' : c.result === 'part' ? 'partly' : 'missed'}`}`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && !peek?.pinned && showPeek(c.n, e.currentTarget, false)}
              onPointerLeave={() => !peek?.pinned && setPeek(null)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => (peek?.pinned && peek.n === c.n ? setPeek(null) : showPeek(c.n, e.currentTarget, true))}
            />
          ))}
        </div>
        {peek && peekCell && (
          <div className="hz-pop" style={{ left: popLeft, width: popWidth, ['--ax' as string]: `${peek.x - popLeft - 6}px` } as CSSProperties} role="tooltip" onPointerDown={(e) => e.stopPropagation()}>
            <div className="hz-pop-h">
              <b>
                Week {peekCell.n}
                {peekCell.current ? ' · this week' : ''}
              </b>
              <span className={`hz-pop-r ${peekCell.result}`}>
                {peekCell.current ? 'reviewed Saturday' : peekCell.future ? 'not yet' : peekCell.result === 'hit' ? 'All week goals hit' : peekCell.result === 'part' ? 'Partly' : peekCell.result === 'miss' ? 'Missed' : 'No review'}
              </span>
            </div>
            <div className="hz-pop-sub">{shortDate(peekCell.monday)} – {shortDate(peekCell.sunday)}{chapters.find((c) => peekCell.monday <= c.end && peekCell.sunday >= c.start) ? ` · ${chapters.find((c) => peekCell.monday <= c.end && peekCell.sunday >= c.start)!.name}` : ''}</div>
            {peekCell.goals.map((g) => (
              <div key={g.goal.id} className="hz-pop-g">
                <i style={{ background: g.goal.color }} />
                <span>{g.note || g.goal.title}</span>
                <span className="hz-pop-mark">{g.result === 'hit' ? '✓' : g.result === 'partly' ? '½' : '✕'}</span>
              </div>
            ))}
            {peekCell.change && (
              <div className="hz-pop-f">
                Change: <span>{peekCell.change}</span>
                {peekCell.reviewed ? ' · month review' : ''}
              </div>
            )}
            {!peekCell.goals.length && !peekCell.change && <div className="hz-pop-f">{peekCell.future ? 'Hasn’t happened yet.' : peekCell.current ? 'Saturday’s review colours it in.' : 'No weekly review was saved.'}</div>}
          </div>
        )}
      </div>

      <button type="button" className={`hz-fold${open ? ' open' : ''}`} onClick={toggleOpen} aria-expanded={open} aria-controls="hz-more">
        <span>{open ? 'Hide season details' : panel ? `${panel.chapter.name} · ${panel.due.length} due in this stretch · ${totals.reviewed ? `${totals.hit} of ${totals.reviewed} weeks hit` : 'first review Saturday'}` : 'More'}</span>
        <Icon name="chevron" size={14} stroke={2.4} />
      </button>
      {open && (
      <div id="hz-more" className="hz-more">
      <div className="hz-cdates mono" aria-hidden="true">
        {(() => {
          // One label per chapter start, left-aligned to its column; a label that would overlap the last one shown is skipped.
          const totalDays = chapters.reduce((n, c) => n + span(c), 0);
          const pxPerDay = wrapWidth / Math.max(1, totalDays);
          const out: { key: string; left: number; text: string }[] = [];
          let lastRight = -Infinity;
          let left = 0;
          chapters.forEach((c, i) => {
            const text = `${i === cpIndex ? '◆ ' : ''}${shortDate(c.start).toUpperCase()}`;
            const width = text.length * 6.4;
            // The last label is pulled back inside the card if it would run past the edge.
            const at = Math.max(0, Math.min(left, wrapWidth - width));
            if (at >= lastRight + 8 || i === 0) {
              out.push({ key: c.phase, left: at, text });
              lastRight = at + width;
            }
            left += span(c) * pxPerDay;
          });
          return out.map((d) => (
            <span key={d.key} style={{ left: d.left }}>
              {d.text}
            </span>
          ));
        })()}
      </div>
      <div className="hz-legend">
        <span>
          <i className="hit" />hit <i className="part" />partly <i className="miss" />missed <i className="now" />this week
        </span>
        <span>
          {totals.reviewed ? (
            <>
              <b>{totals.hit}</b> of {totals.reviewed} weeks hit{totals.bestRun > 1 ? <> · best run <b>{totals.bestRun}</b></> : null}
            </>
          ) : (
            'Saturday’s review colours the first week'
          )}
        </span>
      </div>

      {panel && (
        <div className={`hz-panel ${panel.state}`} key={panel.index}>
          <div className="hz-panel-h">
            <b>
              {panel.chapter.name} · {chapterSpan(panel.chapter)}
            </b>
            <span className="xsmall muted">
              {panel.state === 'now'
                ? `week ${panel.weekIn} of ${panel.weeks}${panel.onPace.of ? ` · ${panel.onPace.on} of ${panel.onPace.of} on pace` : ''}`
                : panel.state === 'past'
                  ? `done · ${panel.weeks} week${panel.weeks === 1 ? '' : 's'}`
                  : `starts ${shortDate(panel.chapter.start)} · ${panel.weeks} week${panel.weeks === 1 ? '' : 's'}`}
            </span>
          </div>
          <p className="hz-voice small">{panel.line}</p>
          {panel.state === 'past' && panel.went && (
            <>
              <span className="mono">How it went</span>
              <span className="xsmall" style={{ color: 'var(--ink-2)' }}>{panel.went}</span>
            </>
          )}
          <span className="mono">{panel.state === 'now' ? 'Due in this stretch' : panel.state === 'past' ? 'What was due' : 'What this stretch asks'}</span>
          {panel.due.length === 0 && <span className="xsmall muted">Nothing dated in this stretch. Add dates to hit on the roadmap.</span>}
          <div className="hz-due">
            {panel.due.slice(0, 6).map((d) => (
              <a key={d.key} href={href(d.to)} className="hz-due-row">
                <span className="hz-due-dt">{shortDate(d.date).toUpperCase()}</span>
                <span className="dot" style={{ width: 9, height: 9, background: d.color }} />
                <span className={d.strong ? 'strong' : ''}>{d.title}</span>
                <span className={`hz-due-st ${d.tone}`}>{d.status}</span>
              </a>
            ))}
            {panel.due.length > 6 && (
              <a href={href('/goals/roadmap')} className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600, padding: '6px 4px' }}>
                +{panel.due.length - 6} more on the roadmap
              </a>
            )}
          </div>
          <div className="hz-step">
            <button type="button" disabled={index === 0} onClick={() => setPick(index - 1 === nowIndex ? null : index - 1)}>
              ‹ {index > 0 ? chapters[index - 1]!.name : ''}
            </button>
            {pick != null && (
              <button type="button" className="hz-step-now" onClick={() => setPick(null)}>
                Back to now
              </button>
            )}
            <button type="button" disabled={index === chapters.length - 1} onClick={() => setPick(index + 1 === nowIndex ? null : index + 1)} style={{ textAlign: 'right' }}>
              {index < chapters.length - 1 ? chapters[index + 1]!.name : ''} ›
            </button>
          </div>
        </div>
      )}

      </div>
      )}
      <button
        type="button"
        className={`hz-next${selected === 'next' ? ' on' : ''}${overNext ? ' drop-on' : ''}`}
        onClick={() => (next ? onSelect(selected === 'next' ? 'current' : 'next') : onPlanNext())}
        data-drop={next ? `plan:${next.id}` : undefined}
        data-goals={goalsIn(next).join(',')}
        aria-pressed={selected === 'next'}
      >
        <span className="hz-next-pill">Next season</span>
        <span className="xsmall muted">
          {shortDate(nextDates.start)} – {shortDate(nextDates.end)} · {next ? `${plannedNext} planned` : 'not planned yet'}
        </span>
        <span className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {next ? (selected === 'next' ? 'Back to this season' : 'Show it') : 'Plan it'}
        </span>
      </button>
      {next && selected === 'next' && (
        <button type="button" className="hz-gear-inline link-btn xsmall" onClick={() => onMenu(next)} style={{ alignSelf: 'flex-end', padding: 0 }}>
          Next season settings
        </button>
      )}
      {dnd?.drag && <span className="xsmall" style={{ color: 'var(--accent-ink)' }}>Drop on the chapters for this season{next ? ', or on the next-season line,' : ''} to move {dnd.drag.group ? dnd.drag.group.name : dnd.drag.goal.title}</span>}
    </section>
  );
}

/** On pace, the next checkpoint and the next review, as three tiles that wrap instead of crowding. */
export function SeasonStats({ season, members, ideas = 0 }: { season: Plan; members: Placed[]; ideas?: number }) {
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
          {ideas > 0 && <small>+ {ideas} idea{ideas === 1 ? '' : 's'}</small>}
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

/** "By Apr 24 you'll have": what each goal's done looks like. Early finishers show their date; goals behind say so. */
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
      {members.map((m) => {
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
  if (d.target?.startsWith('order:') || d.target?.startsWith('gorder:')) return d.target.endsWith(':before') ? 'Move above' : 'Move below';
  if (d.target?.startsWith('already:')) return 'Already in this season';
  if (d.target?.startsWith('plan:')) return 'Move into this season';
  if (d.target === 'loose') return 'Take out of its group';
  if (d.target?.startsWith('group:')) return 'Add to this group';
  return 'Make a group';
}

