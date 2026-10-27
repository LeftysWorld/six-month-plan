import type { GoalIdea, IdeaBucket, IdeaStatus } from './types.ts';

/**
 * The goal backlog: one list of ideas in order of importance. An idea becomes a goal when you
 * make it one, or is discarded. Pure helpers, no UI.
 */

/** The bucket an idea is in: a backlog idea with shortlisted_at set is 'selected'. */
export function bucketOf(i: Pick<GoalIdea, 'status' | 'shortlisted_at'>): IdeaBucket {
  return i.status === 'backlog' && i.shortlisted_at ? 'selected' : i.status;
}

/** Refined enough to select: it says why it matters and what done looks like. */
export function ideaReady(i: Pick<GoalIdea, 'note' | 'done_means'>): boolean {
  return i.note.trim().length > 0 && (i.done_means ?? '').trim().length > 0;
}

/** Ideas in one bucket, most important first. */
export function column(ideas: GoalIdea[], status: IdeaBucket): GoalIdea[] {
  return ideas
    .filter((i) => bucketOf(i) === status)
    .sort((a, b) => a.rank - b.rank || (a.created_at < b.created_at ? -1 : 1));
}

/** A rank that puts an idea at the end of a column. */
export function rankAtEnd(ideas: GoalIdea[], status: IdeaBucket): number {
  const list = column(ideas, status);
  return list.length ? list[list.length - 1]!.rank + 1 : 1;
}

/** A rank that puts an idea at the top of a column. */
export function rankAtTop(ideas: GoalIdea[], status: IdeaBucket): number {
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
  const list = column(ideas, bucketOf(idea));
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

/** Whole days an idea has been waiting (since it was written down). */
export function ageInDays(idea: Pick<GoalIdea, 'created_at'>, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(idea.created_at)) / 864e5));
}

/**
 * A rank that puts an idea at position `index` of a column (0 = top), ignoring where it is now.
 * Used for drag and drop, including moving it into another column.
 */
export function rankAt(ideas: GoalIdea[], id: string, status: IdeaBucket, index: number): number {
  const list = column(ideas, status).filter((i) => i.id !== id);
  const at = Math.max(0, Math.min(index, list.length));
  if (list.length === 0) return 1;
  if (at === 0) return list[0]!.rank - 1;
  if (at === list.length) return list[list.length - 1]!.rank + 1;
  const before = list[at - 1]!.rank;
  const after = list[at]!.rank;
  return before === after ? before + 0.0001 : (before + after) / 2;
}
