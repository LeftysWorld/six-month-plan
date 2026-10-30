/**
 * What an exercise or a stretch looks like: a picture or a video you can open from the workout or
 * stretching log without leaving the app.
 *
 * Three sources, in order:
 * - what you chose for it (a library exercise, a video link, or your own photo or video), kept on
 *   the exercise in the task's plan;
 * - otherwise the closest match in the exercise library (free-exercise-db, public domain: about 870
 *   exercises, each with a start and an end photo and step-by-step instructions);
 * - otherwise nothing yet, with ways to add one.
 */

export type ExerciseDemo =
  | { kind: 'library'; id: string }
  | { kind: 'video'; url: string }
  | { kind: 'file'; path: string; mime: string; name: string };

/** One exercise in the library (the trimmed form the app ships). */
export interface LibraryExercise {
  id: string;
  name: string;
  category: string;
  equipment: string | null;
  muscles: string[];
  instructions: string[];
  /** Image paths under the library's exercises folder ("Barbell_Squat/0.jpg"). */
  images: string[];
}

/** Where the library's photos are served from. */
export const LIBRARY_IMAGE_BASE = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bdbs?\b/g, 'dumbbell'],
  [/\bbbs?\b/g, 'barbell'],
  [/\bkbs?\b/g, 'kettlebell'],
  [/\bohp\b/g, 'overhead press'],
  [/\brdls?\b/g, 'romanian deadlift'],
  [/\bsldl\b/g, 'stiff leg deadlift'],
  [/\bbw\b/g, 'bodyweight'],
  [/\bez\b/g, 'ez bar'],
  [/\bpull[\s-]?ups?\b/g, 'pullup'],
  [/\bchin[\s-]?ups?\b/g, 'chinup'],
  [/\bpush[\s-]?ups?\b/g, 'pushup'],
  [/\bsit[\s-]?ups?\b/g, 'situp'],
  [/\bstep[\s-]?ups?\b/g, 'stepup'],
  [/\bpull[\s-]?downs?\b/g, 'pulldown'],
  [/\bflyes\b/g, 'fly'],
  [/\bflies\b/g, 'fly'],
  [/\btri(cep)?s?\b/g, 'triceps'],
  [/\bbi(cep)?s?\b/g, 'biceps'],
  [/\bdelts?\b/g, 'deltoid'],
  [/\blats?\b/g, 'lat'],
];

const STOP = new Set(['a', 'an', 'the', 'with', 'on', 'to', 'and', 'of', 'for', 'in', 'into', 'at', 'from', 'left', 'right', 'forward', 'medium', 'grip', 'slow', 'pose']);

/** An exercise name as a set of comparable words: "Flat DB Bench Press (slow)" → dumbbell, bench, press, flat. */
export function exerciseWords(name: string): string[] {
  let s = name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(per|each)\s+(side|leg|arm)\b/g, ' ');
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  const words = s
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

export interface DemoMatch {
  exercise: LibraryExercise;
  /** 0–1. */
  score: number;
  /** Share of the name's words the candidate has, 0–1. */
  covered: number;
}

/**
 * The library exercises closest to a name, best first. Scored on shared words (each word of the name
 * found in the candidate counts; words the candidate adds cost a little), so "Flat DB Bench Press"
 * finds "Dumbbell Bench Press" and "RDL" finds "Romanian Deadlift".
 */
export function matchExercises(name: string, library: LibraryExercise[], limit = 6, kind?: 'stretch' | 'strength'): DemoMatch[] {
  const want = exerciseWords(name);
  if (!want.length) return [];
  const out: DemoMatch[] = [];
  for (const exercise of library) {
    // A stretch is matched against stretches only, a lift against everything else.
    if (kind === 'stretch' && exercise.category !== 'stretching') continue;
    if (kind === 'strength' && exercise.category === 'stretching') continue;
    const have = exerciseWords(exercise.name);
    if (!have.length) continue;
    const shared = want.filter((w) => have.includes(w)).length;
    if (!shared) continue;
    const covered = shared / want.length;
    const extra = (have.length - shared) / have.length;
    const exact = exercise.name.toLowerCase() === name.trim().toLowerCase() ? 0.2 : 0;
    out.push({ exercise, covered, score: Math.min(1, covered * 0.7 + (1 - extra) * 0.3 + exact) });
  }
  return out.sort((a, b) => b.score - a.score || a.exercise.name.length - b.exercise.name.length).slice(0, limit);
}

/**
 * The library picture for a name: confident (most of the name's words found: shown as is), likely
 * (worth showing with "Is this it?"), or none.
 */
export function bestMatch(name: string, library: LibraryExercise[], kind?: 'stretch' | 'strength'): { exercise: LibraryExercise; confident: boolean } | null {
  const best = matchExercises(name, library, 1, kind)[0];
  if (!best || best.score < 0.5) return null;
  return { exercise: best.exercise, confident: best.covered >= 0.75 && best.score >= 0.7 };
}

/** The video id in a YouTube link (watch, youtu.be, shorts, embed), or null. */
export function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url.trim());
  return m ? m[1]! : null;
}

/** The start time in a YouTube link (t=90, t=1m30s), in seconds. */
export function youtubeStart(url: string): number {
  const m = /[?&#]t=(?:(\d+)h)?(?:(\d+)m)?(\d+)?s?/.exec(url);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** How a link can be shown inside the app: a YouTube player, a video, a picture, or only as a link. */
export function linkKind(url: string): 'youtube' | 'video' | 'image' | 'link' {
  if (youtubeId(url)) return 'youtube';
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return 'video';
  if (/\.(gif|jpe?g|png|webp|avif)$/.test(path)) return 'image';
  return 'link';
}

/** A link worth saving: http(s) only. */
export function cleanLink(url: string): string | null {
  const t = url.trim();
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(t)) return null;
  return t;
}
