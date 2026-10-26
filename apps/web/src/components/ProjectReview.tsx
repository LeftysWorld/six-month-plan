import { useState } from 'react';
import { STATE_TEXT, addDays, shortDate, type Goal, type ProjectDecision, type ProjectNote } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView, type View } from '../data/derive.ts';
import type { AppData, Op } from '../data/model.ts';
import { opsAddRaid, opsDropProject, opsStartProject, opsToggleRaid, raidFor, slipsOf, wipStatus } from '../data/projects.ts';
import { opsCompleteGoal } from '../data/ops.ts';
import { href } from '../router.ts';
import { StartProjectSheet, StatePill, statusLine } from './Projects.tsx';

/**
 * Projects in the reviews: a status line per project in the weekly review, a projects check in
 * the month review (status, slips, open RAID items, what's due to start), and the stage gate at
 * the 3-month checkpoint (close, continue, re-plan or drop each project; start waiting ones).
 */

/** Live projects of the goals a review covers, in the goals' order. */
export function reviewProjects(view: View, goals: Goal[]): Goal[] {
  return goals.flatMap((g) => view.projectsOf(g.id, false).filter((p) => !p.completed_at));
}

export type NoteDraft = Record<string, Omit<ProjectNote, 'goal_id'>>;

/** Weekly review: one line per active project (what moved, what's next, anything blocked). */
export function ProjectStatusLines({ projects, notes, onChange }: { projects: Goal[]; notes: NoteDraft; onChange: (next: NoteDraft) => void }) {
  const view = useView();
  const active = projects.filter((p) => p.started_at);
  if (!active.length) return null;
  const set = (id: string, k: keyof ProjectNote, v: string) => onChange({ ...notes, [id]: { moved: '', next: '', blocked: '', ...notes[id], [k]: v } });
  return (
    <div className="card stack-sm">
      <span className="label">Projects · one line each</span>
      <span className="xsmall muted">Optional. A few words is enough; they're kept with this review.</span>
      {active.map((p) => {
        const s = view.projectStats(p);
        const n = notes[p.id] ?? { moved: '', next: '', blocked: '' };
        return (
          <div key={p.id} className="project-note">
            <div className="row-between" style={{ gap: 8 }}>
              <a href={href(`/goals/${p.id}`)} className="small strong" style={{ color: 'var(--ink)', textDecoration: 'none' }}>
                {p.title}
              </a>
              <StatePill state={s.state} />
            </div>
            <span className="xsmall muted">{statusLine(view, p, s)}</span>
            <div className="project-note-fields">
              <input className="input" aria-label={`${p.title}: what moved`} placeholder="What moved" value={n.moved} onChange={(e) => set(p.id, 'moved', e.target.value)} />
              <input className="input" aria-label={`${p.title}: what's next`} placeholder="What's next" value={n.next} onChange={(e) => set(p.id, 'next', e.target.value)} />
              <input className="input" aria-label={`${p.title}: anything blocked`} placeholder="Anything blocked?" value={n.blocked} onChange={(e) => set(p.id, 'blocked', e.target.value)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function notesForReview(projects: Goal[], notes: NoteDraft): ProjectNote[] {
  return projects
    .map((p) => ({ goal_id: p.id, moved: (notes[p.id]?.moved ?? '').trim(), next: (notes[p.id]?.next ?? '').trim(), blocked: (notes[p.id]?.blocked ?? '').trim() }))
    .filter((n) => n.moved || n.next || n.blocked);
}

/** Month review: each project's status and slips, its open RAID items (close them here), and what's due to start. */
export function ProjectsMonthCheck({ projects }: { projects: Goal[] }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const [starting, setStarting] = useState<Goal | null>(null);
  if (!projects.length) return null;
  const wip = wipStatus(data);
  const soon = projects.filter((p) => !p.started_at && (p.start_date ?? today) <= addDays(today, 30));
  return (
    <div className="card stack-sm">
      <div className="row-between">
        <span className="label">Projects check</span>
        <span className="xsmall muted">
          {wip.active.length} of {wip.limit} active
        </span>
      </div>
      {projects.filter((p) => p.started_at).map((p) => {
        const s = view.projectStats(p);
        const slips = slipsOf(data, p.id);
        const open = raidFor(data, p.id).filter((r) => r.status === 'open' && r.kind !== 'decision');
        return (
          <div key={p.id} className="gate-row">
            <div className="row-between" style={{ gap: 8 }}>
              <a href={href(`/goals/${p.id}`)} className="small strong" style={{ color: 'var(--ink)', textDecoration: 'none' }}>
                {p.title}
              </a>
              <StatePill state={s.state} />
            </div>
            <span className="xsmall muted">
              {statusLine(view, p, s)}
              {slips ? ` · slipped ${slips}×` : ''}
              {s.varianceDays ? ` · ${Math.abs(s.varianceDays)} days ${s.varianceDays > 0 ? 'behind' : 'ahead of'} the original plan` : ''}
            </span>
            {open.length > 0 && <span className="xsmall muted">Still open? Tick what's no longer true.</span>}
            {open.map((r) => (
              <label key={r.id} className="check-row small">
                <input type="checkbox" checked={false} onChange={() => commit(opsToggleRaid(r))} />
                <span>
                  <span className="xsmall muted">{r.kind === 'risk' ? 'Risk' : r.kind === 'assumption' ? 'Assumption' : 'Issue'}: </span>
                  {r.title}
                </span>
              </label>
            ))}
          </div>
        );
      })}
      {soon.length > 0 && (
        <div className="gate-row">
          <span className="small strong">Due to start in the next 30 days</span>
          {soon.map((p) => {
            const s = view.projectStats(p);
            return (
              <div key={p.id} className="row-between small" style={{ gap: 8 }}>
                <span>
                  {p.title} <span className="xsmall muted">· {s.state === 'waiting' ? `waits on ${s.waitingOn.map((id) => view.goal(id)?.title).join(', ')}` : `planned ${shortDate(s.start)}`}</span>
                </span>
                <button className="btn small" onClick={() => setStarting(p)}>
                  Start
                </button>
              </div>
            );
          })}
        </div>
      )}
      {starting && <StartProjectSheet project={starting} onClose={() => setStarting(null)} />}
    </div>
  );
}

const ACTIVE_CHOICES: { d: ProjectDecision; label: string }[] = [
  { d: 'continue', label: 'Continue' },
  { d: 'close', label: 'Close' },
  { d: 'replan', label: 'Re-plan' },
  { d: 'drop', label: 'Drop' },
];
const WAITING_CHOICES: { d: ProjectDecision; label: string }[] = [
  { d: 'wait', label: 'Not yet' },
  { d: 'start', label: 'Start now' },
  { d: 'drop', label: 'Drop' },
];

/** The default call for each project at the gate: close one that's finished its milestones, otherwise keep going / wait. */
export function defaultDecision(view: View, p: Goal): ProjectDecision {
  const s = view.projectStats(p);
  if (!p.started_at) return 'wait';
  return s.total > 0 && s.done >= s.total ? 'close' : 'continue';
}

/** 3-month checkpoint: the stage gate for every project. */
export function StageGate({ projects, decisions, onChange }: { projects: Goal[]; decisions: Record<string, ProjectDecision>; onChange: (next: Record<string, ProjectDecision>) => void }) {
  const { data } = useStore();
  const view = useView();
  if (!projects.length) return null;
  const wip = wipStatus(data);
  const starting = projects.filter((p) => (decisions[p.id] ?? defaultDecision(view, p)) === 'start').length;
  const closing = projects.filter((p) => ['close', 'drop'].includes(decisions[p.id] ?? defaultDecision(view, p)) && p.started_at).length;
  const after = wip.active.length - closing + starting;
  return (
    <div className="card stack-sm">
      <span className="label">Stage gate: projects</span>
      <span className="xsmall muted">For each project: close it, keep going, re-plan it or drop it. Waiting projects can start now.</span>
      {projects.map((p) => {
        const s = view.projectStats(p);
        const choices = p.started_at ? ACTIVE_CHOICES : WAITING_CHOICES;
        const current = decisions[p.id] ?? defaultDecision(view, p);
        return (
          <div key={p.id} className="gate-row">
            <div className="row-between" style={{ gap: 8 }}>
              <span className="small strong">{p.title}</span>
              <StatePill state={s.state} />
            </div>
            <span className="xsmall muted">
              {view.parentOf(p)?.title} · {statusLine(view, p, s)}
            </span>
            <div className="chips" role="radiogroup" aria-label={`${p.title}: decision`}>
              {choices.map((c) => (
                <button key={c.d} type="button" role="radio" className="chip" aria-checked={current === c.d} aria-pressed={current === c.d} style={{ minHeight: 34 }} onClick={() => onChange({ ...decisions, [p.id]: c.d })}>
                  {c.label}
                </button>
              ))}
            </div>
            {current === 'replan' && <span className="xsmall muted">Adds an open issue to re-plan its dates; it shows on the Goals page until you close it.</span>}
            {current === 'start' && s.state === 'waiting' && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>It still waits on {s.waitingOn.map((id) => view.goal(id)?.title).join(', ')}. Starting is logged as a decision.</span>}
          </div>
        );
      })}
      <span className={`xsmall ${after > wip.limit ? '' : 'muted'}`} style={after > wip.limit ? { color: 'var(--amber-ink)' } : undefined}>
        After these: {after} active of your limit of {wip.limit}.
      </span>
    </div>
  );
}

/** Apply the gate's decisions. Closing marks a project done; its close-out questions wait on its page. */
export function opsApplyGate(data: AppData, view: View, projects: Goal[], decisions: Record<string, ProjectDecision>, today: string): Op[] {
  const ops: Op[] = [];
  for (const p of projects) {
    const d = decisions[p.id] ?? defaultDecision(view, p);
    if (d === 'close') ops.push(...opsCompleteGoal(data, p, '', today));
    if (d === 'drop') ops.push(...opsDropProject(data, p, 'Decided at the 3-month checkpoint', today));
    if (d === 'replan') ops.push(...opsAddRaid(p.id, 'issue', 'Re-plan the dates (3-month checkpoint)', 'Change the target or the scope, then close this'));
    if (d === 'start') {
      const s = view.projectStats(p);
      const wip = wipStatus(data);
      const blocked = wip.full || s.waitingOn.length > 0;
      ops.push(...opsStartProject(data, p, today, blocked ? { reason: 'Approved at the 3-month checkpoint', why: wip.full && s.waitingOn.length ? 'both' : wip.full ? 'wip' : 'waiting' } : undefined));
    }
  }
  return ops;
}

export const PROJECT_DECISION_TEXT: Record<ProjectDecision, string> = { close: 'Closed', continue: 'Continued', replan: 'Re-plan', drop: 'Dropped', start: 'Started', wait: 'Waiting' };
export { STATE_TEXT };
