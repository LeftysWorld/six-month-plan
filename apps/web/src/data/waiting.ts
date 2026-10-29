import { daysBetween, type Goal, type GoalGroup, type GoalIdea, type ISODate, type Milestone } from '@six/core';
import type { AppData, Op } from './model.ts';

/**
 * "Waiting on": an idea (or a whole group) that can't really start until something else is done.
 * The glamping site waits on landing the AI job. It's a condition, not a date: nothing is scheduled
 * from it. The idea is held in the backlog ("Waiting · 6 weeks"), can't be made a goal without "Start
 * anyway" and a reason, shows on the Timeline as a dashed lane after what it waits on, and when that
 * goal (or the milestone picked, like "Offer signed") is done, Today asks whether to prepare it.
 *
 * A group can wait too ("Camp waits on AI"): the keystone is still one goal or milestone, so it
 * fires when the job lands, not months later when the certificates are done.
 */

type Waits = { waits_on_goal_id?: string | null; waits_on_milestone_id?: string | null; waiting_since?: string | null };

export interface WaitInfo {
  goal: Goal;
  milestone: Milestone | null;
  /** "Land an AI product owner role", or "Offer signed (Land an AI product owner role)". */
  label: string;
  /** The goal's group, for "Camp waits on AI". */
  group: GoalGroup | null;
  met: boolean;
  /** When it was met (the goal's or milestone's completion), for the prompt. */
  metAt: string | null;
  since: string | null;
  /** Whole weeks waiting so far. */
  weeks: number;
  /** When what it waits on is due, if it has a date (a milestone's date, else the goal's target). */
  due: ISODate | null;
}

export function waitOf(data: AppData, item: Waits, today: ISODate): WaitInfo | null {
  const milestone = item.waits_on_milestone_id ? data.milestones.find((m) => m.id === item.waits_on_milestone_id) ?? null : null;
  const goal = data.goals.find((g) => g.id === (milestone?.goal_id ?? item.waits_on_goal_id));
  if (!goal) return null;
  const since = item.waiting_since ?? null;
  const met = milestone ? !!milestone.completed_at : !!goal.completed_at;
  return {
    goal,
    milestone,
    label: milestone ? `${milestone.title} (${goal.title})` : goal.title,
    group: goal.group_id ? data.groups.find((x) => x.id === goal.group_id) ?? null : null,
    met,
    metAt: met ? (milestone ? milestone.completed_at : goal.completed_at) ?? null : null,
    since,
    weeks: since ? Math.max(0, Math.floor(daysBetween(since.slice(0, 10), today) / 7)) : 0,
    due: milestone?.due_date ?? goal.target_date ?? null,
  };
}

/** What an idea waits on: its own wait, else its group's ("Buy land" waits because Glamping Site does). */
export function ideaWait(data: AppData, idea: GoalIdea, today: ISODate): WaitInfo | null {
  const own = waitOf(data, idea, today);
  if (own) return own;
  const group = idea.group_id ? data.groups.find((g) => g.id === idea.group_id) : undefined;
  return group ? waitOf(data, group, today) : null;
}

export type Waiter = { kind: 'idea'; idea: GoalIdea; title: string; id: string; info: WaitInfo } | { kind: 'group'; group: GoalGroup; title: string; id: string; info: WaitInfo };

/** Everything waiting on something: ideas still in the backlog, and groups. */
export function waiters(data: AppData, today: ISODate): Waiter[] {
  const out: Waiter[] = [];
  for (const idea of data.ideas) {
    if (idea.status !== 'backlog') continue;
    const info = waitOf(data, idea, today);
    if (info) out.push({ kind: 'idea', idea, title: idea.title, id: idea.id, info });
  }
  for (const group of data.groups) {
    const info = waitOf(data, group, today);
    if (info) out.push({ kind: 'group', group, title: group.name, id: group.id, info });
  }
  return out;
}

/** "Waiting · 6 weeks on Land an AI product owner role" (or "Ready: … is done"). */
export function waitText(info: WaitInfo): string {
  if (info.met) return `Ready: ${info.label} is done`;
  return `Waiting${info.weeks > 0 ? ` · ${info.weeks} week${info.weeks === 1 ? '' : 's'}` : ''} on ${info.label}`;
}

/** What an idea or group can wait on: goals still open, and their open milestones. A group can't wait on its own goals. */
export function waitChoices(data: AppData, exceptGroupId?: string): { goal: Goal; milestones: Milestone[] }[] {
  return data.goals
    .filter((g) => !g.archived_at && !g.completed_at && (!exceptGroupId || g.group_id !== exceptGroupId))
    .map((goal) => ({ goal, milestones: data.milestones.filter((m) => m.goal_id === goal.id && !m.completed_at).sort((a, b) => (a.due_date < b.due_date ? -1 : 1)) }));
}

/** "goal:<id>", "ms:<id>" or "" — one value for a select. */
export function waitValue(item: Waits): string {
  return item.waits_on_milestone_id ? `ms:${item.waits_on_milestone_id}` : item.waits_on_goal_id ? `goal:${item.waits_on_goal_id}` : '';
}

/**
 * Set (or clear, with "") what an idea or group waits on. Waiting since keeps its date when it
 * already waited on the same thing; a new wait starts today.
 */
export function opsSetWaiting(collection: 'ideas' | 'groups', item: { id: string } & Waits, value: string, now = new Date().toISOString()): Op[] {
  if (value === waitValue(item)) return [];
  const [kind, id] = value.split(':') as ['goal' | 'ms' | '', string | undefined];
  const patch =
    kind === 'goal' && id
      ? { waits_on_goal_id: id, waits_on_milestone_id: null, waiting_since: now }
      : kind === 'ms' && id
        ? { waits_on_goal_id: null, waits_on_milestone_id: id, waiting_since: now }
        : { waits_on_goal_id: null, waits_on_milestone_id: null, waiting_since: null };
  return [{ kind: 'update', collection, id: item.id, patch }];
}

/**
 * Start a waiting idea anyway: the wait comes off, and the reason goes on the idea's note
 * ("Started before Land an AI product owner role was done: found financing."), so the choice is on record.
 */
export function opsStartAnyway(idea: GoalIdea, info: WaitInfo, reason: string): Op[] {
  const line = `Started before ${info.label} was done${reason.trim() ? `: ${reason.trim().replace(/\.$/, '')}` : ''}.`;
  return [
    {
      kind: 'update',
      collection: 'ideas',
      id: idea.id,
      patch: { waits_on_goal_id: null, waits_on_milestone_id: null, waiting_since: null, note: [idea.note.trim(), line].filter(Boolean).join(' ') },
    },
  ];
}
