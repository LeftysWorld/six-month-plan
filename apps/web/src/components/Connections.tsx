import { useState } from 'react';
import { describeSchedule, shortDate, type Action, type Goal, type GoalGroup } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView, type View } from '../data/derive.ts';
import { opsShareTask, runningSchedule, shareCandidates, type ShareGroup } from '../data/connect.ts';
import { groupMembers, groupOf, opsAddToGroup, opsCreateGroup, opsRemoveFromGroup, opsRenameGroup, opsUngroup, suggestGroupNames } from '../data/groups.ts';
import { applyOp, type AppData, type Op } from '../data/model.ts';
import { href } from '../router.ts';
import { PacePill, Sheet, useToast } from './ui.tsx';

/** Live daily tasks that two or more of these goals share. */
export function sharedTasksOf(view: View, goals: Goal[]): Action[] {
  const ids = new Set(goals.map((g) => g.id));
  const out = new Map<string, Action>();
  for (const g of goals) {
    for (const a of view.actionsForGoal(g.id)) {
      if (view.goalsForAction(a.id).filter((x) => ids.has(x.id)).length >= 2) out.set(a.id, a);
    }
  }
  return [...out.values()];
}

/** Running tasks on some of these goals but not all, that could be shared across the group. */
function shareableAcross(view: View, goals: Goal[], today: string): { action: Action; from: Goal; missing: Goal[] }[] {
  const out: { action: Action; from: Goal; missing: Goal[] }[] = [];
  const seen = new Set<string>();
  for (const g of goals) {
    for (const a of view.actionsForGoal(g.id)) {
      if (seen.has(a.id) || !runningSchedule(view.data, a.id, today)) continue;
      seen.add(a.id);
      const on = new Set(view.goalsForAction(a.id).map((x) => x.id));
      const missing = goals.filter((x) => !on.has(x.id));
      if (missing.length) out.push({ action: a, from: g, missing });
    }
  }
  return out;
}

/** Share each chosen task with every goal in the group that doesn't have it yet. */
function opsShareAcross(data: AppData, picks: { action: Action; missing: Goal[] }[]): Op[] {
  let next = data;
  const ops: Op[] = [];
  for (const p of picks) {
    for (const g of p.missing) {
      const add = opsShareTask(next, p.action.id, g.id);
      ops.push(...add);
      next = add.reduce(applyOp, next);
    }
  }
  return ops;
}

/**
 * Name a new group made from these goals (dragging one goal onto another opens this).
 * Suggests a name from what the goals are about, and offers tasks to share across them.
 */
export function GroupNameSheet({ goals, onClose, onCreated }: { goals: Goal[]; onClose: () => void; onCreated?: (groupId: string) => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const suggestions = suggestGroupNames(goals);
  const [name, setName] = useState(suggestions[0] ?? '');
  const options = shareableAcross(view, goals, today);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const moving = goals.filter((g) => g.group_id);
  function create() {
    const { ops, groupId } = opsCreateGroup(data, name, goals.map((g) => g.id));
    const after = ops.reduce(applyOp, data);
    const share = opsShareAcross(after, options.filter((o) => picked.has(o.action.id)));
    commit([...ops, ...share]);
    toast(`Group “${name.trim() || 'Group'}” made${share.length ? ` · ${picked.size} task${picked.size === 1 ? '' : 's'} shared` : ''}`);
    onCreated?.(groupId);
    onClose();
  }
  return (
    <Sheet title="New group" onClose={onClose}>
      <span className="row-start small" style={{ marginTop: -8, color: 'var(--ink-2)', gap: 6 }}>
        {goals.map((g, i) => (
          <span key={g.id} className="row-start" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {i > 0 && <span className="muted">+</span>}
            <span className="dot" style={{ background: g.color }} />
            {g.title}
          </span>
        ))}
      </span>
      {moving.length > 0 && <span className="xsmall muted">{moving.map((g) => g.title).join(', ')} will leave {moving.length === 1 ? 'its' : 'their'} current group: a goal is in one group at most.</span>}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="field">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Body" />
        </label>
        <div className="chips" role="group" aria-label="Suggested names">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={name === s} onClick={() => setName(s)}>
              {s}
            </button>
          ))}
        </div>
        {options.length > 0 && (
          <div className="stack-sm">
            <span className="small strong">
              Share tasks between them? <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
            </span>
            <span className="xsmall muted">A shared task is logged once and counts for every goal in the group.</span>
            <div className="chips" role="group" aria-label="Tasks to share">
              {options.map((o) => {
                const on = picked.has(o.action.id);
                return (
                  <button
                    key={o.action.id}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() =>
                      setPicked((cur) => {
                        const n = new Set(cur);
                        if (on) n.delete(o.action.id);
                        else n.add(o.action.id);
                        return n;
                      })
                    }
                  >
                    {o.action.title} · from {o.from.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            Create group
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** An open group, like an open folder: rename it, see and remove its goals, its shared tasks, ungroup. */
export function GroupSheet({ group, onClose }: { group: GoalGroup; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [name, setName] = useState(group.name);
  const [sharing, setSharing] = useState(false);
  const members = groupMembers(data, group.id);
  const shared = sharedTasksOf(view, members);
  const options = shareableAcross(view, members, today);
  const live = data.groups.find((g) => g.id === group.id);
  if (!live) return null;
  return (
    <Sheet title={live.name} onClose={onClose}>
      <form
        className="row-start"
        style={{ flexWrap: 'nowrap', marginTop: -6 }}
        onSubmit={(e) => {
          e.preventDefault();
          const ops = opsRenameGroup(live, name);
          if (ops.length) {
            commit(ops);
            toast(`Renamed to “${name.trim()}”`);
          }
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
        <button className="btn small" type="submit" style={{ minHeight: 44, flex: 'none' }} disabled={!name.trim() || name.trim() === live.name}>
          Rename
        </button>
      </form>
      <div className="stack-sm">
        <span className="label">Goals</span>
        {members.map((g) => {
          const pace = view.goalPace(g, view.planForGoal(g));
          return (
            <div key={g.id} className="list-row" style={{ gap: 10 }}>
              <span className="dot" style={{ background: g.color }} />
              <a className="grow small strong" href={href(`/goals/${g.id}`)} onClick={onClose} style={{ color: 'var(--ink)', textDecoration: 'none' }}>
                {g.title}
              </a>
              {pace.label !== 'none' && <PacePill label={pace.label} />}
              <button
                className="btn small"
                onClick={() => {
                  const ops = opsRemoveFromGroup(data, g.id);
                  commit(ops);
                  const gone = ops.some((o) => o.kind === 'delete' && o.collection === 'groups');
                  toast(gone ? `${g.title} removed. ${live.name} had one goal left, so the group is gone.` : `${g.title} removed from ${live.name}`);
                  if (gone) onClose();
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
        <span className="xsmall muted">To add a goal, drag it onto this group on the Goals page, or use “Add to a group” on its page.</span>
      </div>
      <div className="stack-sm">
        <span className="label">Shared tasks · count for every goal here</span>
        {shared.length === 0 && <span className="small muted">None yet.</span>}
        {shared.map((a) => {
          const sch = runningSchedule(data, a.id, today);
          return (
            <div key={a.id} className="list-row small" style={{ gap: 8 }}>
              <span className="grow">{a.title}</span>
              <span className="xsmall muted">{sch ? describeSchedule(sch) : 'ended'}</span>
            </div>
          );
        })}
        {options.length > 0 && (
          <button className="btn small ghost" onClick={() => setSharing(true)} style={{ alignSelf: 'flex-start' }}>
            + Share another task
          </button>
        )}
      </div>
      <button
        className="btn small danger"
        onClick={() => {
          commit(opsUngroup(data, live));
          toast(`${live.name} ungrouped. The goals and their tasks are unchanged.`);
          onClose();
        }}
      >
        Ungroup
      </button>
      {sharing && (
        <Sheet title={`Share a task across ${live.name}`} onClose={() => setSharing(false)}>
          <span className="small muted" style={{ marginTop: -8 }}>
            It stays one task, logged once, and counts for every goal in the group.
          </span>
          {options.map((o) => (
            <div key={o.action.id} className="list-row" style={{ gap: 8 }}>
              <span className="grow">
                <span className="small strong" style={{ display: 'block' }}>
                  {o.action.title}
                </span>
                <span className="xsmall muted">From {o.from.title} · adds {o.missing.map((g) => g.title).join(', ')}</span>
              </span>
              <button
                className="btn small"
                onClick={() => {
                  commit(opsShareAcross(data, [o]));
                  toast(`${o.action.title} now counts for every goal in ${live.name}`);
                  setSharing(false);
                }}
              >
                Share
              </button>
            </div>
          ))}
        </Sheet>
      )}
    </Sheet>
  );
}

/** Pick where a goal goes: an existing group, or a new one with another goal. */
export function AddToGroupSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [pairWith, setPairWith] = useState<Goal | null>(null);
  const groups = data.groups.filter((gr) => gr.id !== goal.group_id && groupMembers(data, gr.id).length > 0);
  const loose = view.activeGoals.filter((g) => g.id !== goal.id && !g.group_id);
  if (pairWith) return <GroupNameSheet goals={[pairWith, goal]} onClose={onClose} />;
  return (
    <Sheet title={goal.group_id ? `Move ${goal.title}` : `Add ${goal.title} to a group`} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        A goal is in one group at most{goal.group_id ? `, so it will leave ${groupOf(data, goal)?.name}` : ''}. On the Goals page you can also drag it onto a goal or a group.
      </span>
      {groups.length > 0 && (
        <div className="stack-sm">
          <span className="label">Join a group</span>
          {groups.map((gr) => (
            <button
              key={gr.id}
              className="list-row"
              style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
              onClick={() => {
                commit(opsAddToGroup(data, goal.id, gr.id));
                toast(`${goal.title} added to ${gr.name}`);
                onClose();
              }}
            >
              <span className="grow small strong">{gr.name}</span>
              <span className="xsmall muted">{groupMembers(data, gr.id).map((g) => g.title).join(', ')}</span>
            </button>
          ))}
        </div>
      )}
      {loose.length > 0 && (
        <div className="stack-sm">
          <span className="label">Start a group with</span>
          <div className="chips">
            {loose.map((g) => (
              <button key={g.id} className="chip" onClick={() => setPairWith(g)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
                {g.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {groups.length === 0 && loose.length === 0 && <span className="small muted">No other goals to group with yet.</span>}
      {goal.group_id && (
        <button
          className="btn small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            const name = groupOf(data, goal)?.name;
            commit(opsRemoveFromGroup(data, goal.id));
            toast(`${goal.title} taken out of ${name}`);
            onClose();
          }}
        >
          Take it out of {groupOf(data, goal)?.name}
        </button>
      )}
    </Sheet>
  );
}

/**
 * The group card on a goal's page: its group (name, the other goals with their pace, shared tasks)
 * or, for a goal on its own, a way to add it to one. Goals it shares a task with outside the group
 * are listed too.
 */
export function GoalGroupCard({ goal }: { goal: Goal }) {
  const { data } = useStore();
  const view = useView();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sharingFrom, setSharingFrom] = useState<string | null>(null);
  const toast = useToast();
  const group = groupOf(data, goal);
  const mates = group ? groupMembers(data, group.id).filter((g) => g.id !== goal.id) : [];
  const outside = view.connectionsFor(goal.id).filter((c) => !c.sameGroup && c.shared.length > 0);
  return (
    <div className="card stack-sm" id="connected-goals" style={{ scrollMarginTop: 12 }}>
      <div className="row-between">
        <span className="label">{group ? `Group · ${group.name}` : 'Group'}</span>
        {group ? (
          <button className="link-btn small" onClick={() => setOpen(true)}>
            Open group
          </button>
        ) : (
          <button className="link-btn small" onClick={() => setAdding(true)}>
            Add to a group
          </button>
        )}
      </div>
      {!group && <span className="small muted">Not in a group. Group goals that work together, like working out and losing weight, and share daily tasks between them.</span>}
      {mates.map((other) => {
        const pace = view.goalPace(other, view.planForGoal(other));
        const shared = view.connectionsFor(goal.id).find((c) => c.goal.id === other.id)?.shared ?? [];
        return (
          <div key={other.id} className="connection">
            <div className="row-between" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <a className="row-start small strong" href={href(`/goals/${other.id}`)} style={{ flexWrap: 'nowrap', minWidth: 0, color: 'var(--ink)', textDecoration: 'none' }}>
                <span className="dot" style={{ background: other.color, flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{other.title}</span>
              </a>
              {pace.label !== 'none' && <PacePill label={pace.label} />}
            </div>
            {pace.summary && <span className="xsmall muted">{pace.summary}</span>}
            <span className="xsmall" style={{ color: 'var(--ink-2)' }}>
              {shared.length ? `Shared tasks: ${shared.map((a) => a.title).join(', ')}` : 'No shared tasks yet'}
            </span>
            <button className="link-btn small" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => setSharingFrom(other.id)}>
              Share a task from {other.title}
            </button>
          </div>
        );
      })}
      {outside.length > 0 && (
        <span className="xsmall muted">
          Also shares tasks with {outside.map((c) => `${c.goal.title} (${c.shared.map((a) => a.title).join(', ')})`).join('; ')}
        </span>
      )}
      {open && group && <GroupSheet group={group} onClose={() => setOpen(false)} />}
      {adding && <AddToGroupSheet goal={goal} onClose={() => setAdding(false)} />}
      {sharingFrom && <ShareTaskSheet goal={goal} onlyGoalId={sharingFrom} onClose={() => setSharingFrom(null)} onShared={(m) => toast(m)} />}
    </div>
  );
}

/** One line under a goal's title (and on its Goals card): its group and the other goals in it. */
export function ConnectionStrip({ goal, editable = false }: { goal: Goal; editable?: boolean }) {
  const { data } = useStore();
  const [adding, setAdding] = useState(false);
  const group = groupOf(data, goal);
  const mates = group ? groupMembers(data, group.id).filter((g) => g.id !== goal.id) : [];
  if (!group && !editable) return null;
  return (
    <div className="connection-strip" aria-label="Group">
      <span className="mono">{group ? group.name.toUpperCase() : 'NOT IN A GROUP'}</span>
      {mates.map((g) => (
        <a key={g.id} className="connection-chip" href={href(`/goals/${g.id}`)}>
          <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
          {g.title}
        </a>
      ))}
      {editable && !group && (
        <button type="button" className="connection-chip add" onClick={() => setAdding(true)}>
          + Add to a group
        </button>
      )}
      {editable && group && (
        <button type="button" className="link-btn small" onClick={() => document.getElementById('connected-goals')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Details
        </button>
      )}
      {adding && <AddToGroupSheet goal={goal} onClose={() => setAdding(false)} />}
    </div>
  );
}

/**
 * Share an existing task with this goal: one task, logged once, counting for every goal it supports.
 * Tasks from connected goals come first.
 */
export function ShareTaskSheet({ goal, onClose, onShared, onlyGoalId }: { goal: Goal; onClose: () => void; onShared: (m: string) => void; onlyGoalId?: string }) {
  const { today } = useStore();
  const view = useView();
  const groups = shareCandidates(view, goal.id, today, onlyGoalId);
  return (
    <Sheet title={`Share a task with ${goal.title}`} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        A shared task is one task: it shows once on Today, and logging it counts for every goal it supports. Its schedule stays the same.
      </span>
      {groups.length === 0 && <span className="small muted">{onlyGoalId ? 'That goal has no running task to share.' : 'No other goal has a running task to share.'}</span>}
      <ShareList goal={goal} groups={groups} onShared={(m) => { onShared(m); onClose(); }} />
    </Sheet>
  );
}

/** Tasks from other goals, grouped by goal, each with a Share button. */
export function ShareList({ goal, groups, onShared, limit }: { goal: Goal; groups: ShareGroup[]; onShared: (m: string) => void; limit?: number }) {
  const { data, commit } = useStore();
  let left = limit ?? Infinity;
  return (
    <>
      {groups.map(({ goal: g, connected, tasks }) => {
        if (left <= 0) return null;
        const shown = tasks.slice(0, left);
        left -= shown.length;
        return (
          <div key={g.id} className="stack-sm">
            <span className="row-start small strong">
              <span className="dot" style={{ background: g.color }} />
              {g.title}
              {connected && <span className="xsmall muted" style={{ fontWeight: 400 }}>· connected</span>}
            </span>
            {shown.map(({ action: a, schedule }) => (
              <div key={a.id} className="list-row" style={{ gap: 8 }}>
                <span className="grow">
                  <span className="small strong" style={{ display: 'block' }}>
                    {a.title}
                  </span>
                  <span className="xsmall muted">
                    {describeSchedule(schedule)}
                    {schedule.effective_to ? ` · until ${shortDate(schedule.effective_to)}` : ''}
                  </span>
                </span>
                <button
                  className="btn small"
                  onClick={() => {
                    commit(opsShareTask(data, a.id, goal.id));
                    onShared(`${a.title} now counts for ${goal.title} too`);
                  }}
                >
                  Use it
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
