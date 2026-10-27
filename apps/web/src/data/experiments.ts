import { addDays, minutesDone, type ISODate, type Path, type PathExperiment, type PathGauges, type Plan } from '@six/core';
import type { AppData, Op } from './model.ts';
import type { View } from './derive.ts';
import { actionLookup } from './insights.ts';
import { opsAnswerQuestion } from './paths.ts';
import { pathsOf } from './paths.ts';

/**
 * Path experiments: a small, dated thing that answers one of a path's questions. They sit between
 * a question (too abstract to act on) and a goal (too big to try): "call one glamping owner and
 * ask what they sold for, by Nov 20". Due on Today like any date; finishing one writes what you
 * learned, and the answer lands on the question.
 */

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();

export function experimentsOf(data: AppData, pathId?: string): PathExperiment[] {
  return data.experiments.filter((e) => !pathId || e.path_id === pathId).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.created_at < b.created_at ? -1 : 1));
}

export function opsAddExperiment(pathId: string, title: string, dueDate: ISODate, questionId: string | null, note = ''): { ops: Op[]; id: string } {
  const id = newId();
  const row: PathExperiment = { id, path_id: pathId, question_id: questionId, title: title.trim(), due_date: dueDate, note: note.trim(), result: '', completed_at: null, created_at: nowISO() };
  return { ops: [{ kind: 'insert', collection: 'experiments', rows: [row as unknown as { id: string } & Record<string, unknown>] }], id };
}

export function opsUpdateExperiment(e: PathExperiment, patch: Partial<Pick<PathExperiment, 'title' | 'due_date' | 'note' | 'question_id' | 'result' | 'completed_at'>>): Op[] {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if ((e as unknown as Record<string, unknown>)[k] !== v) clean[k] = v;
  return Object.keys(clean).length ? [{ kind: 'update', collection: 'experiments', id: e.id, patch: clean }] : [];
}

export function opsDeleteExperiment(e: PathExperiment): Op[] {
  return [{ kind: 'delete', collection: 'experiments', id: e.id }];
}

export function opsRestoreExperiment(e: PathExperiment): Op[] {
  return [{ kind: 'insert', collection: 'experiments', rows: [e as unknown as { id: string } & Record<string, unknown>] }];
}

/**
 * Finish an experiment with what you learned. The result also becomes the answer on its question
 * (appended if the question already has one), so the path learns without a second step.
 */
export function opsFinishExperiment(data: AppData, e: PathExperiment, result: string, today: ISODate): Op[] {
  const ops: Op[] = [{ kind: 'update', collection: 'experiments', id: e.id, patch: { result: result.trim(), completed_at: `${today}T12:00:00.000Z` } }];
  const path = data.paths.find((p) => p.id === e.path_id);
  const q = path?.questions.find((x) => x.id === e.question_id);
  if (path && q && result.trim()) {
    const answer = q.answer.trim() ? `${q.answer.trim()}\n${result.trim()}` : result.trim();
    ops.push(...opsAnswerQuestion(path, q.id, answer, today));
  }
  return ops;
}

export function opsReopenExperiment(e: PathExperiment): Op[] {
  return [{ kind: 'update', collection: 'experiments', id: e.id, patch: { completed_at: null } }];
}

// ---------- Time per path ----------

export interface PathTime {
  path: Path | null;
  minutes: number;
  share: number;
}

/** Minutes logged per path in a date range; `null` path = goals on no path. Sorted biggest first. */
export function timeByPath(data: AppData, range: { start: ISODate; end: ISODate }): { rows: PathTime[]; total: number } {
  const lookup = actionLookup(data);
  const goalPath = new Map(data.goals.map((g) => [g.id, g.path_id ?? null]));
  const actionPaths = new Map<string, Set<string | null>>();
  for (const ag of data.actionGoals) {
    const set = actionPaths.get(ag.action_id) ?? new Set();
    set.add(goalPath.get(ag.goal_id) ?? null);
    actionPaths.set(ag.action_id, set);
  }
  const minutes = new Map<string | null, number>();
  for (const s of data.sessions) {
    if (!s.action_id || s.status === 'planned' || s.status === 'moved' || s.status === 'skipped') continue;
    const day = s.date ?? s.week_start;
    if (day < range.start || day > range.end) continue;
    const m = minutesDone(s, lookup(s.action_id));
    if (!m) continue;
    const paths = actionPaths.get(s.action_id);
    if (!paths || paths.size === 0) continue; // habits: not a path's time
    // A task shared by goals on two paths splits its minutes.
    for (const p of paths) minutes.set(p, (minutes.get(p) ?? 0) + m / paths.size);
  }
  const total = [...minutes.values()].reduce((a, b) => a + b, 0);
  const rows = [...minutes.entries()]
    .map(([id, m]) => ({ path: id ? pathsOf(data).find((p) => p.id === id) ?? null : null, minutes: Math.round(m), share: total ? m / total : 0 }))
    .sort((a, b) => b.minutes - a.minutes);
  return { rows, total: Math.round(total) };
}

// ---------- The path report (each quarter, and whenever you look) ----------

export interface PathReport {
  path: Path;
  /** Gauge averages over time, oldest first. */
  gaugeTrend: { on: ISODate; avg: number | null; gauges: Partial<PathGauges> }[];
  /** Which gauges moved between the first and last rating, and by how much. */
  moved: { key: keyof PathGauges; from: number; to: number }[];
  questionsAnswered: number;
  questionsOpen: number;
  experimentsDone: number;
  experimentsOpen: number;
  goalsFinished: number;
  goalsRunning: number;
  minutes: number;
  /** Share of all logged path time in the range. */
  share: number;
  /** One or two plain sentences. */
  summary: string;
}

const GAUGE_KEYS: (keyof PathGauges)[] = ['resources', 'likability', 'confidence', 'coherence'];

export function pathReport(data: AppData, view: View, path: Path, range: { start: ISODate; end: ISODate }): PathReport {
  const avg = (g: Partial<PathGauges>) => {
    const vals = GAUGE_KEYS.map((k) => g[k]).filter((v): v is number => typeof v === 'number');
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  };
  const log = [...path.gauge_log].sort((a, b) => (a.on < b.on ? -1 : 1));
  const gaugeTrend = log.map((e) => ({ on: e.on, avg: avg(e.gauges), gauges: e.gauges }));
  const first = log[0]?.gauges ?? {};
  const last = log.at(-1)?.gauges ?? path.gauges;
  const moved = GAUGE_KEYS.flatMap((k) => (typeof first[k] === 'number' && typeof last[k] === 'number' && first[k] !== last[k] ? [{ key: k, from: first[k]!, to: last[k]! }] : []));
  const exps = experimentsOf(data, path.id);
  const goals = data.goals.filter((g) => g.path_id === path.id && !g.archived_at);
  const time = timeByPath(data, range);
  const mine = time.rows.find((r) => r.path?.id === path.id);
  const minutes = mine?.minutes ?? 0;
  const share = mine?.share ?? 0;
  const hours = Math.round(minutes / 60);
  const parts: string[] = [];
  parts.push(`${hours} hour${hours === 1 ? '' : 's'} went to this path${time.total ? ` (${Math.round(share * 100)}% of your goal time)` : ''}.`);
  if (moved.length) parts.push(`Since the first rating: ${moved.map((m) => `${m.key} ${m.from} → ${m.to}`).join(', ')}.`);
  else if (log.length > 1) parts.push('The gauges have not moved.');
  const qa = path.questions.filter((q) => q.answered_at).length;
  if (path.questions.length) parts.push(`${qa} of ${path.questions.length} question${path.questions.length === 1 ? '' : 's'} answered${exps.length ? `, ${exps.filter((e) => e.completed_at).length} of ${exps.length} experiment${exps.length === 1 ? '' : 's'} done` : ''}.`);
  return {
    path,
    gaugeTrend,
    moved,
    questionsAnswered: qa,
    questionsOpen: path.questions.length - qa,
    experimentsDone: exps.filter((e) => e.completed_at).length,
    experimentsOpen: exps.filter((e) => !e.completed_at).length,
    goalsFinished: goals.filter((g) => g.completed_at).length,
    goalsRunning: goals.filter((g) => !g.completed_at).length,
    minutes,
    share,
    summary: parts.join(' '),
  };
}

/** The range a report covers: the season so far (or the last 90 days without one). */
export function reportRange(plan: Plan | null, today: ISODate): { start: ISODate; end: ISODate } {
  return plan ? { start: plan.start_date, end: today < plan.end_date ? today : plan.end_date } : { start: addDays(today, -90), end: today };
}
