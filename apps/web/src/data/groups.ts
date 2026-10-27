import type { Goal, GoalGroup, ISODate } from '@six/core';
import type { AppData, Op } from './model.ts';

/**
 * Goal groups, like phone folders: drag one goal onto another to make a group and name it,
 * drop a goal on a group to add it, drag it out to take it out. A goal is in one group at most.
 * A group that's left with one goal goes away (that goal is simply on its own again).
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;

/** The live goals in a group (not archived), in the order they're listed. */
export function groupMembers(data: AppData, groupId: string): Goal[] {
  return data.goals.filter((g) => g.group_id === groupId && !g.archived_at);
}

export function groupOf(data: AppData, goal: Goal | undefined): GoalGroup | undefined {
  return goal?.group_id ? data.groups.find((x) => x.id === goal.group_id) : undefined;
}

/** Make a group from two or more goals. Goals already in another group move into this one. */
export function opsCreateGroup(data: AppData, name: string, goalIds: string[]): { ops: Op[]; groupId: string } {
  const group: GoalGroup = { id: newId(), name: name.trim() || 'Group', created_at: new Date().toISOString() };
  const ops: Op[] = [{ kind: 'insert', collection: 'groups', rows: [group as unknown as Row] }];
  const moving = new Set(goalIds);
  for (const id of moving) ops.push({ kind: 'update', collection: 'goals', id, patch: { group_id: group.id } });
  ops.push(...opsCleanUpLeft(data, moving));
  return { ops, groupId: group.id };
}

/** Put a goal in a group (taking it out of any other). */
export function opsAddToGroup(data: AppData, goalId: string, groupId: string): Op[] {
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal || goal.group_id === groupId) return [];
  return [{ kind: 'update', collection: 'goals', id: goalId, patch: { group_id: groupId } }, ...opsCleanUpLeft(data, new Set([goalId]))];
}

/** Take a goal out of its group. */
export function opsRemoveFromGroup(data: AppData, goalId: string): Op[] {
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal?.group_id) return [];
  return [{ kind: 'update', collection: 'goals', id: goalId, patch: { group_id: null } }, ...opsCleanUpLeft(data, new Set([goalId]))];
}

/** Set the group's week goal for a Monday: one line that rolls up its goals. */
export function opsSetGroupWeek(group: GoalGroup, text: string, monday: ISODate): Op[] {
  const t = text.trim();
  if (t === (group.week_goal ?? '') && monday === (group.week_goal_for ?? null)) return [];
  return [{ kind: 'update', collection: 'groups', id: group.id, patch: { week_goal: t, week_goal_for: t ? monday : null } }];
}

/** The group's week goal if it's for this week (an old one isn't shown as current). */
export function groupWeekGoal(group: GoalGroup, monday: ISODate): string {
  return group.week_goal_for === monday ? group.week_goal ?? '' : '';
}

export function opsRenameGroup(group: GoalGroup, name: string): Op[] {
  const n = name.trim();
  return n && n !== group.name ? [{ kind: 'update', collection: 'groups', id: group.id, patch: { name: n } }] : [];
}

/** Ungroup: every goal is on its own again. Goals and their tasks (shared ones too) are untouched. */
export function opsUngroup(data: AppData, group: GoalGroup): Op[] {
  return [
    ...data.goals.filter((g) => g.group_id === group.id).map((g): Op => ({ kind: 'update', collection: 'goals', id: g.id, patch: { group_id: null } })),
    { kind: 'delete', collection: 'groups', id: group.id },
  ];
}

/**
 * After `moving` goals leave their groups: any group left with one live goal or none goes away,
 * and a last goal left behind goes back to being on its own.
 */
function opsCleanUpLeft(data: AppData, moving: Set<string>): Op[] {
  const ops: Op[] = [];
  const left = new Set(data.goals.filter((g) => moving.has(g.id) && g.group_id).map((g) => g.group_id!));
  for (const groupId of left) {
    const rest = data.goals.filter((g) => g.group_id === groupId && !moving.has(g.id) && !g.archived_at);
    if (rest.length >= 2) continue;
    for (const g of rest) ops.push({ kind: 'update', collection: 'goals', id: g.id, patch: { group_id: null } });
    ops.push({ kind: 'delete', collection: 'groups', id: groupId });
  }
  return ops;
}

/** Names worth offering for a new group, from what its goals are about. The first is the default. */
export function suggestGroupNames(goals: Goal[]): string[] {
  const text = goals.map((g) => `${g.title} ${g.done_means ?? ''}`).join(' ').toLowerCase();
  const themes: [string, RegExp][] = [
    ['Body', /weight|lose|lb\b|kg\b|gym|work ?out|lift|fit|run|swim|bike|cycl|marathon|triathlon|strength|muscle/],
    ['Health', /health|sleep|diet|eat|nutrition|water|steps|walk|meditat|stress/],
    ['Learning', /course|certif|class|study|learn|exam|degree|program|module|read|book|jhu|aigp|iapp|iso/],
    ['Career', /job|career|interview|resume|promotion|role|network|linkedin|client|business/],
    ['Money', /money|save|saving|budget|debt|invest|income|spend/],
    ['Creative', /guitar|music|song|piano|draw|paint|write|writing|photo|video|channel|film/],
    ['Home', /home|house|garden|clean|declutter|move|renovat/],
    ['Relationships', /family|friend|partner|wife|husband|kids|date|call mom|call dad/],
  ];
  const hits = themes.filter(([, re]) => re.test(text)).map(([n]) => n);
  const pair = goals.length === 2 ? [`${short(goals[0]!.title)} + ${short(goals[1]!.title)}`] : [];
  return [...new Set([...hits, ...pair, 'Focus'])].slice(0, 4);
}

const short = (t: string) => (t.length > 16 ? `${t.slice(0, 15).trim()}…` : t);

