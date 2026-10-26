import { useMemo } from 'react';
import { View } from './derive.ts';
import { useStore } from './store.tsx';

/** The derived view of the data on screen, rebuilt when the data or the day changes. */
export function useView(): View {
  const { data, today, dayFraction } = useStore();
  return useMemo(() => new View(data, today, dayFraction), [data, today, dayFraction]);
}
