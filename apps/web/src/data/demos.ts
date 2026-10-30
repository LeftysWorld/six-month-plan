import { LIBRARY_IMAGE_BASE, type Action, type ExerciseDemo, type LibraryExercise, type PlannedExercise, type StretchPlan } from '@six/core';
import type { AppData, Op } from './model.ts';

/**
 * What an exercise or a stretch looks like. The library (free-exercise-db, public domain) ships as a
 * static file the app fetches the first time a demo is opened; its photos come from a CDN. A choice
 * you make (another library exercise, a video link, your own photo or video) is kept on the exercise
 * in every task's plan that has it by that name, so each workout or stretch day shows the same.
 */

export type DemoKind = 'strength' | 'stretch';

let libraryPromise: Promise<LibraryExercise[]> | null = null;

/** The exercise library, fetched once. */
export function loadLibrary(): Promise<LibraryExercise[]> {
  if (!libraryPromise) {
    libraryPromise = fetch('/exercises.json')
      .then((r) => {
        if (!r.ok) throw new Error(`The exercise library didn't load (${r.status})`);
        return r.json() as Promise<LibraryExercise[]>;
      })
      .catch((e) => {
        libraryPromise = null;
        throw e;
      });
  }
  return libraryPromise;
}

export function libraryImage(path: string): string {
  return `${LIBRARY_IMAGE_BASE}${path}`;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The demo saved for a name, from any task that has the exercise (or hold). */
export function savedDemo(data: AppData, name: string, kind: DemoKind): ExerciseDemo | null {
  for (const a of data.actions) {
    if (kind === 'strength') {
      const e = a.workout_plan?.find((x) => same(x.name, name) && x.demo);
      if (e?.demo) return e.demo;
    } else {
      const h = a.stretch_plan?.holds.find((x) => same(x.name, name) && x.demo);
      if (h?.demo) return h.demo;
    }
  }
  return null;
}

/** Save (or clear) what an exercise looks like on every task that has it by that name. */
export function opsSetDemo(data: AppData, name: string, kind: DemoKind, demo: ExerciseDemo | null): Op[] {
  const ops: Op[] = [];
  for (const a of data.actions as Action[]) {
    if (kind === 'strength' && a.workout_plan?.some((x) => same(x.name, name))) {
      const plan: PlannedExercise[] = a.workout_plan.map((x) => (same(x.name, name) ? { ...x, demo } : x));
      ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { workout_plan: plan } });
    }
    if (kind === 'stretch' && a.stretch_plan?.holds.some((x) => same(x.name, name))) {
      const plan: StretchPlan = { ...a.stretch_plan, holds: a.stretch_plan.holds.map((x) => (same(x.name, name) ? { ...x, demo } : x)) };
      ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { stretch_plan: plan } });
    }
  }
  return ops;
}
