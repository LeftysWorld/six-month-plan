import type { GoalIdea, IdeaStatus } from './types.ts';

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

/** Whole days an idea has been waiting (since it was written down). */
export function ageInDays(idea: Pick<GoalIdea, 'created_at'>, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(idea.created_at)) / 864e5));
}
