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
  [/\brear[\s-]?delts?\b/g, 'reardelt'],
  [/\bback squats?\b/g, 'squat'],
  [/\bflyes\b/g, 'fly'],
  [/\bflies\b/g, 'fly'],
  [/\btri(cep)?s?\b/g, 'triceps'],
  [/\bbi(cep)?s?\b/g, 'biceps'],
  [/\bdelts?\b/g, 'deltoid'],
  [/\blats?\b/g, 'lat'],
];

/** Words that say nothing about which exercise it is. */
const STOP = new Set(['a', 'an', 'the', 'with', 'on', 'to', 'and', 'of', 'for', 'in', 'into', 'at', 'from', 'left', 'right', 'forward', 'medium', 'grip', 'slow', 'pose', 'stretch', 'stretching', 'exercise', 'hold', 'holds', 'variation', 'version', 'per', 'each', 'x', 'flat']);
/** Position words: they tell variants apart (seated or standing) but don't name the exercise. */
const POSITION = new Set(['seated', 'standing', 'lying', 'kneeling', 'side', 'leg', 'legs', 'arm', 'arms', 'single', 'one', 'two', 'alternating', 'alternate', 'supported', 'assisted', 'active', 'passive', 'prone', 'supine', 'bent', 'over']);
/** Equipment words, and the kind of equipment each one means. */
const EQUIPMENT: Record<string, string> = {
  dumbbell: 'dumbbell',
  barbell: 'barbell',
  bar: 'barbell',
  cable: 'cable',
  pulley: 'cable',
  rope: 'cable',
  machine: 'machine',
  smith: 'machine',
  lever: 'machine',
  kettlebell: 'kettlebell',
  band: 'band',
  resistance: 'band',
  ball: 'ball',
  physioball: 'ball',
  bodyweight: 'body',
};
/** The library's equipment field, as the same kinds. */
const LIBRARY_EQUIPMENT: Record<string, string> = {
  dumbbell: 'dumbbell',
  barbell: 'barbell',
  'e-z curl bar': 'barbell',
  cable: 'cable',
  machine: 'machine',
  kettlebells: 'kettlebell',
  bands: 'band',
  'exercise ball': 'ball',
  'medicine ball': 'ball',
  'body only': 'body',
};

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** An exercise name as a set of comparable words: "Flat DB Bench Press (slow)" → flat, dumbbell, bench, press. */
export function exerciseWords(name: string): string[] {
  let s = name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(per|each)\s+(side|leg|arm)\b/g, ' ');
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  const words = s
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
  return [...new Set(words)];
}

interface Parts {
  /** The words that name the exercise. */
  core: string[];
  position: string[];
  /** Kinds of equipment it says (dumbbell, cable…). */
  equipment: string[];
}

function parts(name: string, libraryEquipment?: string | null): Parts {
  const words = exerciseWords(name);
  const equipment = new Set(words.filter((w) => EQUIPMENT[w]).map((w) => EQUIPMENT[w]!));
  const fromField = libraryEquipment ? LIBRARY_EQUIPMENT[libraryEquipment] : undefined;
  if (fromField && fromField !== 'body') equipment.add(fromField);
  return {
    core: words.filter((w) => !EQUIPMENT[w] && !POSITION.has(w)),
    position: words.filter((w) => POSITION.has(w)),
    equipment: [...equipment],
  };
}

export interface DemoMatch {
  exercise: LibraryExercise;
  /** 0–1. */
  score: number;
  /** Share of the name's own words (not position or equipment) the candidate has, 0–1. */
  covered: number;
  /** Same exercise: the same naming words, nothing extra, no clash of equipment or position. */
  exact: boolean;
}

/**
 * Library exercises close to a name, best first. A candidate whose equipment clashes with the name's
 * (a cable version for "DB Rear Delt Fly") is left out; with no equipment in the name, every kind
 * stays in but none counts as the same exercise unless it's the only one.
 */
export function matchExercises(name: string, library: LibraryExercise[], limit = 6, kind?: 'stretch' | 'strength'): DemoMatch[] {
  const want = parts(name);
  if (!want.core.length && !want.position.length) return [];
  const out: DemoMatch[] = [];
  for (const exercise of library) {
    // A stretch is matched against stretches only, a lift against everything else.
    if (kind === 'stretch' && exercise.category !== 'stretching') continue;
    if (kind === 'strength' && exercise.category === 'stretching') continue;
    const have = parts(exercise.name, exercise.equipment);
    if (want.equipment.length && have.equipment.length && !have.equipment.some((e) => want.equipment.includes(e))) continue;
    const shared = want.core.filter((w) => have.core.includes(w)).length;
    if (!shared && want.core.length) continue;
    const covered = want.core.length ? shared / want.core.length : 0;
    const extra = have.core.length ? (have.core.length - shared) / have.core.length : 0;
    const posShared = want.position.filter((w) => have.position.includes(w)).length;
    // Positions on either side that the other doesn't have: "Seated" against a standing version.
    const posClash = have.position.filter((w) => !want.position.includes(w)).length + (want.position.length - posShared);
    const sameKit = !want.equipment.length || have.equipment.some((e) => want.equipment.includes(e));
    const exact = covered === 1 && extra === 0 && posClash === 0 && sameKit;
    const score = covered * 0.6 + (1 - extra) * 0.25 + (want.position.length ? (posShared / want.position.length) * 0.1 : 0.1) - posClash * 0.05 + (exact ? 0.05 : 0);
    out.push({ exercise, score: Math.max(0, Math.min(1, score)), covered, exact });
  }
  return out.sort((a, b) => b.score - a.score || a.exercise.name.length - b.exercise.name.length).slice(0, limit);
}

/**
 * What to show for a name:
 * - sure: the one library exercise that is plainly the same (shown as is);
 * - options: close ones to choose from ("Which one is yours?"), when it isn't plain;
 * - neither: nothing in the library is close.
 * Same naming words but different equipment, and the name doesn't say which: options, not sure.
 */
export function libraryMatch(name: string, library: LibraryExercise[], kind?: 'stretch' | 'strength'): { sure: LibraryExercise | null; options: LibraryExercise[] } {
  const all = matchExercises(name, library, 24, kind);
  const said = parts(name).equipment;
  // A cable or machine setup looks nothing like the dumbbell version: only sure when the name says so.
  const setupOk = (m: DemoMatch) => said.length > 0 || !parts(m.exercise.name, m.exercise.equipment).equipment.some((e) => e === 'cable' || e === 'machine');
  const sure = all.find((m) => m.exact && setupOk(m));
  if (sure) return { sure: sure.exercise, options: [] };
  const want = parts(name);
  const options = all
    .filter((m) => {
      const have = parts(m.exercise.name, m.exercise.equipment);
      if (kind === 'stretch') {
        // A stretch option names nothing the hold doesn't, and has every word of it.
        return m.covered === 1 && have.core.every((w) => want.core.includes(w)) && have.position.every((w) => want.position.includes(w));
      }
      return m.covered >= 0.66;
    })
    .slice(0, 6)
    .map((m) => m.exercise);
  return { sure: null, options };
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
  // An image search proxy (DuckDuckGo's "copy image address"): the picture is in the u= param.
  if (/^https?:\/\/external-content\.duckduckgo\.com\/iu\//i.test(url)) {
    try {
      const inner = new URL(url).searchParams.get('u');
      if (inner) {
        const k = linkKind(inner);
        return k === 'link' ? 'image' : k;
      }
    } catch {
      /* fall through */
    }
    return 'image';
  }
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
