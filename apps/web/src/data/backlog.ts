import { rankAtEnd, rankAtTop, reorder, type GoalIdea, type IdeaStatus } from '@six/core';
import type { AppData, Op } from './model.ts';

/** Changes to the goal backlog, as ops. Ordering rules live in @six/core (backlog.ts). */

const now = () => new Date().toISOString();
const row = (idea: GoalIdea) => [idea as unknown as { id: string } & Record<string, unknown>];

/** Write an idea down. It joins the end of the backlog: ordering is a deliberate choice. */
export function opsAddIdea(data: AppData, title: string, note = ''): { ops: Op[]; idea: GoalIdea } {
  const idea: GoalIdea = {
    id: crypto.randomUUID(),
    title: title.trim(),
    note: note.trim(),
    status: 'backlog',
    rank: rankAtEnd(data.ideas, 'backlog'),
    goal_id: null,
    created_at: now(),
    started_at: null,
  };
  return { ops: [{ kind: 'insert', collection: 'ideas', rows: row(idea) }], idea };
}

/** One idea in a file for "Add ideas from a file": a title, and optionally why it matters and what done looks like. */
export interface IdeaFileItem {
  title: string;
  note?: string;
  done_means?: string;
}

/** Read an ideas file: { "ideas": [{ "title", "note", "done_means" }] } or just the list. Throws with a plain message. */
export function parseIdeaFile(text: string): IdeaFileItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { ideas?: unknown } | null)?.ideas;
  if (!Array.isArray(list)) throw new Error('This file has no list of ideas.');
  const items = list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { title?: unknown }).title === 'string')
    .map((x) => ({
      title: String(x.title).trim(),
      note: typeof x.note === 'string' ? x.note.trim() : '',
      done_means: typeof x.done_means === 'string' ? x.done_means.trim() : '',
    }))
    .filter((x) => x.title);
  if (!items.length) throw new Error('This file has no ideas with a title.');
  return items;
}

/**
 * Add ideas to the end of the backlog, in the file's order, without touching anything else.
 * An idea whose title matches a goal or an idea you already have (not discarded) is skipped.
 */
export function opsAddIdeas(data: AppData, items: IdeaFileItem[]): { ops: Op[]; added: string[]; skipped: string[] } {
  const key = (s: string) => s.trim().toLowerCase();
  const taken = new Set([
    ...data.goals.filter((g) => !g.archived_at).map((g) => key(g.title)),
    ...data.ideas.filter((i) => i.status !== 'discarded').map((i) => key(i.title)),
  ]);
  const ideas = [...data.ideas];
  const ops: Op[] = [];
  const added: string[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    if (taken.has(key(item.title))) {
      skipped.push(item.title);
      continue;
    }
    taken.add(key(item.title));
    const idea: GoalIdea = {
      id: crypto.randomUUID(),
      title: item.title,
      note: item.note ?? '',
      ...(item.done_means ? { done_means: item.done_means } : {}),
      status: 'backlog',
      rank: rankAtEnd(ideas, 'backlog'),
      goal_id: null,
      created_at: now(),
      started_at: null,
    };
    ideas.push(idea);
    ops.push({ kind: 'insert', collection: 'ideas', rows: row(idea) });
    added.push(item.title);
  }
  return { ops, added, skipped };
}

export function opsEditIdea(idea: GoalIdea, patch: { title?: string; note?: string; done_means?: string }): Op[] {
  const clean: Record<string, string> = {};
  if (patch.title !== undefined && patch.title.trim()) clean.title = patch.title.trim();
  if (patch.note !== undefined) clean.note = patch.note.trim();
  // Only sent when used (or already set), so a database without the column still saves the rest.
  if (patch.done_means !== undefined && (patch.done_means.trim() || idea.done_means)) clean.done_means = patch.done_means.trim();
  return Object.keys(clean).length ? [{ kind: 'update', collection: 'ideas', id: idea.id, patch: clean }] : [];
}

/** Move an idea up, down or to the top of its column. */
export function opsMoveIdea(data: AppData, id: string, move: 'up' | 'down' | 'top'): Op[] {
  return reorder(data.ideas, id, move).map((r): Op => ({ kind: 'update', collection: 'ideas', id: r.id, patch: { rank: r.rank } }));
}

/** Discard an idea (it joins the end of the discarded list) or bring one back (to the top of the backlog). */
export function opsSetStatus(data: AppData, idea: GoalIdea, status: IdeaStatus): Op[] {
  const rank = status === 'backlog' ? rankAtTop(data.ideas, 'backlog') : rankAtEnd(data.ideas, status);
  return [{ kind: 'update', collection: 'ideas', id: idea.id, patch: { status, rank } }];
}

/** Restore an idea exactly as it was (for Undo). */
export function opsRestoreIdea(before: GoalIdea): Op[] {
  const { id, ...rest } = before;
  return [{ kind: 'update', collection: 'ideas', id, patch: rest as Record<string, unknown> }];
}

/** The idea became a goal. */
export function opsStartIdea(data: AppData, ideaId: string, goalId: string): Op[] {
  const idea = data.ideas.find((i) => i.id === ideaId);
  if (!idea) return [];
  return [{ kind: 'update', collection: 'ideas', id: idea.id, patch: { status: 'started', goal_id: goalId, started_at: now(), rank: rankAtEnd(data.ideas, 'started') } }];
}

export function opsDeleteIdea(idea: GoalIdea): Op[] {
  return [{ kind: 'delete', collection: 'ideas', id: idea.id }];
}
