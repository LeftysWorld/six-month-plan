import { addDays, minutesDone, periodTally, planWeekNumber, projectNumberGoal, seasonArc, shortDate, type DateRange, type Goal, type ISODate, type Plan } from '@six/core';
import type { AppData } from './model.ts';
import { fmt, type View } from './derive.ts';
import { goalTrack } from './season.ts';
import { actionLookup } from './insights.ts';
import { allPrizes, nextValuedPrize } from './prizes.ts';

/**
 * The weekly digest: your week in a few plain lines, built once and used everywhere it is useful:
 * the top of the weekly review, the copy/share button, and the email your accountability partner
 * gets (the app stores the text on the review; supabase/functions/send-digests mails it).
 * It reads like a coach's note, not a dashboard.
 */
export interface Digest {
  title: string;
  lines: string[];
  text: string;
}

/** Hours and minutes as "6h 20m", "45m". */
function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** One line per goal: where it stands, in words a partner can read. */
export function goalLine(view: View, goal: Goal, plan: Plan, week: DateRange): string {
  const t = goalTrack(view, goal, plan);
  if (goal.completed_at) return `${goal.title}: finished ${shortDate(view.dayOf(goal.completed_at))}.`;
  if (!t.started) return `${goal.title}: ${t.status.toLowerCase()}.`;
  if (goal.type === 'number') {
    const readings = view.measurementsFor(goal.measurement_type_id);
    const inWeek = readings.filter((r) => r.measured_on >= week.start && r.measured_on <= week.end);
    const first = inWeek[0];
    const last = inWeek[inWeek.length - 1];
    const change = first && last && first.id !== last.id ? Number(last.value) - Number(first.value) : null;
    const proj = projectNumberGoal(goal, readings, view.today);
    const parts = [`${goal.title}: ${t.now}`];
    if (change != null && Math.abs(change) >= 0.05) parts.push(`${change > 0 ? '+' : '−'}${fmt(Math.abs(change))} this week`);
    parts.push(t.status.toLowerCase());
    if (proj.eta && goal.target_date) parts.push(proj.daysOff != null && proj.daysOff > 7 ? `at this rate you get there ${shortDate(proj.eta)} (${Math.round(proj.daysOff / 7)} wk late)` : `on course for ${shortDate(goal.target_date)}`);
    const next = nextValuedPrize(view, goal);
    if (next?.value != null && t.now !== 'No readings yet') {
      const latest = readings.filter((r) => r.measured_on <= view.today).at(-1);
      if (latest) parts.push(`next prize at ${fmt(next.value)} (${fmt(Math.abs(Number(latest.value) - next.value))} to go)`);
    }
    return parts.join(' · ') + '.';
  }
  return `${goal.title}: ${t.now}, ${t.status.toLowerCase()}.`;
}

/** Build the digest for the week starting `monday` (the week just finished, usually). */
/** `goals` is every goal the review covers (they may sit on different plans); `plan` sets the season line and week number. */
export function weeklyDigest(data: AppData, view: View, plan: Plan, monday: ISODate, goalsIn?: Goal[]): Digest {
  const week = { start: monday, end: addDays(monday, 6) };
  const today = view.today;
  const lookup = actionLookup(data);
  const goals = (goalsIn ?? view.goalsForPlan(plan.id, true)).filter((g) => !g.archived_at && (!g.completed_at || view.dayOf(g.completed_at) >= monday));
  const ids = new Set(goals.map((g) => g.id));
  const actionIds = new Set(data.actionGoals.filter((ag) => ids.has(ag.goal_id)).map((ag) => ag.action_id));
  const sessions = data.sessions.filter((s) => s.action_id && actionIds.has(s.action_id));
  const tally = periodTally(sessions, week, today, lookup);
  const logged = sessions.filter((s) => s.status !== 'planned' && s.status !== 'moved' && s.status !== 'skipped' && (s.date ?? s.week_start) >= week.start && (s.date ?? s.week_start) <= week.end);
  const days = new Set(logged.map((s) => s.date ?? s.week_start)).size;
  const minutes = logged.reduce((sum, s) => sum + minutesDone(s, lookup(s.action_id)), 0);
  const arc = seasonArc(plan, today);
  const weekNo = Math.max(1, Math.min(arc.weeks, planWeekNumber(plan, monday)));

  const lines: string[] = [];
  lines.push(`Showed up ${days} of 7 days · ${tally.credit % 1 ? fmt(tally.credit) : tally.credit} of ${tally.planned} tasks · ${hm(minutes)} put in.`);
  for (const g of goals) lines.push(goalLine(view, g, view.planForGoal(g) ?? plan, week));

  const prizes = allPrizes(data, view, today);
  const earned = prizes.filter((p) => p.doneDay && p.doneDay >= week.start && p.doneDay <= week.end && !p.lost);
  const unclaimed = prizes.filter((p) => (p.status === 'earned' || p.status === 'late') && !p.lost && !p.claimedAt);
  if (earned.length) lines.push(`Prize${earned.length === 1 ? '' : 's'} earned: ${earned.map((p) => p.title).join(', ')}.`);
  if (unclaimed.length) lines.push(`Still not taken: ${unclaimed.map((p) => p.title).join(', ')}.`);

  const nextWeek = { start: addDays(week.end, 1), end: addDays(week.end, 7) };
  const dates = data.milestones.filter((m) => ids.has(m.goal_id) && !m.completed_at && m.due_date >= nextWeek.start && m.due_date <= nextWeek.end).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  if (dates.length) lines.push(`Next week's dates: ${dates.map((m) => `${m.title} (${shortDate(m.due_date)})`).join(', ')}.`);
  lines.push(arc.line);

  const title = `Week ${weekNo} of ${arc.weeks} · ${shortDate(week.start)} – ${shortDate(week.end)}`;
  return { title, lines, text: `${title}\n\n${lines.map((l) => `• ${l}`).join('\n')}` };
}

/** A mailto link that opens the digest addressed to the partner (or to no one, to pick). */
export function digestMailto(digest: Digest, to: string | null | undefined, from: string): string {
  const subject = `${from ? `${from}’s week` : 'My week'}: ${digest.title}`;
  return `mailto:${encodeURIComponent(to ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(digest.text)}`;
}
