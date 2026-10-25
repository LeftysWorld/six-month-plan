import { column, rankAtEnd, rankAtTop, reorder, type GoalIdea, type IdeaStatus } from '@six/core';
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
    selected_at: null,
    started_at: null,
  };
  return { ops: [{ kind: 'insert', collection: 'ideas', rows: row(idea) }], idea };
}

export function opsEditIdea(idea: GoalIdea, patch: { title?: string; note?: string }): Op[] {
  const clean: Record<string, string> = {};
  if (patch.title !== undefined && patch.title.trim()) clean.title = patch.title.trim();
  if (patch.note !== undefined) clean.note = patch.note.trim();
  return Object.keys(clean).length ? [{ kind: 'update', collection: 'ideas', id: idea.id, patch: clean }] : [];
}

/** Move an idea up, down or to the top of its column. */
export function opsMoveIdea(data: AppData, id: string, move: 'up' | 'down' | 'top'): Op[] {
  return reorder(data.ideas, id, move).map((r): Op => ({ kind: 'update', collection: 'ideas', id: r.id, patch: { rank: r.rank } }));
}

/** Put an idea in another column: selected ideas join the end, ideas sent back go to the top of the backlog. */
export function opsSetStatus(data: AppData, idea: GoalIdea, status: IdeaStatus): Op[] {
  const rank = status === 'backlog' ? rankAtTop(data.ideas, 'backlog') : rankAtEnd(data.ideas, status);
  const patch: Record<string, unknown> = { status, rank };
  if (status === 'selected') patch.selected_at = now();
  if (status === 'backlog') patch.selected_at = null;
  return [{ kind: 'update', collection: 'ideas', id: idea.id, patch }];
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

/** Ideas selected for the next commitment, in order. */
export function selectedIdeas(data: AppData): GoalIdea[] {
  return column(data.ideas, 'selected');
}
