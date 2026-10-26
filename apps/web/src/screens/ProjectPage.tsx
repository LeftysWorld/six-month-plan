import { useState, type ReactNode } from 'react';
import {
  STATE_TEXT,
  addDays,
  daysBetween,
  lines,
  shiftSuggestion,
  shortDate,
  type DodItem,
  type Goal,
  type ProjectStats,
  type RaidItem,
  type RaidKind,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import { opsDeleteGoal, opsToggleMilestone } from '../data/ops.ts';
import {
  loggedObstacles,
  opsAddRaid,
  opsCloseProject,
  opsDeleteMilestone,
  opsDeleteRaid,
  opsDropProject,
  opsReopenProject,
  opsSetDependencies,
  opsSetDod,
  opsSetProjectDates,
  opsShiftProject,
  opsToggleRaid,
  opsUpdateBrief,
  opsUpdateMilestone,
  raidFor,
  slipsOf,
} from '../data/projects.ts';
import { href, navigate } from '../router.ts';
import { BackLink, Icon, Sheet, useToast } from '../components/ui.tsx';
import { AddMilestone, Burnup, LessonsList, SplitSteps, StartProjectSheet, StatePill, dependencyChoices } from '../components/Projects.tsx';
import { WhyLine } from './GoalDetail.tsx';

/**
 * One page per project. Main column: where it stands (burn-up, forecast, buffer, the next step),
 * this week's tasks, milestones. Side: the brief (dates, what it waits on, scope, definition of
 * done, pre-mortem, kill criteria), the RAID log, close-out, and managing it.
 */
export function ProjectPage({ project, thisWeek }: { project: Goal; thisWeek: ReactNode }) {
  const view = useView();
  const parent = view.parentOf(project);
  const stats = view.projectStats(project);
  const [editing, setEditing] = useState<'title' | null>(null);
  const live = stats.phase === 'active' || stats.phase === 'not_started';
  return (
    <div className="stack rise">
      <BackLink label={parent?.title ?? 'Goals'} fallback={parent ? `/goals/${parent.id}` : '/goals'} />
      <div className="stack-sm" style={{ gap: 6 }}>
        <span className="mono">
          Project{parent ? (
            <>
              {' · '}
              <a href={href(`/goals/${parent.id}`)} style={{ color: 'inherit' }}>
                {parent.title}
              </a>
            </>
          ) : null}
        </span>
        <div className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span className="dot" style={{ width: 11, height: 11, flex: 'none', background: project.color }} />
          <h1 style={{ margin: 0, textDecoration: stats.phase === 'dropped' ? 'line-through' : undefined }}>{project.title}</h1>
          <button type="button" className="icon-btn title-edit" onClick={() => setEditing('title')} aria-label="Edit project name">
            <Icon name="edit" size={17} />
          </button>
        </div>
        <span className="small row-start" style={{ gap: 8, color: 'var(--muted)' }}>
          <StatePill state={stats.state} />
          <span>
            {shortDate(stats.start)} – {shortDate(stats.end)}
            {stats.deadline ? ` · deadline ${shortDate(stats.deadline)}` : ''}
          </span>
        </span>
        <WhyLine goal={project} />
      </div>

      <div className="goal-page">
        <div className="goal-page-main">
          <StatusCard project={project} stats={stats} />
          {live && thisWeek}
          <MilestonesCard project={project} stats={stats} />
        </div>
        <aside className="goal-page-side">
          <BriefCard project={project} stats={stats} />
          <RaidCard project={project} />
          <CloseoutCard project={project} stats={stats} />
          <ProjectManage project={project} stats={stats} />
        </aside>
      </div>
      {editing === 'title' && <TitleSheet project={project} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------- Where it stands ----------

function varianceText(days: number | null): string | null {
  if (days == null) return null;
  if (days === 0) return 'on the original plan';
  const w = Math.abs(days) >= 14 ? `${Math.round(Math.abs(days) / 7)} weeks` : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  return days > 0 ? `${w} later than planned` : `${w} earlier than planned`;
}

function StatusCard({ project, stats }: { project: Goal; stats: ProjectStats }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);
  const milestones = view.milestonesOf(project.id);
  const nextMs = milestones.find((m) => !m.completed_at);
  const slips = slipsOf(data, project.id);
  const predecessors = (project.depends_on ?? []).map((id) => view.goal(id)).filter((g): g is Goal => !!g && !g.dropped_at);
  const predEnds = predecessors.filter((g) => !g.completed_at).map((g) => {
    const s = view.projectStats(g);
    return s.forecast.date && s.forecast.date > s.end ? s.forecast.date : s.end;
  });
  const shift = shiftSuggestion(project, predEnds);

  let next: { label: string; sub: string; run: () => void } | null = null;
  if (stats.phase === 'not_started') {
    next = { label: 'Start project', sub: stats.waitingOn.length ? `Waits on ${stats.waitingOn.map((id) => view.goal(id)?.title).join(', ')}` : `Planned ${shortDate(stats.start)}`, run: () => setStarting(true) };
  } else if (stats.phase === 'active' && nextMs) {
    next = {
      label: `Done: ${nextMs.title}`,
      sub: `Due ${shortDate(nextMs.due_date)}${nextMs.due_date < today ? ' · past due' : ''}`,
      run: () => {
        commit(opsToggleMilestone(nextMs));
        toast(`${nextMs.title} done`, () => commit(opsToggleMilestone({ ...nextMs, completed_at: new Date().toISOString() })));
      },
    };
  } else if (stats.phase === 'active') {
    next = { label: milestones.length ? 'Close project' : 'Add milestones', sub: milestones.length ? 'Every milestone is done' : 'So pace and the forecast can work', run: () => (milestones.length ? setClosing(true) : document.getElementById('milestones')?.scrollIntoView({ behavior: 'smooth' })) };
  }

  const forecastText =
    stats.phase === 'done'
      ? `Finished ${shortDate(project.completed_at!.slice(0, 10))}`
      : stats.phase !== 'active'
        ? `Starts ${shortDate(stats.start)}`
        : stats.forecast.reason === 'rate'
          ? shortDate(stats.forecast.date!)
          : stats.forecast.reason === 'too_early'
            ? 'After the first week'
            : stats.forecast.reason === 'no_rate'
              ? 'After the first milestone'
              : stats.forecast.reason === 'too_slow'
                ? 'Not at this pace'
                : stats.forecast.reason === 'no_milestones'
                  ? 'Add milestones'
                  : '–';
  const bufferDays = stats.deadline ? daysBetween(stats.forecast.date && stats.phase === 'active' ? stats.forecast.date : stats.end, stats.deadline) : null;
  const facts: { k: string; v: string; sub?: string; warn?: boolean }[] = [
    { k: 'Forecast', v: forecastText, sub: stats.phase === 'active' ? varianceText(stats.varianceDays) ?? undefined : undefined, warn: (stats.varianceDays ?? 0) > 0 },
  ];
  if (stats.phase === 'active' && stats.total) {
    facts.push({
      k: 'Pace',
      v: stats.neededPerWeek != null ? `${fmt(stats.neededPerWeek)} a week needed` : stats.done >= stats.total ? 'All done' : 'Past the target',
      sub: stats.forecast.ratePerWeek != null ? `${fmt(stats.forecast.ratePerWeek)} a week lately` : undefined,
      warn: stats.forecast.ratePerWeek != null && stats.neededPerWeek != null && stats.forecast.ratePerWeek < stats.neededPerWeek * 0.9,
    });
  }
  if (stats.deadline) {
    facts.push({
      k: 'Buffer',
      v: stats.buffer === 'over' ? 'Past the deadline' : stats.buffer === 'using' ? 'Using buffer' : `${bufferDays} days`,
      sub: `deadline ${shortDate(stats.deadline)}${project.fixed_deadline ? ' (fixed)' : ''}`,
      warn: stats.buffer === 'over' || stats.buffer === 'using',
    });
  }
  if (project.started_at) facts.push({ k: 'Slips', v: String(slips), sub: slips ? 'target moved later' : 'target hasn’t moved', warn: slips >= 2 });

  return (
    <section className="card progress-card" aria-label="Where it stands">
      <div className="progress-top">
        <div className="stack-sm" style={{ gap: 4, minWidth: 0 }}>
          <span className="progress-now num">{stats.total ? `${stats.done} of ${stats.total}` : stats.phase === 'done' ? 'Done' : '–'}</span>
          <span className="small muted">
            {stats.total ? 'milestones' : 'no milestones yet'} · {project.done_means.trim() || 'done'} by {shortDate(stats.end)}
          </span>
        </div>
        {next && (
          <button type="button" className="next-step" onClick={next.run}>
            <b>{next.label}</b>
            <span>{next.sub}</span>
          </button>
        )}
      </div>
      {shift && (
        <div className="banner warn" role="status">
          <span>
            {predecessors.map((g) => g.title).join(' and ')} {predecessors.length === 1 ? 'is' : 'are'} now expected to end {shortDate(addDays(shift.start, -1))}. Move this project to start {shortDate(shift.start)}?
          </span>
          <button
            className="btn small"
            onClick={() => {
              commit(opsShiftProject(project, shift.days, today));
              toast(`Moved ${shift.days} day${shift.days === 1 ? '' : 's'} later${project.fixed_deadline ? '. The fixed deadline stays.' : ''}`);
            }}
          >
            Move dates
          </button>
        </div>
      )}
      {stats.overdue && <div className="banner warn">Past its target date with work left. Re-plan the dates, or decide whether to drop it.</div>}
      <div className="fact-row">
        {facts.map((f) => (
          <div key={f.k} className="fact">
            <span className="mono">{f.k}</span>
            <b style={{ color: f.warn ? 'var(--amber-ink)' : undefined }}>
              {f.warn && <Icon name="alert" size={13} stroke={2.6} />}
              {f.v}
            </b>
            {f.sub && <span className="xsmall muted">{f.sub}</span>}
          </div>
        ))}
      </div>
      <Burnup project={project} stats={stats} milestones={milestones} color={project.color} />
      {starting && <StartProjectSheet project={project} onClose={() => setStarting(false)} />}
      {closing && <CloseSheet project={project} onClose={() => setClosing(false)} />}
    </section>
  );
}

// ---------- Milestones ----------

function MilestonesCard({ project, stats }: { project: Goal; stats: ProjectStats }) {
  const { today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [splitting, setSplitting] = useState(false);
  const [deliverable, setDeliverable] = useState<{ id: string; text: string } | null>(null);
  const milestones = view.milestonesOf(project.id);
  return (
    <section className="card stack-sm" id="milestones" aria-label="Milestones">
      <div className="row-between">
        <span className="label">Milestones</span>
        <button className="link-btn small" onClick={() => setSplitting(!splitting)}>
          {splitting ? 'Cancel' : '+ Split into steps'}
        </button>
      </div>
      {splitting && <SplitSteps project={project} stats={stats} onDone={() => setSplitting(false)} />}
      {milestones.length === 0 && !splitting && <span className="small muted">Break it into steps (modules, chapters, drafts) or deliverables. Each one done moves the burn-up.</span>}
      {milestones.map((m) => (
        <div key={m.id} className="list-row" style={{ alignItems: 'flex-start' }}>
          <button
            aria-label={m.completed_at ? `${m.title} complete, tap to reopen` : `Mark ${m.title} complete`}
            onClick={() => commit(opsToggleMilestone(m))}
            style={{ width: 44, height: 44, border: 0, background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: -10, flex: 'none' }}
          >
            <span className={`ring ${m.completed_at ? 'done' : ''}`} style={{ width: 22, height: 22 }}>
              {m.completed_at && <Icon name="check" size={12} stroke={3.2} />}
            </span>
          </button>
          <div className="grow stack-sm" style={{ gap: 2, paddingTop: 10 }}>
            <div style={{ textDecoration: m.completed_at ? 'line-through' : undefined, color: m.completed_at ? 'var(--muted)' : undefined }}>{m.title}</div>
            <div className="xsmall muted">
              {shortDate(m.due_date)}
              {!m.completed_at && m.due_date < today ? <span style={{ color: 'var(--amber-ink)' }}> · past due</span> : ''}
              {m.completed_at ? ` · done ${shortDate(m.completed_at.slice(0, 10))}` : ''}
            </div>
            {deliverable?.id === m.id ? (
              <form
                className="row-start"
                style={{ flexWrap: 'nowrap', marginTop: 4 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  commit(opsUpdateMilestone(m, { deliverable: deliverable.text.trim() }));
                  setDeliverable(null);
                }}
              >
                <input className="input" autoFocus aria-label="What it produced" placeholder="A note or a link" value={deliverable.text} onChange={(e) => setDeliverable({ id: m.id, text: e.target.value })} />
                <button className="btn small" type="submit" style={{ flex: 'none', minHeight: 44 }}>
                  Save
                </button>
              </form>
            ) : m.deliverable ? (
              <button type="button" className="deliverable" onClick={() => setDeliverable({ id: m.id, text: m.deliverable ?? '' })}>
                <Icon name="flag" size={12} stroke={2.2} />
                <Linkish text={m.deliverable} />
              </button>
            ) : m.completed_at ? (
              <button type="button" className="link-btn xsmall" style={{ alignSelf: 'flex-start', minHeight: 28 }} onClick={() => setDeliverable({ id: m.id, text: '' })}>
                + What it produced
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Delete ${m.title}`}
            onClick={() => {
              commit(opsDeleteMilestone(m));
              toast(`${m.title} removed`, () => commit([{ kind: 'insert', collection: 'milestones', rows: [m as unknown as { id: string } & Record<string, unknown>] }]));
            }}
            style={{ marginTop: 6 }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      <AddMilestone projectId={project.id} defaultDate={stats.end} />
    </section>
  );
}

/** A deliverable shown as a link when it is one. */
function Linkish({ text }: { text: string }) {
  if (/^https?:\/\/\S+$/.test(text.trim())) {
    return (
      <a href={text.trim()} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {text.trim().replace(/^https?:\/\//, '').slice(0, 48)}
      </a>
    );
  }
  return <span>{text}</span>;
}

// ---------- The brief ----------

function BriefCard({ project, stats }: { project: Goal; stats: ProjectStats }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [sheet, setSheet] = useState<'dates' | 'brief' | 'deps' | null>(null);
  const [dodText, setDodText] = useState('');
  const dod = project.dod ?? [];
  const waitsOn = (project.depends_on ?? []).map((id) => view.goal(id)).filter((g): g is Goal => !!g);
  const blocks = view.allProjects.filter((p) => (p.depends_on ?? []).includes(project.id));
  const inScope = lines(project.scope_in);
  const outScope = lines(project.scope_out);
  const premortem = lines(project.premortem);
  const risks = raidFor(data, project.id, 'risk').map((r) => r.title.toLowerCase());
  const empty = !inScope.length && !outScope.length && !premortem.length && !project.kill_criteria?.trim();
  return (
    <section className="card stack-sm brief" aria-label="Project brief">
      <div className="row-between">
        <span className="label">Brief</span>
        <button className="link-btn small" onClick={() => setSheet('brief')}>
          Edit
        </button>
      </div>

      <div className="brief-block">
        <div className="row-between">
          <span className="brief-k">Dates</span>
          <button className="link-btn xsmall" onClick={() => setSheet('dates')}>
            Change
          </button>
        </div>
        <span className="small">
          {shortDate(stats.start)}
          {project.fixed_start ? <FixedMark /> : null} → {shortDate(stats.end)}
          {stats.deadline ? (
            <>
              {' '}
              · deadline {shortDate(stats.deadline)}
              {project.fixed_deadline ? <FixedMark /> : null}
            </>
          ) : null}
        </span>
        {project.baseline_end && project.baseline_end !== stats.end && (
          <span className="xsmall muted">
            Planned when started: {shortDate(project.baseline_start ?? stats.start)} → {shortDate(project.baseline_end)}
          </span>
        )}
      </div>

      <div className="brief-block">
        <div className="row-between">
          <span className="brief-k">Waits on</span>
          <button className="link-btn xsmall" onClick={() => setSheet('deps')}>
            Change
          </button>
        </div>
        {waitsOn.length ? (
          waitsOn.map((g) => (
            <a key={g.id} href={href(`/goals/${g.id}`)} className="small dep-line">
              <Icon name="link" size={12} stroke={2.2} /> {g.title} <span className="xsmall muted">· {STATE_TEXT[view.projectStats(g).state]}</span>
            </a>
          ))
        ) : (
          <span className="small muted">Nothing. It can start any time.</span>
        )}
        {blocks.length > 0 && <span className="xsmall muted">{blocks.map((g) => g.title).join(', ')} wait{blocks.length === 1 ? 's' : ''} on this one.</span>}
      </div>

      {(inScope.length > 0 || outScope.length > 0) && (
        <div className="brief-block scope">
          <div>
            <span className="brief-k">In</span>
            <ul>{inScope.length ? inScope.map((l) => <li key={l}>{l}</li>) : <li className="muted">–</li>}</ul>
          </div>
          <div>
            <span className="brief-k">Out</span>
            <ul>{outScope.length ? outScope.map((l) => <li key={l}>{l}</li>) : <li className="muted">–</li>}</ul>
          </div>
        </div>
      )}

      <div className="brief-block">
        <span className="brief-k">Definition of done</span>
        {dod.map((d, i) => (
          <label key={`${d.text}-${i}`} className="check-row small">
            <input type="checkbox" checked={d.done} onChange={() => commit(opsSetDod(project, dod.map((x, j) => (j === i ? { ...x, done: !x.done } : x))))} />
            <span style={{ textDecoration: d.done ? 'line-through' : undefined, color: d.done ? 'var(--muted)' : undefined }}>{d.text}</span>
            <button type="button" className="icon-btn" aria-label={`Remove ${d.text}`} onClick={() => commit(opsSetDod(project, dod.filter((_, j) => j !== i)))} style={{ marginLeft: 'auto', width: 28, height: 28 }}>
              <Icon name="x" size={12} />
            </button>
          </label>
        ))}
        <form
          className="row-start"
          style={{ flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!dodText.trim()) return;
            commit(opsSetDod(project, [...dod, { text: dodText, done: false }]));
            setDodText('');
          }}
        >
          <input className="input" aria-label="Add to the definition of done" placeholder={dod.length ? 'Add another' : 'e.g. Certificate saved to this project'} value={dodText} onChange={(e) => setDodText(e.target.value)} />
          <button className="btn small" type="submit" style={{ flex: 'none', minHeight: 44 }}>
            Add
          </button>
        </form>
      </div>

      {premortem.length > 0 && (
        <div className="brief-block">
          <span className="brief-k">Pre-mortem: why it could fail</span>
          {premortem.map((l) => (
            <div key={l} className="row-between small" style={{ gap: 8 }}>
              <span>{l}</span>
              {risks.includes(l.toLowerCase()) ? (
                <span className="xsmall muted" style={{ flex: 'none' }}>
                  In risks
                </span>
              ) : (
                <button
                  className="link-btn xsmall"
                  style={{ flex: 'none' }}
                  onClick={() => {
                    commit(opsAddRaid(project.id, 'risk', l));
                    toast('Added to risks. Give it a response there.');
                  }}
                >
                  Make it a risk
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {project.kill_criteria?.trim() && (
        <div className="brief-block">
          <span className="brief-k">Stop or re-plan if</span>
          <span className="small">{project.kill_criteria}</span>
        </div>
      )}

      {empty && (
        <button type="button" className="btn ghost small" onClick={() => setSheet('brief')}>
          Write the brief: scope, pre-mortem, kill criteria
        </button>
      )}

      {sheet === 'brief' && <BriefSheet project={project} onClose={() => setSheet(null)} />}
      {sheet === 'dates' && <DatesSheet project={project} onClose={() => setSheet(null)} />}
      {sheet === 'deps' && (
        <Sheet title="Waits on" onClose={() => setSheet(null)}>
          <p className="xsmall muted" style={{ margin: '-6px 0 0' }}>
            Finish-to-start: this project starts when these are done. Projects that would make a loop aren't offered.
          </p>
          <div className="chips" role="group" aria-label="Waits on">
            {dependencyChoices(view, project).map((p) => {
              const on = (project.depends_on ?? []).includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  style={{ minHeight: 34 }}
                  onClick={() => commit(opsSetDependencies(project, on ? (project.depends_on ?? []).filter((x) => x !== p.id) : [...(project.depends_on ?? []), p.id]))}
                >
                  <span className="dot" style={{ width: 7, height: 7, background: p.color, marginRight: 6 }} />
                  {p.title}
                </button>
              );
            })}
          </div>
          <button className="btn primary" onClick={() => setSheet(null)}>
            Done
          </button>
        </Sheet>
      )}
    </section>
  );
}

function FixedMark() {
  return (
    <span className="fixed-mark" title="Fixed: an outside date" aria-label="fixed">
      <Icon name="lock" size={11} stroke={2.2} />
    </span>
  );
}

function TitleSheet({ project, onClose }: { project: Goal; onClose: () => void }) {
  const { commit } = useStore();
  const [title, setTitle] = useState(project.title);
  const [done, setDone] = useState(project.done_means);
  return (
    <Sheet title="Project" onClose={onClose}>
      <label className="field">
        Name
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label className="field">
        Done means
        <input value={done} onChange={(e) => setDone(e.target.value)} />
      </label>
      <button
        className="btn primary"
        onClick={() => {
          commit(opsUpdateBrief(project, { title: title.trim() || project.title, done_means: done.trim() }));
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}

function BriefSheet({ project, onClose }: { project: Goal; onClose: () => void }) {
  const { commit } = useStore();
  const [f, setF] = useState({ scope_in: project.scope_in ?? '', scope_out: project.scope_out ?? '', premortem: project.premortem ?? '', kill_criteria: project.kill_criteria ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title="Brief" onClose={onClose}>
      <LessonsList />
      <div className="grid-2">
        <label className="field">
          In scope
          <textarea rows={4} value={f.scope_in} onChange={set('scope_in')} placeholder={'One per line\ne.g. All 22 weeks\nPersonal AI project'} />
        </label>
        <label className="field">
          Out of scope
          <textarea rows={4} value={f.scope_out} onChange={set('scope_out')} placeholder={'One per line\ne.g. A product to sell\nMarketing'} />
        </label>
      </div>
      <label className="field">
        Pre-mortem: it's {shortDate(project.target_date ?? project.start_date ?? '2026-01-01')} and this failed. Why?
        <textarea rows={4} value={f.premortem} onChange={set('premortem')} placeholder={'One reason per line\ne.g. Never booked the exam date\nJob search ate the study time'} />
        <span className="xsmall muted" style={{ fontWeight: 400 }}>
          Each reason can become a risk with one tap.
        </span>
      </label>
      <label className="field">
        Stop or re-plan if…
        <input value={f.kill_criteria} onChange={set('kill_criteria')} placeholder="e.g. The exam isn't booked by Dec 15: move it to February" />
      </label>
      <button
        className="btn primary"
        onClick={() => {
          commit(opsUpdateBrief(project, f));
          onClose();
        }}
      >
        Save brief
      </button>
    </Sheet>
  );
}

function DatesSheet({ project, onClose }: { project: Goal; onClose: () => void }) {
  const { today, commit } = useStore();
  const toast = useToast();
  const [start, setStart] = useState(project.start_date ?? today);
  const [end, setEnd] = useState(project.target_date ?? addDays(today, 56));
  const [deadline, setDeadline] = useState(project.deadline ?? '');
  const [fs, setFs] = useState(!!project.fixed_start);
  const [fd, setFd] = useState(!!project.fixed_deadline);
  const started = !!project.started_at;
  const slipping = started && project.target_date && end > project.target_date;
  return (
    <Sheet title="Dates" onClose={onClose}>
      <div className="grid-2">
        <label className="field">
          {started ? 'Started' : 'Starts'}
          <input type="date" value={start} disabled={started} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          Target end
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="field">
        Deadline (optional)
        <input type="date" value={deadline} min={end} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      <label className="check-row small">
        <input type="checkbox" checked={fs} onChange={(e) => setFs(e.target.checked)} />
        <span>The start is fixed (an outside date)</span>
      </label>
      <label className="check-row small">
        <input type="checkbox" checked={fd} disabled={!deadline} onChange={(e) => setFd(e.target.checked)} />
        <span>The deadline is fixed (an outside date)</span>
      </label>
      {slipping && <div className="banner warn">Moving the target later is recorded as a slip. That's fine: it keeps the history honest.</div>}
      {deadline && deadline < end && <span className="xsmall" style={{ color: 'var(--danger)' }}>The deadline can't be before the target.</span>}
      <button
        className="btn primary"
        disabled={end < start || (!!deadline && deadline < end)}
        onClick={() => {
          commit(opsSetProjectDates(project, { ...(started ? {} : { start_date: start }), target_date: end, deadline: deadline || null, fixed_start: fs, fixed_deadline: fd && !!deadline }, today));
          toast(slipping ? 'Saved. Logged as a slip.' : 'Dates saved');
          onClose();
        }}
      >
        Save dates
      </button>
    </Sheet>
  );
}

// ---------- RAID ----------

const RAID_TABS: { kind: RaidKind; name: string; title: string; detail: string }[] = [
  { kind: 'risk', name: 'Risks', title: 'If… then… (e.g. If the job search heats up, study time drops)', detail: 'Response: what you’ll do' },
  { kind: 'assumption', name: 'Assumptions', title: 'What you’re betting on (e.g. The PECB course can be taken online)', detail: 'How you’ll check it' },
  { kind: 'issue', name: 'Issues', title: 'What’s in the way now', detail: 'The fix' },
  { kind: 'decision', name: 'Decisions', title: 'What you decided', detail: 'Why' },
];

/** Risks, assumptions, issues and decisions. Dependencies live in the brief (Waits on). */
export function RaidCard({ project, title = 'RAID log' }: { project: Goal; title?: string }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<RaidKind>('risk');
  const [t, setT] = useState('');
  const [d, setD] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const all = raidFor(data, project.id);
  const items = all.filter((r) => r.kind === tab);
  const open = items.filter((r) => r.status === 'open');
  const closed = items.filter((r) => r.status === 'closed');
  const spec = RAID_TABS.find((x) => x.kind === tab)!;
  const fromLogs = tab === 'issue' ? loggedObstacles(data, project.id) : [];
  return (
    <section className="card stack-sm" aria-label={title}>
      <span className="label">{title}</span>
      <div className="seg raid-tabs" role="tablist" aria-label="Kind">
        {RAID_TABS.map((x) => {
          const n = all.filter((r) => r.kind === x.kind && r.status === 'open').length;
          return (
            <button key={x.kind} role="tab" aria-selected={tab === x.kind} onClick={() => setTab(x.kind)}>
              {x.name}
              {n ? <span className="raid-n">{n}</span> : null}
            </button>
          );
        })}
      </div>
      {open.length === 0 && closed.length === 0 && fromLogs.length === 0 && <span className="small muted">None yet.</span>}
      {open.map((r) => (
        <RaidRow key={r.id} item={r} />
      ))}
      {fromLogs.length > 0 && (
        <span className="xsmall muted">
          From your logs: {fromLogs.slice(0, 4).map((o) => `${o.name} ×${o.count}`).join(', ')}
        </span>
      )}
      {closed.length > 0 && (
        <button className="link-btn xsmall" style={{ alignSelf: 'flex-start' }} onClick={() => setShowClosed(!showClosed)}>
          {showClosed ? 'Hide' : 'Show'} {tab === 'decision' ? 'archived' : 'closed'} ({closed.length})
        </button>
      )}
      {showClosed && closed.map((r) => <RaidRow key={r.id} item={r} />)}
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!t.trim()) return;
          commit(opsAddRaid(project.id, tab, t, d));
          setT('');
          setD('');
          toast(`${spec.name.slice(0, -1)} added`);
        }}
      >
        <input className="input" aria-label={spec.title} placeholder={spec.title} value={t} onChange={(e) => setT(e.target.value)} />
        {t.trim() && <input className="input" aria-label={spec.detail} placeholder={spec.detail} value={d} onChange={(e) => setD(e.target.value)} />}
        {t.trim() && (
          <button className="btn small" type="submit" style={{ alignSelf: 'flex-start' }}>
            Add
          </button>
        )}
      </form>
    </section>
  );
}

function RaidRow({ item }: { item: RaidItem }) {
  const { commit } = useStore();
  const toast = useToast();
  const closed = item.status === 'closed';
  const decision = item.kind === 'decision';
  return (
    <div className="raid-row">
      {!decision && (
        <button type="button" className={`ring ${closed ? 'done' : ''}`} aria-label={closed ? `Reopen ${item.title}` : `Close ${item.title}`} onClick={() => commit(opsToggleRaid(item))} style={{ width: 20, height: 20, flex: 'none', marginTop: 2, cursor: 'pointer' }}>
          {closed && <Icon name="check" size={11} stroke={3.2} />}
        </button>
      )}
      <div className="grow stack-sm" style={{ gap: 2 }}>
        <span className="small" style={{ textDecoration: closed && !decision ? 'line-through' : undefined, color: closed ? 'var(--muted)' : undefined }}>
          {item.title}
        </span>
        {item.detail && <span className="xsmall muted">{decision ? 'Why: ' : item.kind === 'risk' ? 'Response: ' : item.kind === 'assumption' ? 'Check: ' : 'Fix: '}{item.detail}</span>}
        {decision && <span className="xsmall muted">{shortDate(item.created_at.slice(0, 10))}</span>}
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Delete ${item.title}`}
        onClick={() => {
          commit(opsDeleteRaid(item));
          toast('Removed', () => commit([{ kind: 'insert', collection: 'raidItems', rows: [item as unknown as { id: string } & Record<string, unknown>] }]));
        }}
        style={{ width: 28, height: 28 }}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

// ---------- Close-out ----------

function CloseoutCard({ project, stats }: { project: Goal; stats: ProjectStats }) {
  const { today, commit } = useStore();
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  const [closing, setClosing] = useState(false);
  const c = project.closeout;
  if (stats.phase === 'active' || stats.phase === 'not_started') {
    if (stats.phase === 'not_started') return null;
    return (
      <>
        <button type="button" className="btn ghost" onClick={() => setClosing(true)}>
          Close project…
        </button>
        {closing && <CloseSheet project={project} onClose={() => setClosing(false)} />}
      </>
    );
  }
  if (stats.phase === 'dropped') return null;
  if (!c) {
    return (
      <>
        <button type="button" className="add-project-hint" onClick={() => setClosing(true)}>
          <span>
            <b>Write the close-out</b>
            <span>Three questions while it's fresh: what worked, what didn't, what to carry into the next project.</span>
          </span>
        </button>
        {closing && <CloseSheet project={project} onClose={() => setClosing(false)} />}
      </>
    );
  }
  const due = project.benefit_check_on && project.benefit_check_on <= today;
  return (
    <section className="card stack-sm" aria-label="Close-out">
      <span className="label">Close-out · {shortDate(c.closed_on)}</span>
      {c.worked && (
        <span className="small">
          <b>Worked:</b> {c.worked}
        </span>
      )}
      {c.didnt && (
        <span className="small">
          <b>Didn't:</b> {c.didnt}
        </span>
      )}
      {c.carry && (
        <span className="small">
          <b>Carry forward:</b> {c.carry}
        </span>
      )}
      {project.benefit_question?.trim() && (
        <div className="brief-block">
          <span className="brief-k">Benefits check{project.benefit_check_on ? ` · ${shortDate(project.benefit_check_on)}` : ''}</span>
          <span className="small">{project.benefit_question}</span>
          {project.benefit_result?.trim() ? (
            <span className="small" style={{ color: 'var(--ink-2)' }}>
              → {project.benefit_result}
            </span>
          ) : due ? (
            <form
              className="row-start"
              style={{ flexWrap: 'nowrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!answer.trim()) return;
                commit(opsUpdateBrief(project, { benefit_result: answer.trim() }));
                toast('Answer saved');
              }}
            >
              <input className="input" autoFocus aria-label="Your answer" placeholder="What actually happened?" value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <button className="btn small" type="submit" style={{ flex: 'none', minHeight: 44 }}>
                Save
              </button>
            </form>
          ) : (
            <span className="xsmall muted">You'll be asked on {shortDate(project.benefit_check_on ?? today)}.</span>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Close a project: tick the definition of done, answer three questions (what worked, what
 * didn't, what to carry into the next project), and set a benefits check-back so the credential
 * or deliverable is checked against the outcome it was for.
 */
export function CloseSheet({ project, onClose }: { project: Goal; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const parent = view.parentOf(project);
  const [dod, setDod] = useState<DodItem[]>(project.dod ?? []);
  const [worked, setWorked] = useState('');
  const [didnt, setDidnt] = useState('');
  const [carry, setCarry] = useState('');
  const [question, setQuestion] = useState(parent ? `Did ${project.title} move “${parent.title}” forward?` : '');
  const [on, setOn] = useState(addDays(today, 60));
  const open = dod.filter((d) => !d.done);
  const left = view.milestonesOf(project.id).filter((m) => !m.completed_at).length;
  return (
    <Sheet title={`Close ${project.title}`} onClose={onClose}>
      {left > 0 && <div className="banner warn">{left} milestone{left === 1 ? '' : 's'} still open. Closing marks the project done anyway.</div>}
      {dod.length > 0 && (
        <div className="stack-sm">
          <span className="label">Definition of done</span>
          {dod.map((d, i) => (
            <label key={`${d.text}-${i}`} className="check-row small">
              <input type="checkbox" checked={d.done} onChange={() => setDod(dod.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
              <span>{d.text}</span>
            </label>
          ))}
        </div>
      )}
      <label className="field">
        What worked?
        <textarea rows={2} value={worked} onChange={(e) => setWorked(e.target.value)} />
      </label>
      <label className="field">
        What didn't?
        <textarea rows={2} value={didnt} onChange={(e) => setDidnt(e.target.value)} />
      </label>
      <label className="field">
        What will you carry into the next project?
        <textarea rows={2} value={carry} onChange={(e) => setCarry(e.target.value)} placeholder="This is shown when you plan your next project." />
      </label>
      <div className="stack-sm">
        <span className="label">Benefits check</span>
        <span className="xsmall muted">A credential or a deliverable isn't the goal. Pick a day to check it paid off.</span>
        <input className="input" aria-label="Question to ask later" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <input className="input" type="date" aria-label="When to ask" value={on} min={today} onChange={(e) => setOn(e.target.value)} />
      </div>
      <button
        className={`btn ${open.length ? '' : 'primary'}`}
        onClick={() => {
          const ops = [...opsSetDod(project, dod)];
          const res = opsCloseProject(data, project, { worked, didnt, carry }, { question, on }, today);
          commit([...ops, ...res.ops]);
          toast(res.ready.length ? `${project.title} closed. ${res.ready.map((g) => g.title).join(', ')} can start now.` : `${project.title} closed`);
          onClose();
        }}
      >
        {open.length ? `Close with ${open.length} unticked` : 'Close project'}
      </button>
    </Sheet>
  );
}

// ---------- Manage ----------

function ProjectManage({ project, stats }: { project: Goal; stats: ProjectStats }) {
  const { data, today, commit, db } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [reason, setReason] = useState('');
  const parent = view.parentOf(project);
  const history = data.changeLog.filter((c) => c.entity_id === project.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <div className="card manage-card">
      <button type="button" className="manage-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Manage project</span>
        <span style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', display: 'inline-flex' }}>
          <Icon name="chevron" size={16} stroke={2.2} />
        </span>
      </button>
      {open && (
        <div className="stack-sm" style={{ padding: '0 16px 14px' }}>
          {history.length > 0 && (
            <details className="card tight">
              <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
                Change history · {history.length}
              </summary>
              {history.map((c) => (
                <div key={c.id} className="list-row small">
                  <span className="grow">{c.summary}</span>
                  <span className="xsmall muted">{shortDate(c.effective_from)}</span>
                </div>
              ))}
            </details>
          )}
          {(stats.phase === 'done' || stats.phase === 'dropped') && (
            <button
              className="btn small"
              onClick={() => {
                commit(opsReopenProject(data, project));
                toast(`${project.title} reopened`);
              }}
            >
              Reopen project
            </button>
          )}
          {(stats.phase === 'active' || stats.phase === 'not_started') &&
            (dropping ? (
              <div className="stack-sm">
                <label className="field">
                  Why drop it? (saved in the decision log)
                  <input value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="e.g. Job offer covers this; not worth the time now" />
                </label>
                <div className="btn-row">
                  <button
                    className="btn small danger"
                    disabled={!reason.trim()}
                    onClick={() => {
                      commit(opsDropProject(data, project, reason, today));
                      toast(`${project.title} dropped. It no longer counts toward ${parent?.title ?? 'its goal'}.`);
                      setDropping(false);
                    }}
                  >
                    Drop project
                  </button>
                  <button className="btn small" onClick={() => setDropping(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="link-btn small" style={{ alignSelf: 'flex-start', color: 'var(--amber-ink)', paddingLeft: 0 }} onClick={() => setDropping(true)}>
                Drop project…
              </button>
            ))}
          <button
            className="link-btn small"
            style={{ color: 'var(--danger)', alignSelf: 'flex-start', paddingLeft: 0 }}
            onClick={() => {
              if (!window.confirm(`Delete ${project.title} for good? Its tasks, logs, milestones and RAID log go too.`)) return;
              const { ops, files } = opsDeleteGoal(data, project);
              commit(ops);
              void db.files.remove(files).catch(() => {});
              toast(`${project.title} deleted`);
              navigate(parent ? `/goals/${parent.id}` : '/goals');
            }}
          >
            Delete project
          </button>
        </div>
      )}
    </div>
  );
}
