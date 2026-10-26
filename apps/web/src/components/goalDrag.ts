import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Goal, GoalGroup } from '@six/core';

/** What's being dragged (a goal, or a whole group) and where it would land. */
export interface GoalDrag {
  /** The goal being dragged, or the group's first goal (for its colour) when a group is. */
  goal: Goal;
  group: GoalGroup | null;
  /** Every goal that moves: just the goal, or all of the group's goals. */
  goals: Goal[];
  x: number;
  y: number;
  target: string | null;
}

export type DragWhat = Pick<GoalDrag, 'goal' | 'group' | 'goals'>;

/**
 * Drag goals like phone apps: grab the handle (or press and hold a card on a touch screen, or
 * drag it a few pixels with a mouse). A group drags by its handle too. Drop targets carry
 * data-drop: "goal:<id>", "group:<id>" and "loose" (for goals), "plan:<id>" (for goals
 * and groups). A batch line lists the goals already in it (data-goals), so dropping them there
 * again does nothing.
 */
export function useGoalDrag(onDrop: (d: GoalDrag, target: string) => void) {
  const [drag, setDrag] = useState<GoalDrag | null>(null);
  const dragRef = useRef<GoalDrag | null>(null);
  const pending = useRef<{ what: DragWhat; x: number; y: number; touch: boolean; handle: boolean; timer: number | null } | null>(null);
  const off = useRef<(() => void) | null>(null);
  const suppress = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const targetAt = (x: number, y: number, what: DragWhat): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null;
    const t = el?.dataset.drop ?? null;
    if (!t) return null;
    if (t.startsWith('plan:')) {
      const there = new Set((el?.dataset.goals ?? '').split(',').filter(Boolean));
      // Already there: still a target, so the batch can say so (dropping does nothing).
      return what.goals.every((g) => there.has(g.id)) ? `already:${t.slice(5)}` : t;
    }
    if (what.group) return null; // a group only goes into a season
    const goal = what.goal;
    if (t === `goal:${goal.id}`) return null;
    if (t === `group:${goal.group_id}`) return null; // already in it
    if (t === 'loose' && !goal.group_id) return null; // already on its own
    return t;
  };
  const stop = () => {
    if (pending.current?.timer) window.clearTimeout(pending.current.timer);
    pending.current = null;
    off.current?.();
    off.current = null;
  };
  const begin = (what: DragWhat, x: number, y: number) => {
    const d: GoalDrag = { ...what, x, y, target: targetAt(x, y, what) };
    dragRef.current = d;
    suppress.current = true;
    setDrag(d);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no vibration */
    }
  };
  /** From a card: hold (touch) or move a few pixels (mouse). From a handle: any small move. */
  const start = (e: ReactPointerEvent<HTMLElement>, what: DragWhat, handle = false) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stop();
    const touch = e.pointerType !== 'mouse' && !handle;
    const p = { what, x: e.clientX, y: e.clientY, touch, handle, timer: null as number | null };
    pending.current = p;
    suppress.current = false;
    if (touch) p.timer = window.setTimeout(() => pending.current === p && begin(what, p.x, p.y), 320);
    const move = (ev: PointerEvent) => {
      const q = pending.current;
      if (!dragRef.current && q) {
        const dist = Math.hypot(ev.clientX - q.x, ev.clientY - q.y);
        if (q.touch) {
          if (dist > 10) stop(); // scrolling, not dragging
          return;
        }
        if (dist < (q.handle ? 4 : 6)) return;
        begin(q.what, ev.clientX, ev.clientY);
      }
      const d = dragRef.current;
      if (!d) return;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      if (ev.clientY < 72) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 72) window.scrollBy(0, 12);
      const next = { ...d, x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientX, ev.clientY, d) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      stop();
      setDrag(null);
      if (d?.target) dropRef.current(d, d.target);
    };
    const cancel = () => {
      dragRef.current = null;
      stop();
      setDrag(null);
    };
    const touchMove = (ev: TouchEvent) => {
      if (dragRef.current) ev.preventDefault();
    };
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && cancel();
    const menu = (ev: Event) => pending.current?.touch && ev.preventDefault();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('keydown', key);
    window.addEventListener('contextmenu', menu);
    off.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('keydown', key);
      window.removeEventListener('contextmenu', menu);
    };
  };
  useEffect(() => () => off.current?.(), []);
  /** True once right after a drag, so the click that ends it doesn't also open the goal. */
  const consumeClick = () => {
    const was = suppress.current;
    suppress.current = false;
    return was;
  };
  return { drag, start, consumeClick };
}

export type DragApi = ReturnType<typeof useGoalDrag>;
