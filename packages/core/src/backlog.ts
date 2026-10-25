import type { GoalIdea, IdeaPrep, IdeaStatus } from './types.ts';
import type { ISODate } from './dates.ts';

/**
 * The goal backlog, Kanban style: ideas wait in the backlog in order of importance, the best few
 * are pulled into "Selected for next commitment" (with a small limit), and a selected idea is
 * started as a goal when there's room. Pure helpers, no UI.
 */

/** How many ideas can sit in "Selected for next commitment" at once. */
export const SELECTED_LIMIT = 3;

/** Ideas in one column, most important first. */
export function column(ideas: GoalIdea[], status: IdeaStatus): GoalIdea[] {
  return ideas
    .filter((i) => i.status === status)
    .sort((a, b) => a.rank - b.rank || (a.created_at < b.created_at ? -1 : 1));
}

/** A rank that puts an idea at the end of a column. */
export function rankAtEnd(ideas: GoalIdea[], status: IdeaStatus): number {
  const list = column(ideas, status);
  return list.length ? list[list.length - 1]!.rank + 1 : 1;
}

/** A rank that puts an idea at the top of a column. */
export function rankAtTop(ideas: GoalIdea[], status: IdeaStatus): number {
  const list = column(ideas, status);
  return list.length ? list[0]!.rank - 1 : 1;
}

/**
 * New ranks after moving an idea within its column: 'up' / 'down' swap it with its neighbour,
 * 'top' puts it first. Returns only the ideas whose rank changed (empty when it can't move).
 */
export function reorder(ideas: GoalIdea[], id: string, move: 'up' | 'down' | 'top'): { id: string; rank: number }[] {
  const idea = ideas.find((i) => i.id === id);
  if (!idea) return [];
  const list = column(ideas, idea.status);
  const at = list.findIndex((i) => i.id === id);
  if (move === 'top') return at <= 0 ? [] : [{ id, rank: list[0]!.rank - 1 }];
  const other = list[move === 'up' ? at - 1 : at + 1];
  if (!other) return [];
  // Equal ranks (e.g. from two devices) would make a swap a no-op, so nudge apart.
  const same = other.rank === idea.rank;
  return [
    { id, rank: other.rank + (same ? (move === 'up' ? -0.5 : 0.5) : 0) },
    { id: other.id, rank: idea.rank },
  ];
}

/** Can another idea be selected right now? */
export function hasRoom(ideas: GoalIdea[], limit = SELECTED_LIMIT): boolean {
  return column(ideas, 'selected').length < limit;
}

/**
 * What an idea still needs before it can be selected for the next commitment
 * (the entry policy): a reason it matters and what done looks like.
 */
export function readinessGaps(idea: Pick<GoalIdea, 'note' | 'done_means'>): ('why' | 'done')[] {
  const gaps: ('why' | 'done')[] = [];
  if (!idea.note.trim()) gaps.push('why');
  if (!(idea.done_means ?? '').trim()) gaps.push('done');
  return gaps;
}

/** Whole days an idea has been waiting (since it was written down). */
export function ageInDays(idea: Pick<GoalIdea, 'created_at'>, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(idea.created_at)) / 864e5));
}

export type PrepGap = 'goal' | 'quarter' | 'month' | 'week' | 'task' | 'target' | 'timing';

/** Days in an own clock of `months` months (3 → 13 weeks, 6 → 26 weeks). */
export function clockDays(months: number): number {
  return months <= 3 ? 91 : months * 30 + Math.floor(months / 2);
}

/**
 * What a selected idea still needs before it can be committed (the entry policy for goals):
 * the goal itself (what done looks like), its 3-month goal (unless the whole goal is 3 months
 * or less), month and week goals, a daily task with its days, a target and date for "reach a
 * number", and its timing (own clock or a batch).
 * Joining a batch, a note written for a period of the batch that has since passed counts as
 * missing. On its own clock the notes are for its first 3 months, month and week, so they
 * don't go stale.
 */
export function prepGaps(
  prep: IdeaPrep | undefined,
  periods: { quarter: { start: ISODate }; month: { start: ISODate }; week: { start: ISODate } },
  opts: { doneMeans?: string; horizonDays?: number } = {},
): PrepGap[] {
  const p = prep ?? {};
  const gaps: PrepGap[] = [];
  if (opts.doneMeans !== undefined && !opts.doneMeans.trim()) gaps.push('goal');
  const own = p.clock === 'own';
  const levels = (opts.horizonDays ?? 999) <= 98 ? (['month', 'week'] as const) : (['quarter', 'month', 'week'] as const);
  for (const level of levels) {
    const note = (p[level] ?? '').trim();
    if (!note || (!own && p[`${level}_of`] !== periods[level].start)) gaps.push(level);
  }
  if (!p.task || !p.task.title.trim() || p.task.days.length === 0 || !(p.task.minutes > 0)) gaps.push('task');
  if (p.type === 'number' && (p.target == null || !p.target_date)) gaps.push('target');
  if (!p.clock || (p.clock === 'batch' && !p.plan_id)) gaps.push('timing');
  return gaps;
}

/** Was this note written for an earlier period (rather than never written)? */
export function isStale(prep: IdeaPrep | undefined, level: 'quarter' | 'month' | 'week', periodStart: ISODate): boolean {
  return prep?.clock !== 'own' && !!prep?.[level]?.trim() && prep[`${level}_of`] !== periodStart;
}

/**
 * A rank that puts an idea at position `index` of a column (0 = top), ignoring where it is now.
 * Used for drag and drop, including moving it into another column.
 */
export function rankAt(ideas: GoalIdea[], id: string, status: IdeaStatus, index: number): number {
  const list = column(ideas, status).filter((i) => i.id !== id);
  const at = Math.max(0, Math.min(index, list.length));
  if (list.length === 0) return 1;
  if (at === 0) return list[0]!.rank - 1;
  if (at === list.length) return list[list.length - 1]!.rank + 1;
  const before = list[at - 1]!.rank;
  const after = list[at]!.rank;
  return before === after ? before + 0.0001 : (before + after) / 2;
}
