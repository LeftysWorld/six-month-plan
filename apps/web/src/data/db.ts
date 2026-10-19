import type { AppData, Op } from './model.ts';

/** The storage backend. The store never talks to Supabase or localStorage directly. */
export interface Db {
  mode: 'supabase' | 'demo';
  /** Load everything for the signed-in user. */
  loadAll(): Promise<AppData>;
  /** Persist one change. Throws if it couldn't be saved (the store will retry). */
  apply(op: Op): Promise<void>;
  /** Delete every plan, goal, task, log and review. Settings (name, time zone, hours) are kept. */
  wipeAll(): Promise<void>;
}

export class SaveError extends Error {
  /** True when retrying can help (network down); false for a rejected change. */
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}
