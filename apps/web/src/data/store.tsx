import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dayFractionIn, todayIn, weekStart, type ISODate } from '@six/core';
import type { Db } from './db.ts';
import { SaveError } from './db.ts';
import { applyOp, type AppData, type Op } from './model.ts';
import { opsEnsureWeek } from './ops.ts';
import { opsFoldLinksIntoGroups } from './groups.ts';
import { opsMergeDuplicateMeasures } from './connect.ts';
import { opsFillWorkoutPlans } from './breakdown.ts';

export interface SyncState {
  /** Changes waiting to be saved. */
  pending: number;
  /** True while the last save attempt failed because of the network. */
  offline: boolean;
  /** A change the database refused (shown once, then cleared). */
  error: string | null;
}

interface StoreValue {
  data: AppData;
  db: Db;
  today: ISODate;
  /** Share of today's waking hours already gone, 0..1. */
  dayFraction: number;
  sync: SyncState;
  /** Apply changes to the screen now and save them in the background. */
  commit: (ops: Op[]) => void;
  /** Reload everything from the backend. */
  reload: () => Promise<void>;
  clearError: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const OUTBOX_KEY = 'six.outbox.v1';

function readOutbox(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as Op[];
  } catch {
    return [];
  }
}

function writeOutbox(ops: Op[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
  } catch {
    // ignore: the queue still lives in memory for this session
  }
}

export function StoreProvider({ db, initial, children }: { db: Db; initial: AppData; children: ReactNode }) {
  const [data, setData] = useState<AppData>(initial);
  const [clock, setClock] = useState(() => Date.now());
  const [sync, setSync] = useState<SyncState>({ pending: 0, offline: false, error: null });
  const queue = useRef<Op[]>(db.mode === 'supabase' ? readOutbox() : []);
  const flushing = useRef(false);
  const retryTimer = useRef<number | null>(null);
  const backoff = useRef(2000);

  const timezone = data.profile.timezone;
  const today = useMemo(() => todayIn(timezone, new Date(clock)), [timezone, clock]);
  const dayFraction = useMemo(() => dayFractionIn(timezone, new Date(clock)), [timezone, clock]);

  // Tick every minute so "today" rolls over at midnight without a reload.
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 60_000);
    const onFocus = () => setClock(Date.now());
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (queue.current.length > 0) {
        const op = queue.current[0]!;
        try {
          await db.apply(op);
          queue.current = queue.current.slice(1);
          if (db.mode === 'supabase') writeOutbox(queue.current);
          backoff.current = 2000;
          setSync((s) => ({ ...s, pending: queue.current.length, offline: false }));
        } catch (err) {
          const retryable = err instanceof SaveError ? err.retryable : true;
          if (retryable) {
            setSync((s) => ({ ...s, pending: queue.current.length, offline: true }));
            if (retryTimer.current) window.clearTimeout(retryTimer.current);
            retryTimer.current = window.setTimeout(() => void flush(), backoff.current);
            backoff.current = Math.min(backoff.current * 2, 60_000);
            return;
          }
          // The database refused this change: drop it so the queue keeps moving.
          queue.current = queue.current.slice(1);
          if (db.mode === 'supabase') writeOutbox(queue.current);
          setSync((s) => ({
            ...s,
            pending: queue.current.length,
            error: `A change couldn't be saved: ${(err as Error).message}`,
          }));
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [db]);

  const commit = useCallback(
    (ops: Op[]) => {
      if (ops.length === 0) return;
      setData((current) => ops.reduce(applyOp, current));
      queue.current = [...queue.current, ...ops];
      if (db.mode === 'supabase') writeOutbox(queue.current);
      setSync((s) => ({ ...s, pending: queue.current.length }));
      void flush();
    },
    [db, flush],
  );

  // Changes left over from a previous session: show them and send them.
  useEffect(() => {
    if (queue.current.length > 0) {
      setData((current) => queue.current.reduce(applyOp, current));
      setSync((s) => ({ ...s, pending: queue.current.length }));
      void flush();
    }
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flush]);

  // Connections made before groups existed become groups, once. Skipped while the database is
  // missing an update (the groups table might not be there yet, and the links would be lost).
  useEffect(() => {
    if (db.schemaWarning?.()) return;
    const ops = opsFoldLinksIntoGroups(data);
    if (ops.length > 0) commit(ops);
    // A goal that ended up with the same measurement twice (two "Weight"s) gets them merged.
    const merge = opsMergeDuplicateMeasures(ops.length ? ops.reduce(applyOp, data) : data);
    if (merge.length > 0) commit(merge);
    // Workout tasks with their exercises written in details get a plan to log against.
    const plans = opsFillWorkoutPlans(data);
    if (plans.length > 0) commit(plans);
    // Only when the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Make sure this week's sessions exist (first open of the week, or a skipped review).
  useEffect(() => {
    const ops = opsEnsureWeek(data, weekStart(today));
    if (ops.length > 0) commit(ops);
    // Only when the day or the set of actions/schedules changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, data.actions.length, data.schedules.length]);

  const reload = useCallback(async () => {
    const fresh = await db.loadAll();
    setData(queue.current.reduce(applyOp, fresh));
  }, [db]);

  const clearError = useCallback(() => setSync((s) => ({ ...s, error: null })), []);

  const value = useMemo<StoreValue>(
    () => ({ data, db, today, dayFraction, sync, commit, reload, clearError }),
    [data, db, today, dayFraction, sync, commit, reload, clearError],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside StoreProvider');
  return value;
}
