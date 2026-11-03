import type { Session } from '@six/core';
import type { Op } from './model.ts';

/**
 * Your order for a day's tasks on Today: drag a card by its grip and it stays where you put it.
 * Saved on each session (sessions.day_order), so it's the same on every device. Tasks you haven't
 * placed keep the old order (priority first) and come after the ones you have.
 */

/** The day's cards in your order: placed ones by their number, then the rest as before. */
export function byDayOrder(sessions: Session[]): Session[] {
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const oa = a.s.day_order ?? Infinity;
      const ob = b.s.day_order ?? Infinity;
      if (oa !== ob) return oa - ob;
      const pa = Number(b.s.priority) - Number(a.s.priority);
      return pa || a.i - b.i;
    })
    .map(({ s }) => s);
}

/**
 * Move one card to `index` in the list as shown (0 = top), and number the whole list 0, 1, 2…
 * so the order holds. Only cards whose number changes get an update; one undo puts them back.
 */
export function opsOrderDay(shown: Session[], movedId: string, index: number): { ops: Op[]; undo: Op[] } {
  const moved = shown.find((s) => s.id === movedId);
  if (!moved) return { ops: [], undo: [] };
  const rest = shown.filter((s) => s.id !== movedId);
  const from = shown.indexOf(moved);
  // The index counts the moved card's old slot; take it out first.
  const at = Math.max(0, Math.min(rest.length, index > from ? index - 1 : index));
  const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
  const ops: Op[] = [];
  const undo: Op[] = [];
  next.forEach((s, i) => {
    if (s.day_order === i) return;
    ops.push({ kind: 'update', collection: 'sessions', id: s.id, patch: { day_order: i } });
    undo.push({ kind: 'update', collection: 'sessions', id: s.id, patch: { day_order: s.day_order ?? null } });
  });
  return { ops, undo };
}
