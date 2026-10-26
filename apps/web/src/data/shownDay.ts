import { useSyncExternalStore } from 'react';
import type { ISODate } from '@six/core';

/**
 * The day the Today screen is showing, when it isn't today. The dock's "Add or log" button adds to
 * this day, so looking at Thursday and pressing + adds to Thursday.
 */
let shown: ISODate | null = null;
const listeners = new Set<() => void>();

export function setShownDay(day: ISODate | null): void {
  if (shown === day) return;
  shown = day;
  for (const l of listeners) l();
}

export function useShownDay(): ISODate | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => shown,
  );
}
