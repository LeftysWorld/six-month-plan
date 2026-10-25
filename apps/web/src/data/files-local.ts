import type { FileStore } from './db.ts';

/** Demo mode keeps attachment files in this browser (IndexedDB), not in localStorage. */
const DB_NAME = 'six.files';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('This browser blocked file storage'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error ?? new Error('File storage failed'));
  });
}

const urls = new Map<string, string>();

export function createLocalFiles(): FileStore & { clear(): Promise<void> } {
  return {
    async upload(id, name, file) {
      const path = `demo/${id}/${name}`;
      await run('readwrite', (s) => s.put(file, path));
      return path;
    },
    async url(path) {
      const cached = urls.get(path);
      if (cached) return cached;
      const blob = (await run<Blob>('readonly', (s) => s.get(path) as IDBRequest<Blob>)) ?? null;
      if (!blob) throw new Error('This file is no longer in this browser');
      const url = URL.createObjectURL(blob);
      urls.set(path, url);
      return url;
    },
    async remove(paths) {
      await run('readwrite', (s) => {
        for (const p of paths) s.delete(p);
      });
      for (const p of paths) {
        const u = urls.get(p);
        if (u) URL.revokeObjectURL(u);
        urls.delete(p);
      }
    },
    async clear() {
      await run('readwrite', (s) => {
        s.clear();
      });
    },
  };
}
