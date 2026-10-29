import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Where a dragged row would land: a bucket and a position in it (0 = top). */
export interface ListDrop {
  bucket: string;
  index: number;
  /** The row the line is drawn against, and which side. */
  rowId: string | null;
  side: 'before' | 'after';
  /**
   * Dropped onto something instead of between rows: a row that takes drops onto it (data-onto, the
   * middle half of it) or a group (an element with data-group-drop="<group id>").
   */
  onto?: { kind: 'row' | 'group'; id: string } | null;
}

export interface ListDrag {
  id: string;
  x: number;
  y: number;
  drop: ListDrop | null;
}

/**
 * Drag rows in one or more vertical lists to order them, by a handle (any pointer) or by pressing
 * and holding the row on a touch screen. Rows carry data-row-id, data-bucket and data-index;
 * a list's container carries data-bucket-drop="<bucket>" so a drop on its empty space lands at the
 * end. The top half of a row means "before it", the bottom half "after it".
 */
export function useListDrag(onDrop: (id: string, drop: ListDrop) => void) {
  const [drag, setDrag] = useState<ListDrag | null>(null);
  const dragRef = useRef<ListDrag | null>(null);
  const pending = useRef<{ id: string; x: number; y: number; touch: boolean; timer: number | null } | null>(null);
  const off = useRef<(() => void) | null>(null);
  const suppress = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const dropAt = (x: number, y: number, id: string): ListDrop | null => {
    const under = document.elementFromPoint(x, y);
    const row = under?.closest('[data-row-id]') as HTMLElement | null;
    if (row && row.dataset.rowId && row.dataset.bucket) {
      const box = row.getBoundingClientRect();
      const side: 'before' | 'after' = y < box.top + box.height / 2 ? 'before' : 'after';
      const i = Number(row.dataset.index ?? 0);
      if (row.dataset.rowId === id) return null;
      // The middle half of a row that takes drops: onto it (make a group with it, or join its group).
      const onto = row.dataset.onto === '1' && y > box.top + box.height * 0.25 && y < box.bottom - box.height * 0.25;
      return { bucket: row.dataset.bucket, index: side === 'before' ? i : i + 1, rowId: row.dataset.rowId, side, onto: onto ? { kind: 'row', id: row.dataset.rowId } : null };
    }
    const group = under?.closest('[data-group-drop]') as HTMLElement | null;
    if (group?.dataset.groupDrop) {
      const bucket = (group.closest('[data-bucket-drop]') as HTMLElement | null)?.dataset.bucketDrop ?? '';
      return { bucket, index: 0, rowId: null, side: 'after', onto: { kind: 'group', id: group.dataset.groupDrop } };
    }
    const list = under?.closest('[data-bucket-drop]') as HTMLElement | null;
    if (list?.dataset.bucketDrop) {
      const rows = list.querySelectorAll('[data-row-id]');
      return { bucket: list.dataset.bucketDrop, index: rows.length, rowId: null, side: 'after' };
    }
    return null;
  };
  const stop = () => {
    if (pending.current?.timer) window.clearTimeout(pending.current.timer);
    pending.current = null;
    off.current?.();
    off.current = null;
  };
  const begin = (id: string, x: number, y: number) => {
    const d: ListDrag = { id, x, y, drop: dropAt(x, y, id) };
    dragRef.current = d;
    suppress.current = true;
    setDrag(d);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no vibration */
    }
  };
  const start = (e: ReactPointerEvent<HTMLElement>, id: string, handle = false) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stop();
    const touch = e.pointerType !== 'mouse' && !handle;
    const p = { id, x: e.clientX, y: e.clientY, touch, timer: null as number | null };
    pending.current = p;
    suppress.current = false;
    if (touch) p.timer = window.setTimeout(() => pending.current === p && begin(id, p.x, p.y), 320);
    const move = (ev: PointerEvent) => {
      const q = pending.current;
      if (!dragRef.current && q) {
        const dist = Math.hypot(ev.clientX - q.x, ev.clientY - q.y);
        if (q.touch) {
          if (dist > 10) stop();
          return;
        }
        if (dist < (handle ? 4 : 6)) return;
        begin(q.id, ev.clientX, ev.clientY);
      }
      const d = dragRef.current;
      if (!d) return;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      if (ev.clientY < 72) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 72) window.scrollBy(0, 12);
      const next = { ...d, x: ev.clientX, y: ev.clientY, drop: dropAt(ev.clientX, ev.clientY, d.id) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      stop();
      setDrag(null);
      if (d?.drop) dropRef.current(d.id, d.drop);
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
  const consumeClick = () => {
    const was = suppress.current;
    suppress.current = false;
    return was;
  };
  return { drag, start, consumeClick };
}

export type ListDragApi = ReturnType<typeof useListDrag>;
