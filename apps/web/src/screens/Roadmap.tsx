import { column, shortDate, type Goal } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { seasonsOf } from '../data/season.ts';
import { wipStatus } from '../data/projects.ts';
import { href } from '../router.ts';
import { Icon } from '../components/ui.tsx';
import { LaneLegend, LessonsList, ProjectLane, StatePill, type LaneItem } from '../components/Projects.tsx';
import { projectAlerts } from '../components/ProjectsCard.tsx';
import { GoalsSwitch } from './Backlog.tsx';

/**
 * The roadmap: Now (this season's goals and their projects on one timeline), Next (next season
 * and projects that start after this one), Later (the backlog). Plus what needs you, how many
 * projects are active against the limit, the lessons from closed projects and recent decisions.
 */
export function Roadmap() {
  const { data, today } = useStore();
  const view = useView();
  const seasons = seasonsOf(view);
  const current = seasons.current;
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const wip = wipStatus(data);
  const alerts = projectAlerts(view);

  // Now: goals running this season (batch or own clock that runs now), with their projects.
  const nowGoals = view.activeGoals.filter((g) => {
    const p = view.planForGoal(g);
    return !!p && p.start_date <= today && p.end_date >= today;
  });
  const laneItems: LaneItem[] = nowGoals.flatMap((g) =>
    view.projectsOf(g.id).filter((p) => !p.dropped_at && (!p.start_date || !current || p.start_date <= current.end_date)).map((p) => ({ project: p, stats: view.projectStats(p), color: g.color, group: g.title })),
  );
  const withoutProjects = nowGoals.filter((g) => !view.hasProjects(g.id));

  // Next: goals in the next season, and projects that start after this season ends.
  const nextGoals = seasons.next ? view.goalsForPlan(seasons.next.id) : [];
  const laterProjects = current ? view.allProjects.filter((p) => !p.started_at && !p.dropped_at && !p.completed_at && p.start_date && p.start_date > current.end_date) : [];
  const selected = column(data.ideas, 'selected');
  const backlog = column(data.ideas, 'backlog');
  const decisions = (data.raidItems ?? [])
    .filter((r) => r.kind === 'decision')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {wip.active.length} active project{wip.active.length === 1 ? '' : 's'}
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Roadmap</h1>
      <GoalsSwitch current="roadmap" />

      <section className="card stack-sm" aria-label="Now">
        <div className="row-between">
          <span className="roadmap-head">
            <span className="mono">Now</span>
            <b>{current ? `This season · ${shortDate(current.start_date)} – ${shortDate(current.end_date)}` : 'This season'}</b>
          </span>
          <a className="wip-chip" href={href('/settings')} title="Projects active at once (change the limit in Settings)" aria-label={`${wip.active.length} of ${wip.limit} active projects. Change the limit in Settings.`}>
            <span className="wip-meter small-meter" aria-hidden="true">
              {Array.from({ length: wip.limit }, (_, i) => (
                <span key={i} className={i < wip.active.length ? (wip.full ? 'full' : 'on') : ''} />
              ))}
            </span>
            {wip.active.length}/{wip.limit} active
          </a>
        </div>
        {laneItems.length ? (
          <>
            <ProjectLane items={laneItems} range={{ start: current?.start_date ?? today, end: current?.end_date ?? today }} today={today} label="This season's projects" />
            <LaneLegend />
          </>
        ) : (
          <span className="small muted">No projects this season yet. On a goal's page, "Add a project" breaks a goal into the courses, exams and builds that reach it.</span>
        )}
        {withoutProjects.length > 0 && (
          <span className="xsmall muted">
            Also this season, run by daily tasks: {withoutProjects.map((g, i) => (
              <span key={g.id}>
                {i ? ', ' : ''}
                <a href={href(`/goals/${g.id}`)}>{g.title}</a>
              </span>
            ))}
            .
          </span>
        )}
      </section>

      {alerts.length > 0 && (
        <section className="card stack-sm" aria-label="Needs you">
          <span className="label">Needs you</span>
          {alerts.map((a) => (
            <a key={a.id} className="roadmap-item" href={href(a.to)}>
              <Icon name={a.tone === 'warn' ? 'alert' : 'flag'} size={15} stroke={2.4} />
              <span className="grow stack-sm" style={{ gap: 1 }}>
                <span className="small strong">{a.title}</span>
                {a.detail && <span className="xsmall muted">{a.detail}</span>}
              </span>
              <Icon name="chevron" size={14} stroke={2.2} />
            </a>
          ))}
        </section>
      )}

      <div className="roadmap-cols">
        <section className="card stack-sm" aria-label="Next">
          <span className="roadmap-head">
            <span className="mono">Next</span>
            <b>{seasons.next ? `Next season · from ${shortDate(seasons.next.start_date)}` : 'Next season'}</b>
          </span>
          {nextGoals.length === 0 && laterProjects.length === 0 && selected.length === 0 && (
            <span className="small muted">Nothing lined up yet. Select ideas in the backlog, or plan next season on the Goals page.</span>
          )}
          {nextGoals.map((g) => (
            <GoalLine key={g.id} goal={g} sub="Goal in next season" />
          ))}
          {laterProjects.map((p) => (
            <a key={p.id} className="roadmap-item" href={href(`/goals/${p.id}`)}>
              <span className="dot" style={{ background: p.color }} />
              <span className="grow stack-sm" style={{ gap: 1 }}>
                <span className="small strong">{p.title}</span>
                <span className="xsmall muted">
                  Project · {view.parentOf(p)?.title} · starts {shortDate(p.start_date!)}
                </span>
              </span>
              <StatePill state={view.projectStats(p).state} />
            </a>
          ))}
          {selected.map((i) => (
            <a key={i.id} className="roadmap-item" href={href('/goals/backlog')}>
              <Icon name="sparkle" size={14} stroke={2} />
              <span className="grow stack-sm" style={{ gap: 1 }}>
                <span className="small strong">{i.title}</span>
                <span className="xsmall muted">Selected for next commitment</span>
              </span>
            </a>
          ))}
        </section>

        <section className="card stack-sm" aria-label="Later">
          <div className="row-between">
            <span className="roadmap-head">
              <span className="mono">Later</span>
              <b>The backlog</b>
            </span>
            <a className="link-btn small" href={href('/goals/backlog')} style={{ display: 'inline-flex', alignItems: 'center' }}>
              Open
            </a>
          </div>
          {backlog.length === 0 && <span className="small muted">Empty. Ideas you write down wait here, most important first.</span>}
          {backlog.slice(0, 6).map((i, n) => (
            <a key={i.id} className="roadmap-item" href={href('/goals/backlog')}>
              <span className="mono" style={{ width: 16 }}>
                {n + 1}
              </span>
              <span className="grow small">{i.title}</span>
            </a>
          ))}
          {backlog.length > 6 && <span className="xsmall muted">and {backlog.length - 6} more</span>}
        </section>
      </div>

      <div className="roadmap-cols">
        <section className="card stack-sm" aria-label="Lessons learned">
          <span className="label">Lessons learned</span>
          <LessonsList limit={12} open />
          {!data.goals.some((g) => g.closeout) && <span className="small muted">When you close a project you answer three questions. What to carry forward shows up here, and when you plan the next project.</span>}
        </section>
        <section className="card stack-sm" aria-label="Recent decisions">
          <span className="label">Recent decisions</span>
          {decisions.length === 0 && <span className="small muted">Decisions you log on goals and projects (and starting a project over the limit) show up here.</span>}
          {decisions.map((d) => {
            const on = view.goal(d.goal_id);
            return (
              <a key={d.id} className="roadmap-item" href={on ? href(`/goals/${on.id}`) : undefined} style={{ alignItems: 'flex-start' }}>
                <span className="grow stack-sm" style={{ gap: 1 }}>
                  <span className="small">{d.title}</span>
                  {d.detail && <span className="xsmall muted">Why: {d.detail}</span>}
                  <span className="xsmall muted">
                    {shortDate(d.created_at.slice(0, 10))}
                    {on ? ` · ${on.title}` : ''}
                  </span>
                </span>
              </a>
            );
          })}
        </section>
      </div>
    </div>
  );
}

function GoalLine({ goal, sub }: { goal: Goal; sub: string }) {
  return (
    <a className="roadmap-item" href={href(`/goals/${goal.id}`)}>
      <span className="dot" style={{ background: goal.color }} />
      <span className="grow stack-sm" style={{ gap: 1 }}>
        <span className="small strong">{goal.title}</span>
        <span className="xsmall muted">{sub}</span>
      </span>
      <Icon name="chevron" size={14} stroke={2.2} />
    </a>
  );
}
