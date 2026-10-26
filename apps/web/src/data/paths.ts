import { GAUGE_KEYS, minutesDone, type Goal, type GoalIdea, type ISODate, type PaceLabel, type Path, type PathGauges } from '@six/core';
import type { AppData, Op } from './model.ts';
import type { View } from './derive.ts';
import { actionLookup } from './insights.ts';
import { goalTrack } from './season.ts';

/**
 * Odyssey paths (Designing Your Life): three five-year lives, sketched year by year, rated on four
 * gauges, each with the questions a prototype would answer. A season's goals are the prototypes;
 * because goals and ideas point at a path, a path's progress is rolled up from real work.
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;
const row = (p: Path) => [p as unknown as Row];

export const PATH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const PATH_COLORS = ['#5B8CFF', '#22B07D', '#FF7A45', '#8B6CF6', '#E8559B', '#3FB6C9'];

export const GAUGE_NAME: Record<keyof PathGauges, string> = { resources: 'Resources', likability: 'Likability', confidence: 'Confidence', coherence: 'Coherence' };
export const GAUGE_HINT: Record<keyof PathGauges, string> = {
  resources: 'Time, money, skill, contacts: do you have what this life needs?',
  likability: 'How much do you like this version of your life?',
  confidence: 'How sure are you that you could pull it off?',
  coherence: 'Does it fit who you are and what you believe?',
};

/** Live paths, A first. */
export function pathsOf(data: AppData): Path[] {
  return data.paths.filter((p) => !p.archived_at).sort((a, b) => a.rank - b.rank || (a.created_at < b.created_at ? -1 : 1));
}

/** "Plan A", "Plan B"… from a path's place in the list. */
export function pathLetter(data: AppData, path: Path): string {
  const i = pathsOf(data).findIndex((p) => p.id === path.id);
  return `Plan ${PATH_LETTERS[i] ?? String(i + 1)}`;
}

export function blankPath(data: AppData, today: ISODate): Path {
  const n = pathsOf(data).length;
  return {
    id: newId(),
    name: '',
    headline: '',
    why: '',
    color: PATH_COLORS[n % PATH_COLORS.length]!,
    rank: n,
    horizon_years: 5,
    years: ['', '', '', '', ''],
    gauges: {},
    gauge_log: [],
    questions: [],
    notes: [],
    archived_at: null,
    created_at: `${today}T12:00:00.000Z`,
  };
}

export function opsCreatePath(path: Path): Op[] {
  return [{ kind: 'insert', collection: 'paths', rows: row(path) }];
}

export function opsUpdatePath(path: Path, patch: Partial<Path>): Op[] {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify((path as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) clean[k] = v;
  }
  return Object.keys(clean).length ? [{ kind: 'update', collection: 'paths', id: path.id, patch: clean }] : [];
}

/** Rate the gauges (the 3-month checkpoint asks). The previous rating is kept in the log. */
export function opsRatePath(path: Path, gauges: Partial<PathGauges>, today: ISODate): Op[] {
  const same = GAUGE_KEYS.every((k) => (path.gauges[k] ?? null) === (gauges[k] ?? null));
  if (same) return [];
  const log = [...path.gauge_log.filter((e) => e.on !== today), { on: today, gauges }];
  return [{ kind: 'update', collection: 'paths', id: path.id, patch: { gauges, gauge_log: log } }];
}

/** Write down what a season taught you about this path (the retrospective asks). */
export function opsNotePath(path: Path, text: string, on: ISODate): Op[] {
  const t = text.trim();
  if (!t) return [];
  return [{ kind: 'update', collection: 'paths', id: path.id, patch: { notes: [...path.notes.filter((n) => n.on !== on), { on, text: t }] } }];
}

export function opsAddQuestion(path: Path, text: string): Op[] {
  const t = text.trim();
  if (!t) return [];
  return [{ kind: 'update', collection: 'paths', id: path.id, patch: { questions: [...path.questions, { id: newId(), text: t, answer: '', answered_at: null }] } }];
}

export function opsAnswerQuestion(path: Path, questionId: string, answer: string, today: ISODate): Op[] {
  const a = answer.trim();
  return [{ kind: 'update', collection: 'paths', id: path.id, patch: { questions: path.questions.map((q) => (q.id === questionId ? { ...q, answer: a, answered_at: a ? `${today}T12:00:00.000Z` : null } : q)) } }];
}

export function opsRemoveQuestion(path: Path, questionId: string): Op[] {
  return [{ kind: 'update', collection: 'paths', id: path.id, patch: { questions: path.questions.filter((q) => q.id !== questionId) } }];
}

/** Put a goal or an idea on a path (or take it off one). */
export function opsSetGoalPath(goal: Goal, pathId: string | null): Op[] {
  return (goal.path_id ?? null) === pathId ? [] : [{ kind: 'update', collection: 'goals', id: goal.id, patch: { path_id: pathId } }];
}
export function opsSetIdeaPath(idea: GoalIdea, pathId: string | null): Op[] {
  return (idea.path_id ?? null) === pathId ? [] : [{ kind: 'update', collection: 'ideas', id: idea.id, patch: { path_id: pathId } }];
}

export function opsArchivePath(data: AppData, path: Path, archived: boolean): Op[] {
  const ops: Op[] = [{ kind: 'update', collection: 'paths', id: path.id, patch: { archived_at: archived ? new Date().toISOString() : null } }];
  // Its goals and ideas aren't deleted; they just stop pointing at a path you've let go of.
  if (archived) {
    for (const g of data.goals.filter((x) => x.path_id === path.id)) ops.push({ kind: 'update', collection: 'goals', id: g.id, patch: { path_id: null } });
    for (const i of data.ideas.filter((x) => x.path_id === path.id)) ops.push({ kind: 'update', collection: 'ideas', id: i.id, patch: { path_id: null } });
  }
  return ops;
}

/** Undo for letting a path go: the path comes back and its goals and ideas point at it again. */
export function opsRestorePath(path: Path, goals: Goal[], ideas: GoalIdea[]): Op[] {
  return [
    { kind: 'update', collection: 'paths', id: path.id, patch: { archived_at: null } },
    ...goals.map((g): Op => ({ kind: 'update', collection: 'goals', id: g.id, patch: { path_id: path.id } })),
    ...ideas.map((i): Op => ({ kind: 'update', collection: 'ideas', id: i.id, patch: { path_id: path.id } })),
  ];
}

export function opsMovePath(data: AppData, path: Path, dir: 'up' | 'down'): Op[] {
  const list = pathsOf(data);
  const i = list.findIndex((p) => p.id === path.id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const other = list[j]!;
  return [
    { kind: 'update', collection: 'paths', id: path.id, patch: { rank: j } },
    { kind: 'update', collection: 'paths', id: other.id, patch: { rank: i } },
  ];
}

// ---------- Progress, rolled up from real work ----------

export interface PathProgress {
  /** Goals on this path, finished ones included (archived ones not). */
  goals: Goal[];
  finished: number;
  running: number;
  /** Of the running goals that can be judged, how many are on pace or ahead. */
  onPace: number;
  judged: number;
  label: PaceLabel;
  /** Minutes logged on this path's goals, all time. */
  minutes: number;
  /** Distinct days with something logged on this path. */
  days: number;
  /** Ideas waiting in the backlog for this path. */
  waiting: GoalIdea[];
  questionsOpen: number;
  questionsAnswered: number;
  /** Share of the path's goals done, finished goals fully, running ones by their track (0–100). */
  prog: number;
}

export function pathProgress(view: View, path: Path): PathProgress {
  const data = view.data;
  const goals = data.goals.filter((g) => g.path_id === path.id && !g.archived_at);
  const finished = goals.filter((g) => g.completed_at).length;
  const running = goals.filter((g) => !g.completed_at);
  const lookup = actionLookup(data);
  const actionIds = new Set(data.actionGoals.filter((ag) => goals.some((g) => g.id === ag.goal_id)).map((ag) => ag.action_id));
  const logged = data.sessions.filter((s) => s.action_id && actionIds.has(s.action_id) && s.status !== 'planned' && s.status !== 'moved' && s.status !== 'skipped');
  const minutes = logged.reduce((sum, s) => sum + minutesDone(s, lookup(s.action_id)), 0);
  const days = new Set(logged.map((s) => s.date ?? s.week_start)).size;
  let onPace = 0;
  let judged = 0;
  let progSum = finished * 100;
  for (const g of running) {
    const plan = view.planForGoal(g);
    if (!plan) continue;
    const t = goalTrack(view, g, plan);
    progSum += t.prog;
    if (t.started && t.label !== 'none') {
      judged += 1;
      if (t.label === 'on_track' || t.label === 'ahead') onPace += 1;
    }
  }
  const label: PaceLabel = judged === 0 ? 'none' : onPace / judged >= 0.67 ? 'on_track' : onPace === 0 ? 'behind' : 'on_track';
  const waiting = data.ideas.filter((i) => i.path_id === path.id && i.status === 'backlog').sort((a, b) => a.rank - b.rank);
  return {
    goals,
    finished,
    running: running.length,
    onPace,
    judged,
    label,
    minutes,
    days,
    waiting,
    questionsOpen: path.questions.filter((q) => !q.answered_at).length,
    questionsAnswered: path.questions.filter((q) => q.answered_at).length,
    prog: goals.length ? Math.round(progSum / goals.length) : 0,
  };
}

/** Average of the gauges that are set, or null. */
export function gaugeAverage(g: Partial<PathGauges>): number | null {
  const vals = GAUGE_KEYS.map((k) => g[k]).filter((v): v is number => typeof v === 'number');
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}
