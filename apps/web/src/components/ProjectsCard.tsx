import { useState } from 'react';
import { addDays, benefitChecksDue, shortDate, type Goal, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { rollupText, useView, type View } from '../data/derive.ts';
import { decisionsFor, opsAddRaid, wipStatus } from '../data/projects.ts';
import { href } from '../router.ts';
import { Icon, useToast } from './ui.tsx';
import { LaneLegend, NewProjectSheet, ProjectLane, StatePill, statusLine } from './Projects.tsx';

/**
 * The goal page's Projects card: the goal's projects on a lane across its window, then one row
 * each (state, where it is, what's next). A goal with projects takes its progress from them.
 */
export function ProjectsCard({ goal, plan }: { goal: Goal; plan: Plan }) {
  const { today } = useStore();
  const view = useView();
  const [adding, setAdding] = useState(false);
  const projects = view.projectsOf(goal.id);
  const roll = view.rollupFor(goal, plan);
  const items = projects.map((p) => ({ project: p, stats: view.projectStats(p), color: goal.color }));
  return (
    <section className="card stack-sm" aria-label="Projects">
      <div className="row-between">
        <span className="label">Projects</span>
        <button className="link-btn small" onClick={() => setAdding(true)}>
          + Add a project
        </button>
      </div>
      {projects.length === 0 ? (
        <span className="small muted">
          Is this goal reached through a few pieces of work with a finish line, like a course, an exam or a build? Add them as projects. The goal's progress then comes from them, and each one gets its own dates, milestones and brief.
        </span>
      ) : (
        <>
          {roll && <span className="small muted">{rollupText(roll)}</span>}
          <ProjectLane items={items} range={{ start: plan.start_date, end: plan.end_date }} today={today} label={`${goal.title} projects`} />
          <LaneLegend />
          <div className="project-rows">
            {items.map(({ project: p, stats: s }) => (
              <a key={p.id} className="project-row" href={href(`/goals/${p.id}`)}>
                <span className="grow stack-sm" style={{ gap: 2, minWidth: 0 }}>
                  <span className="small strong" style={{ textDecoration: s.phase === 'dropped' ? 'line-through' : undefined }}>
                    {p.title}
                  </span>
                  <span className="xsmall muted">{statusLine(view, p, s)}</span>
                </span>
                <StatePill state={s.state} />
                <Icon name="chevron" size={14} stroke={2.2} />
              </a>
            ))}
          </div>
        </>
      )}
      {adding && <NewProjectSheet goal={goal} onClose={() => setAdding(false)} />}
    </section>
  );
}

/** A goal's decision log: what was decided and why, for the goal and its projects, newest first. */
export function DecisionLog({ goal }: { goal: Goal }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const list = decisionsFor(data, goal.id);
  const shown = all ? list : list.slice(0, 4);
  return (
    <section className="card stack-sm" aria-label="Decision log">
      <span className="label">Decision log</span>
      {list.length === 0 && <span className="small muted">Write down what you decide and why, so later you can see the reasoning, not just the result.</span>}
      {shown.map((d) => (
        <div key={d.id} className="raid-row">
          <div className="grow stack-sm" style={{ gap: 2 }}>
            <span className="small">{d.title}</span>
            {d.detail && <span className="xsmall muted">Why: {d.detail}</span>}
            <span className="xsmall muted">
              {shortDate(d.created_at.slice(0, 10))}
              {d.on && d.on.id !== goal.id ? ` · ${d.on.title}` : ''}
            </span>
          </div>
        </div>
      ))}
      {list.length > 4 && (
        <button className="link-btn xsmall" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          commit(opsAddRaid(goal.id, 'decision', title, why));
          setTitle('');
          setWhy('');
          toast('Decision logged');
        }}
      >
        <input className="input" aria-label="Decision" placeholder="e.g. Product roles only, no more delivery roles" value={title} onChange={(e) => setTitle(e.target.value)} />
        {title.trim() && <input className="input" aria-label="Why" placeholder="Why" value={why} onChange={(e) => setWhy(e.target.value)} />}
        {title.trim() && (
          <button className="btn small" type="submit" style={{ alignSelf: 'flex-start' }}>
            Log decision
          </button>
        )}
      </form>
    </section>
  );
}

/** A goal's projects as small chips under its row on the Goals page. */
export function ProjectChips({ goal }: { goal: Goal }) {
  const view = useView();
  const projects = view.projectsOf(goal.id, false);
  if (!projects.length) return null;
  return (
    <span className="project-chips" aria-label={`${goal.title} projects`}>
      {projects.map((p) => {
        const s = view.projectStats(p);
        return (
          <span key={p.id} className={`project-chip ${s.state}`}>
            {s.state === 'done' ? <Icon name="check" size={10} stroke={3} /> : s.state === 'at_risk' ? <Icon name="alert" size={10} stroke={3} /> : s.state === 'waiting' ? <Icon name="link" size={10} stroke={2.4} /> : <span className="chip-dot" />}
            {p.title}
          </span>
        );
      })}
    </span>
  );
}

export interface ProjectAlert {
  id: string;
  title: string;
  detail: string;
  to: string;
  tone: 'warn' | 'info';
}

/** What needs you across projects: benefits checks due, projects ready to start, at risk or past target. */
export function projectAlerts(view: View): ProjectAlert[] {
  const today = view.today;
  const out: ProjectAlert[] = [];
  const parentLive = (p: Goal) => {
    const g = view.parentOf(p);
    return !!g && !g.archived_at && !g.completed_at;
  };
  for (const p of benefitChecksDue(view.allProjects, today)) {
    out.push({ id: `b-${p.id}`, title: `Check back: ${p.title}`, detail: p.benefit_question ?? '', to: `/goals/${p.id}`, tone: 'info' });
  }
  for (const p of view.allProjects.filter((x) => x.completed_at && !x.dropped_at && !x.closeout && x.completed_at.slice(0, 10) >= addDays(today, -60))) {
    out.push({ id: `c-${p.id}`, title: `Close out ${p.title}`, detail: 'Three questions while it’s fresh', to: `/goals/${p.id}`, tone: 'info' });
  }
  for (const r of (view.data.raidItems ?? []).filter((x) => x.kind === 'issue' && x.status === 'open' && x.title.startsWith('Re-plan'))) {
    const p = view.goal(r.goal_id);
    if (p && !p.completed_at && !p.dropped_at) out.push({ id: `p-${r.id}`, title: `Re-plan ${p.title}`, detail: 'Decided at the 3-month checkpoint. Change its dates or scope, then close the issue.', to: `/goals/${p.id}`, tone: 'warn' });
  }
  const wip = wipStatus(view.data);
  for (const p of view.allProjects.filter(parentLive)) {
    const s = view.projectStats(p);
    if (s.state === 'at_risk') {
      const why = s.overdue ? `past its target (${shortDate(s.end)})` : s.forecast.date ? `forecast ${shortDate(s.forecast.date)}${s.deadline ? `, deadline ${shortDate(s.deadline)}` : `, target ${shortDate(s.end)}`}` : s.label === 'behind' ? `${s.done} of ${s.expected} milestones due are done` : 'not on pace';
      out.push({ id: `r-${p.id}`, title: `${p.title} is at risk`, detail: why, to: `/goals/${p.id}`, tone: 'warn' });
    } else if (s.state === 'not_started' && s.start <= addDays(today, 7)) {
      out.push({ id: `s-${p.id}`, title: `Ready to start: ${p.title}`, detail: wip.full ? `Planned ${shortDate(s.start)}. You're at your limit of ${wip.limit} active projects.` : `Planned ${shortDate(s.start)}`, to: `/goals/${p.id}`, tone: 'info' });
    }
  }
  return out;
}

/** Up to three project alerts as quiet tiles on the Goals page, the rest on the roadmap. */
export function ProjectAlerts() {
  const view = useView();
  const alerts = projectAlerts(view);
  if (!alerts.length) return null;
  return (
    <div className="project-alerts" role="list" aria-label="Projects that need you">
      {alerts.slice(0, 3).map((a) => (
        <a key={a.id} role="listitem" className={`project-alert ${a.tone}`} href={href(a.to)}>
          <Icon name={a.tone === 'warn' ? 'alert' : 'flag'} size={15} stroke={2.4} />
          <span className="grow stack-sm" style={{ gap: 1, minWidth: 0 }}>
            <span className="small strong">{a.title}</span>
            {a.detail && <span className="xsmall muted">{a.detail}</span>}
          </span>
          <Icon name="chevron" size={14} stroke={2.2} />
        </a>
      ))}
      {alerts.length > 3 && (
        <a className="link-btn xsmall" href={href('/goals/roadmap')} style={{ alignSelf: 'flex-start' }}>
          {alerts.length - 3} more on the roadmap
        </a>
      )}
    </div>
  );
}
