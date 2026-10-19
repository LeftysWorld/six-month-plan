import type { Db } from './db.ts';
import { applyOp, emptyData, type AppData, type Op } from './model.ts';
import { buildDemoData } from './seed.ts';

const KEY = 'six.demo.v1';

function read(): AppData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? ({ ...emptyData(), ...JSON.parse(raw) } as AppData) : null;
  } catch {
    return null;
  }
}

function write(data: AppData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked: demo data simply won't persist
  }
}

/** Demo mode: everything lives in this browser's localStorage. */
export function createLocalDb(): Db {
  return {
    mode: 'demo',
    async loadAll(): Promise<AppData> {
      const existing = read();
      if (existing) return existing;
      const seeded = buildDemoData();
      write(seeded);
      return seeded;
    },
    async apply(op: Op): Promise<void> {
      const current = read() ?? emptyData();
      write(applyOp(current, op));
    },
    async wipeAll(): Promise<void> {
      const current = read() ?? emptyData();
      write({ ...emptyData(), profile: current.profile });
    },
  };
}

/** Replace demo data: a filled-in example, or an empty start. */
export function resetDemo(kind: 'example' | 'empty'): void {
  write(kind === 'example' ? buildDemoData() : emptyData());
}
