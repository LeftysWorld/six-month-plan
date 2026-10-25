import { useState } from 'react';
import { describeSchedule, type Goal } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { linkBetween, opsLinkGoals, opsShareTask, opsUnlinkGoals } from '../data/connect.ts';
import { href } from '../router.ts';
import { PacePill, Sheet, useToast } from './ui.tsx';

/**
 * Connected goals on a goal page: goals you connected by hand and goals that share a daily
 * task with this one. Each shows its pace, the tasks they share, and a way to share one more.
 */
export function ConnectedGoals({ goal }: { goal: Goal }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [connecting, setConnecting] = useState(false);
  const [sharingFrom, setSharingFrom] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const connections = view.connectionsFor(goal.id);
  const canConnect = view.activeGoals.some((g) => g.id !== goal.id && !connections.some((c) => c.goal.id === g.id));

  return (
    <div className="card stack-sm" id="connected-goals" style={{ scrollMarginTop: 12 }}>
      <div className="row-between">
        <span className="label">Connected goals</span>
        {canConnect && (
          <button className="link-btn small" onClick={() => setConnecting(true)}>
            Connect a goal
          </button>
        )}
      </div>
      {connections.length === 0 && (
        <span className="small muted">
          Connect goals that work together, like working out and losing weight. They can share daily tasks: log a task once and it counts for both.
        </span>
      )}
      {connections.map(({ goal: other, link, shared }) => {
        const pace = view.goalPace(other, view.planForGoal(other));
        return (
          <div key={other.id} className="connection">
            <div className="row-between" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <a className="row-start small strong" href={href(`/goals/${other.id}`)} style={{ flexWrap: 'nowrap', minWidth: 0, color: 'var(--ink)', textDecoration: 'none' }}>
                <span className="dot" style={{ background: other.color, flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{other.title}</span>
              </a>
              {other.completed_at ? <span className="xsmall muted">Completed</span> : pace.label !== 'none' ? <PacePill label={pace.label} /> : null}
            </div>
            {!other.completed_at && pace.summary && <span className="xsmall muted">{pace.summary}</span>}
            {link?.note && editingNote !== link.id && <span className="small" style={{ fontStyle: 'italic', color: 'var(--ink-2)' }}>"{link.note}"</span>}
            {link && editingNote === link.id && <NoteEditor initial={link.note} onDone={(note) => { commit(opsLinkGoals(data, goal.id, other.id, note)); setEditingNote(null); }} />}
            <span className="xsmall" style={{ color: 'var(--ink-2)' }}>
              {shared.length ? `Shared tasks: ${shared.map((a) => a.title).join(', ')}` : 'No shared tasks yet'}
            </span>
            <div className="row-start" style={{ gap: 4 }}>
              {!other.completed_at && (
                <button className="link-btn small" onClick={() => setSharingFrom(other.id)}>
                  Share a task from {other.title}
                </button>
              )}
              {link && editingNote !== link.id && (
                <button className="link-btn small" onClick={() => setEditingNote(link.id)}>
                  {link.note ? 'Edit note' : 'Add a note'}
                </button>
              )}
              {link && (
                <button
                  className="link-btn small"
                  onClick={() => {
                    commit(opsUnlinkGoals(link));
                    toast(shared.length ? `Disconnected. They still share ${shared.length === 1 ? 'a task' : `${shared.length} tasks`}, so they stay linked through those.` : `Disconnected from ${other.title}`, () => commit([{ kind: 'insert', collection: 'goalLinks', rows: [link as unknown as { id: string } & Record<string, unknown>] }]));
                  }}
                >
                  Disconnect
                </button>
              )}
              {!link && <span className="xsmall muted">Connected through shared tasks</span>}
            </div>
          </div>
        );
      })}
      {connecting && <ConnectSheet goal={goal} onClose={() => setConnecting(false)} />}
      {sharingFrom && <ShareTaskSheet goal={goal} onlyGoalId={sharingFrom} onClose={() => setSharingFrom(null)} onShared={(m) => toast(m)} />}
    </div>
  );
}

/**
 * A one-line row of connected goals, shown near the top of a goal page and on the Goals list.
 * Each chip opens that goal; the count says how many daily tasks they share. With `editable`, a
 * Connect chip opens the connect sheet, and "Details" jumps to the full Connected goals card.
 */
export function ConnectionStrip({ goal, editable = false }: { goal: Goal; editable?: boolean }) {
  const view = useView();
  const [connecting, setConnecting] = useState(false);
  const connections = view.connectionsFor(goal.id).filter((c) => !c.goal.completed_at);
  const canConnect = view.activeGoals.some((g) => g.id !== goal.id && !connections.some((c) => c.goal.id === g.id));
  if (connections.length === 0 && !(editable && canConnect)) return null;
  return (
    <div className="connection-strip" aria-label="Connected goals">
      <span className="mono">{connections.length ? 'CONNECTED' : 'NOT CONNECTED'}</span>
      {connections.map(({ goal: g, shared }) => (
        <a key={g.id} className="connection-chip" href={href(`/goals/${g.id}`)} title={shared.length ? `Shares: ${shared.map((a) => a.title).join(', ')}` : 'Connected by hand'}>
          <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
          {g.title}
          {shared.length > 0 && <span className="muted"> · {shared.length} shared</span>}
        </a>
      ))}
      {editable && canConnect && (
        <button type="button" className="connection-chip add" onClick={() => setConnecting(true)}>
          + Connect a goal
        </button>
      )}
      {editable && connections.length > 0 && (
        <button type="button" className="link-btn small" onClick={() => document.getElementById('connected-goals')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Details
        </button>
      )}
      {connecting && <ConnectSheet goal={goal} onClose={() => setConnecting(false)} />}
    </div>
  );
}

function NoteEditor({ initial, onDone }: { initial: string; onDone: (note: string) => void }) {
  const [note, setNote] = useState(initial);
  return (
    <form
      className="row-start"
      style={{ flexWrap: 'nowrap' }}
      onSubmit={(e) => {
        e.preventDefault();
        onDone(note);
      }}
    >
      <input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The gym is how I lose the weight" aria-label="How they're connected" />
      <button className="btn small" type="submit" style={{ minHeight: 44 }}>
        Save
      </button>
    </form>
  );
}

/** Pick a goal to connect to, with an optional note on how they're connected. */
function ConnectSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const taken = new Set(view.connectionsFor(goal.id).map((c) => c.goal.id));
  const choices = view.activeGoals.filter((g) => g.id !== goal.id && !taken.has(g.id));
  const [picked, setPicked] = useState<string | null>(choices[0]?.id ?? null);
  const [note, setNote] = useState('');
  return (
    <Sheet title={`Connect ${goal.title}`} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        Connected goals show on each other's page and sit together in reviews. Next, share the tasks they have in common.
      </span>
      <div className="chips" role="radiogroup" aria-label="Goal to connect">
        {choices.map((g) => (
          <button key={g.id} className="chip" role="radio" aria-checked={picked === g.id} aria-pressed={picked === g.id} onClick={() => setPicked(g.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
            {g.title}
          </button>
        ))}
      </div>
      <label className="field">
        How are they connected? (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The gym is how I lose the weight" />
      </label>
      <div className="btn-row">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!picked}
          onClick={() => {
            if (!picked) return;
            const other = view.goal(picked);
            if (!linkBetween(data, goal.id, picked)) commit(opsLinkGoals(data, goal.id, picked, note));
            toast(`Connected with ${other?.title ?? 'that goal'}`);
            onClose();
          }}
        >
          Connect
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Share an existing task with this goal: one task, logged once, counting for every goal it supports.
 * Tasks from connected goals come first.
 */
export function ShareTaskSheet({ goal, onClose, onShared, onlyGoalId }: { goal: Goal; onClose: () => void; onShared: (m: string) => void; onlyGoalId?: string }) {
  const { data, commit } = useStore();
  const view = useView();
  const connected = new Set(view.connectionsFor(goal.id).map((c) => c.goal.id));
  const mine = new Set(view.actionsForGoal(goal.id).map((a) => a.id));
  const others = view.activeGoals
    .filter((g) => g.id !== goal.id && (!onlyGoalId || g.id === onlyGoalId))
    .sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)) || a.title.localeCompare(b.title))
    .map((g) => ({ g, tasks: view.actionsForGoal(g.id).filter((a) => !mine.has(a.id) && data.schedules.some((s) => s.action_id === a.id && s.effective_to == null)) }))
    .filter((x) => x.tasks.length > 0);
  return (
    <Sheet title={`Share a task with ${goal.title}`} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        A shared task is one task: it shows once on Today, and logging it counts for every goal it supports. Its schedule stays the same.
      </span>
      {others.length === 0 && <span className="small muted">No other goal has an ongoing task to share.</span>}
      {others.map(({ g, tasks }) => (
        <div key={g.id} className="stack-sm">
          <span className="row-start small strong">
            <span className="dot" style={{ background: g.color }} />
            {g.title}
            {connected.has(g.id) && <span className="xsmall muted" style={{ fontWeight: 400 }}>· connected</span>}
          </span>
          {tasks.map((a) => {
            const schedule = data.schedules.find((s) => s.action_id === a.id && s.effective_to == null);
            return (
              <div key={a.id} className="list-row" style={{ gap: 8 }}>
                <span className="grow">
                  <span className="small strong" style={{ display: 'block' }}>
                    {a.title}
                  </span>
                  <span className="xsmall muted">{schedule ? describeSchedule(schedule) : ''}</span>
                </span>
                <button
                  className="btn small"
                  onClick={() => {
                    commit(opsShareTask(data, a.id, goal.id));
                    onShared(`${a.title} now counts for ${goal.title} too`);
                    onClose();
                  }}
                >
                  Share
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </Sheet>
  );
}
