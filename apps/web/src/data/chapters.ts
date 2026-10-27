import { addDays, daysBetween, isTally, seasonArc, seasonChapters, shortDate, tallyText, weekStart, type Chapter, type Goal, type GoalResult, type ISODate, type Plan, type Review } from '@six/core';
import type { View } from './derive.ts';
import type { AppData } from './model.ts';
import { firstCheckpoint, goalTrack } from './season.ts';
import { tallyFor } from './tally.ts';

/**
 * The season header's two layers under the chapter strip: the week ribbon (how each week went,
 * from the weekly reviews) and the chapter panel (what's due in a stretch, or how it went).
 */

export type WeekResult = 'hit' | 'part' | 'miss' | 'none';

export interface WeekCell {
  n: number;
  monday: ISODate;
  sunday: ISODate;
  /** none = no review saved (or not yet). */
  result: WeekResult;
  current: boolean;
  future: boolean;
  /** A month or 3-month review closed in this week. */
  reviewed: boolean;
  goals: { goal: Goal; note: string; result: GoalResult }[];
  change: string;
}

function rollUp(results: GoalResult[]): WeekResult {
  if (!results.length) return 'none';
  if (results.every((r) => r === 'hit')) return 'hit';
  if (results.some((r) => r === 'hit' || r === 'partly')) return 'part';
  return 'miss';
}

/** One cell per calendar week the season touches, Monday to Sunday. */
export function weekRecord(data: AppData, plan: Plan, today: ISODate): WeekCell[] {
  const first = weekStart(plan.start_date);
  const last = weekStart(plan.end_date);
  const thisMonday = weekStart(today);
  const cells: WeekCell[] = [];
  for (let m = first, n = 1; m <= last; m = addDays(m, 7), n++) {
    const sunday = addDays(m, 6);
    const review = data.reviews.find((r) => r.kind === 'weekly' && r.status === 'done' && r.period_start === m);
    const goals = (review?.goal_results ?? [])
      .filter((g) => g.level === 'week')
      .map((g) => ({ goal: data.goals.find((x) => x.id === g.goal_id), note: g.note, result: g.result }))
      .filter((g): g is { goal: Goal; note: string; result: GoalResult } => !!g.goal);
    const reviewed = data.reviews.some((r: Review) => r.kind !== 'weekly' && r.status === 'done' && r.period_end >= m && r.period_end <= sunday && (!r.plan_id || r.plan_id === plan.id));
    cells.push({ n, monday: m, sunday, result: review ? rollUp(goals.map((g) => g.result)) : 'none', current: m === thisMonday, future: m > thisMonday, reviewed, goals, change: review?.change_next?.trim() ?? '' });
  }
  return cells;
}

/** "4 of 6 weeks hit · best run 2" over the weeks that have a review. */
export function weekTotals(cells: WeekCell[]): { hit: number; reviewed: number; bestRun: number } {
  let hit = 0;
  let reviewed = 0;
  let run = 0;
  let best = 0;
  for (const c of cells) {
    if (c.result === 'none') {
      run = 0;
      continue;
    }
    reviewed++;
    if (c.result === 'hit') {
      hit++;
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  return { hit, reviewed, bestRun: best };
}

export interface DueItem {
  key: string;
  date: ISODate;
  color: string;
  title: string;
  status: string;
  tone: 'ok' | 'warn' | 'plain';
  strong?: boolean;
  /** Where tapping it goes. */
  to: string;
}

export interface ChapterView {
  chapter: Chapter;
  index: number;
  state: 'past' | 'now' | 'future';
  /** "week 5 of 11" inside the chapter. */
  weekIn: number;
  weeks: number;
  line: string;
  due: DueItem[];
  /** For a past chapter: how it went. */
  went: string;
  /** Goals on pace in the season, judged today. */
  onPace: { on: number; of: number };
}

/** The panel for one chapter: dates to hit, goals finishing, the checkpoint and the retrospective that fall inside it. */
export function chapterView(view: View, data: AppData, plan: Plan, index: number, today: ISODate): ChapterView | null {
  const chapters = seasonChapters(plan);
  const chapter = chapters[index];
  if (!chapter) return null;
  const state = today > chapter.end ? 'past' : today < chapter.start ? 'future' : 'now';
  const days = daysBetween(chapter.start, chapter.end) + 1;
  const weeks = Math.max(1, Math.ceil(days / 7));
  const weekIn = state === 'now' ? Math.min(weeks, Math.floor(daysBetween(chapter.start, today) / 7) + 1) : state === 'past' ? weeks : 0;
  // The coaching line for that part of the season: today's when it's the current one, else the line its middle day would get.
  const mid = addDays(chapter.start, Math.floor(days / 2));
  const line = seasonArc(plan, state === 'now' ? today : mid).line;

  const goals = view.goalsForPlan(plan.id).filter((g) => !g.archived_at);
  const due: DueItem[] = [];
  for (const g of goals) {
    for (const m of view.milestonesOf(g.id)) {
      if (m.due_date < chapter.start || m.due_date > chapter.end) continue;
      const t = isTally(m) ? tallyFor(view, m, today) : null;
      let status = '';
      let tone: DueItem['tone'] = 'plain';
      if (m.completed_at) {
        status = 'done';
        tone = 'ok';
      } else if (t) {
        status = tallyText(t);
        tone = t.label === 'behind' ? 'warn' : 'plain';
      } else if (m.due_date < today) {
        status = 'past due';
        tone = 'warn';
      } else {
        const d = daysBetween(today, m.due_date);
        status = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
      }
      due.push({ key: `m:${m.id}`, date: m.due_date, color: g.color, title: m.title, status, tone, to: `/goals/${g.id}` });
    }
    const end = view.endFor(g, plan);
    if (end !== plan.end_date && end >= chapter.start && end <= chapter.end) {
      const t = goalTrack(view, g, plan);
      due.push({ key: `f:${g.id}`, date: end, color: g.color, title: `${g.title} · finish`, status: g.completed_at ? 'done' : t.status.toLowerCase(), tone: g.completed_at ? 'ok' : t.label === 'behind' ? 'warn' : 'plain', to: `/goals/${g.id}` });
    }
  }
  const cp = firstCheckpoint(plan);
  if (cp >= chapter.start && cp <= chapter.end) {
    const done = data.reviews.some((r) => r.kind === 'quarter' && r.status === 'done' && (!r.plan_id || r.plan_id === plan.id) && r.period_end === cp);
    due.push({ key: 'cp', date: cp, color: 'var(--ink)', title: '3-month checkpoint', status: done ? 'done' : 'keep · adjust · drop', tone: done ? 'ok' : 'plain', strong: true, to: '/review' });
  }
  if (plan.end_date >= chapter.start && plan.end_date <= chapter.end) {
    const done = data.reviews.some((r) => r.kind === 'retro' && r.status === 'done' && (!r.plan_id || r.plan_id === plan.id));
    due.push({ key: 'retro', date: plan.end_date, color: 'var(--ink)', title: 'Retrospective', status: done ? 'done' : 'then vs now', tone: done ? 'ok' : 'plain', strong: true, to: '/review' });
  }
  due.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const tracks = goals.filter((g) => !g.completed_at).map((g) => goalTrack(view, g, plan)).filter((t) => t.started && t.label !== 'none');
  const onPace = { on: tracks.filter((t) => t.label !== 'behind').length, of: tracks.length };

  let went = '';
  if (state === 'past') {
    const cells = weekRecord(data, plan, today).filter((c) => c.sunday >= chapter.start && c.monday <= chapter.end && c.result !== 'none');
    const hit = cells.filter((c) => c.result === 'hit').length;
    const dates = due.filter((d) => d.key.startsWith('m:'));
    const datesDone = dates.filter((d) => d.status === 'done').length;
    went = [cells.length ? `${hit} of ${cells.length} weeks hit` : 'no weekly reviews', dates.length ? `${datesDone} of ${dates.length} dates hit` : ''].filter(Boolean).join(' · ');
  }
  return { chapter, index, state, weekIn, weeks, line, due, went, onPace };
}

/** "Oct 30 → Jan 14" */
export function chapterSpan(c: Chapter): string {
  return `${shortDate(c.start)} → ${shortDate(c.end)}`;
}
