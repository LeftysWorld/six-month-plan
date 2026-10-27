import type { Op } from './model.ts';

/**
 * Your own order on the Goals page. Goals and groups carry a sort_order; items placed by hand come
 * first in that order, the rest follow in the order they were given (the app's usual ranking).
 */

interface Ordered {
  id: string;
  sort_order?: number | null;
}

/** Stable sort: hand-placed items by sort_order, then everything else in the order given. */
export function byOrder<T extends Ordered>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ao = a.item.sort_order ?? null;
      const bo = b.item.sort_order ?? null;
      if (ao != null && bo != null) return ao - bo || a.i - b.i;
      if (ao != null) return -1;
      if (bo != null) return 1;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/**
 * Move `movedId` so it sits just before `beforeId` (or at the end with null) among `siblings`,
 * which must already be in display order. Every sibling gets an explicit position, so the order
 * stays put as goals are added later (new ones land at the end).
 */
export function placeAmong<T extends Ordered>(collection: 'goals' | 'groups', siblings: T[], movedId: string, beforeId: string | null): Op[] {
  const moved = siblings.find((s) => s.id === movedId);
  if (!moved || movedId === beforeId) return [];
  const rest = siblings.filter((s) => s.id !== movedId);
  const at = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
  const next = at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
  const ops: Op[] = [];
  next.forEach((s, i) => {
    if ((s.sort_order ?? null) !== i) ops.push({ kind: 'update', collection, id: s.id, patch: { sort_order: i } });
  });
  return ops;
}
