import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  STATE_TEXT,
  addDays,
  burnup,
  daysBetween,
  lessons,
  shortDate,
  wouldCycle,
  type Goal,
  type ISODate,
  type Milestone,
  type ProjectState,
  type ProjectStats,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView, type View } from '../data/derive.ts';
import { opsAddProjectMilestone, opsCreateProject, opsSplitIntoMilestones, opsStartProject, wipStatus } from '../data/projects.ts';
import { href, navigate } from '../router.ts';
import { Icon, Sheet, useToast } from './ui.tsx';

/**
 * Projects under a goal: the status pill, the project lane (a light Gantt: bars on a timeline
 * with today, deadlines, forecasts and finish-to-start links), the burn-up chart, and the sheets
 * for adding and starting a project.
 */

// ---------- Status ----------

const STATE_PILL: Record<ProjectState, string> = { active: 'on_track', at_risk: 'behind', done: 'ahead', waiting: 'none', not_started: 'none', dropped: 'none' };
const STATE_ICON: Partial<Record<ProjectState, string>> = { at_risk: 'alert', done: 'check', waiting: 'link', dropped: 'x' };

/** A project's state as a pill: always an icon or a word, never colour alone. */
export function StatePill({ state, text }: { state: ProjectState; text?: string }) {
  const icon = STATE_ICON[state];
  return (
    <span className={`pill ${STATE_PILL[state]}`}>
      {icon && <Icon name={icon} size={12} stroke={2.6} />}
      {text ?? STATE_TEXT[state]}
    </span>
  );
}

/** One line for a project: "3 of 7 · forecast Jan 28 · waits on AIGP". */
export function statusLine(view: View, p: Goal, s: ProjectStats): string {
  const parts: string[] = [];
  if (s.phase === 'done') parts.push(`Done ${shortDate(p.completed_at!.slice(0, 10))}`);
  else if (s.phase === 'dropped') parts.push('Dropped');
  else if (s.state === 'waiting') parts.push(`Waits on ${s.waitingOn.map((id) => view.goal(id)?.title ?? 'a project').join(', ')}`);
  else if (s.phase === 'not_started') parts.push(`Starts ${shortDate(s.start)}`);
  if (s.total && s.phase !== 'dropped') parts.push(`${s.done} of ${s.total}`);
  else if (!s.total && s.phase === 'active') parts.push('No milestones yet');
  if (s.phase === 'active' || s.phase === 'not_started') parts.push(`ends ${shortDate(s.end)}`);
  if (s.phase === 'active' && s.forecast.date && s.forecast.date !== s.end) parts.push(`forecast ${shortDate(s.forecast.date)}`);
  return parts.join(' · ');
}

// ---------- Sizing ----------

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthStarts(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let [y, m] = start.split('-').map(Number) as [number, number];
  for (;;) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (d > end) break;
    out.push(d);
  }
  return out;
}
const monthName = (d: ISODate) => MONTHS[Number(d.slice(5, 7)) - 1]!;

// ---------- The project lane ----------

export interface LaneItem {
  project: Goal;
  stats: ProjectStats;
  color: string;
  /** Shown before the title on the season-wide roadmap (the goal it serves). */
  group?: string;
}

const ROW = 46;
const AXIS = 22;
const PAD = 10;
const BAR = 12;
const GROUP_H = 22;

/**
 * Projects on a timeline. Each bar runs from start to target; the solid part is the share done.
 * A thin line under it is the original plan (baseline) when that has moved, a dashed tail is a
 * forecast past the target, a tick is the deadline (solid when it's fixed), and an elbow arrow
 * links a project to the one it waits on. Today is the violet line. Hover a row for details;
 * tap it to open the project.
 */
export function ProjectLane({ items, range, today, label }: { items: LaneItem[]; range: { start: ISODate; end: ISODate }; today: ISODate; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!items.length) return null;
  const dates = items.flatMap(({ project: p, stats: s }) => [s.start, s.end, s.deadline, s.forecast.date, p.baseline_start, p.baseline_end].filter((d): d is ISODate => !!d));
  const lo = [range.start, ...dates].sort()[0]!;
  const hi = [range.end, ...dates].sort().at(-1)!;
  const span = Math.max(1, daysBetween(lo, hi));
  const w = Math.max(width, 280);
  const x = (d: ISODate) => PAD + (daysBetween(lo, d) / span) * (w - PAD * 2);
  // Rows, with a heading row (GROUP_H tall) each time the group changes on the season roadmap.
  const tops: number[] = [];
  const heads: { y: number; text: string }[] = [];
  let yy = AXIS;
  items.forEach((it, i) => {
    if (it.group && it.group !== items[i - 1]?.group) {
      heads.push({ y: yy, text: it.group });
      yy += GROUP_H;
    }
    tops.push(yy);
    yy += ROW;
  });
  const height = yy + 16;
  const rowY = (i: number) => tops[i]!;
  const barY = (i: number) => rowY(i) + 22;
  const index = new Map(items.map((it, i) => [it.project.id, i]));
  const months = monthStarts(lo, hi);
  const tx = x(today);
  const hovered = hover != null ? items[hover] : null;

  return (
    <div className="lane" ref={ref}>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${label}: ${items.map((it) => `${it.project.title}, ${STATE_TEXT[it.stats.state]}, ${shortDate(it.stats.start)} to ${shortDate(it.stats.end)}`).join('; ')}`}>
          <defs>
            <marker id="lane-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L8 4L0 8z" fill="var(--muted)" />
            </marker>
          </defs>
          {/* Month gridlines: hairline, recessive. */}
          {months.map((m) => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={AXIS - 4} y2={height} stroke="var(--line)" strokeWidth={1} />
              <text x={x(m) + 4} y={12} className="lane-axis">
                {monthName(m)}
              </text>
            </g>
          ))}
          {today >= lo && today <= hi && (
            <g pointerEvents="none">
              <line x1={tx} x2={tx} y1={AXIS - 6} y2={height - 14} stroke="var(--accent-ink)" strokeWidth={1.5} />
              <text x={Math.min(tx + 4, w - 38)} y={height - 3} className="lane-today">
                Today
              </text>
            </g>
          )}
          {heads.map((h) => (
            <text key={h.text} x={PAD} y={h.y + 15} className="lane-head">
              {h.text}
            </text>
          ))}
          {/* Finish-to-start links, drawn under the bars. */}
          {items.map((it, i) =>
            (it.project.depends_on ?? []).map((dep) => {
              const j = index.get(dep);
              if (j == null) return null;
              const pre = items[j]!;
              const preEnd = pre.stats.phase === 'done' ? pre.stats.forecast.date ?? pre.stats.end : pre.stats.forecast.date && pre.stats.forecast.date > pre.stats.end ? pre.stats.forecast.date : pre.stats.end;
              const x1 = x(preEnd);
              const y1 = barY(j) + BAR / 2;
              const x2 = x(it.stats.start);
              const y2 = barY(i) + BAR / 2;
              const elbow = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));
              // Starts before its predecessor is expected to end: point straight down at the clash.
              const late = x2 < x1;
              const down = y2 > y1 ? y2 - BAR / 2 - 3 : y2 + BAR / 2 + 3;
              return (
                <path
                  key={`${dep}-${it.project.id}`}
                  d={late ? `M${x1},${y1 + (y2 > y1 ? BAR / 2 : -BAR / 2)} V${down}` : `M${x1},${y1} H${elbow} V${y2} H${Math.max(x2 - 1, elbow + 2)}`}
                  fill="none"
                  stroke={late ? 'var(--amber)' : 'var(--muted)'}
                  strokeWidth={1.5}
                  markerEnd="url(#lane-arrow)"
                />
              );
            }),
          )}
          {items.map((it, i) => {
            const { project: p, stats: s } = it;
            const y = barY(i);
            const x0 = x(s.start);
            const x1 = Math.max(x(s.end), x0 + 6);
            const done = s.phase === 'done';
            const dropped = s.phase === 'dropped';
            const fill = dropped ? 'var(--faint)' : it.color;
            const prog = done ? x1 - x0 : Math.max(0, (x1 - x0) * s.fraction);
            const moved = p.baseline_start && p.baseline_end && (p.baseline_start !== s.start || p.baseline_end !== s.end);
            const forecast = s.phase === 'active' && s.forecast.date && s.forecast.date > s.end ? s.forecast.date : null;
            const late = forecast && s.deadline && forecast > s.deadline;
            const ink = dropped ? 'var(--muted)' : 'var(--ink)';
            // The title sits above the bar, kept inside the chart (shifted left when it would run off).
            // Text width estimated at ~7px a character; on a narrow screen a long title drops its state (the list below has it).
            const showState = (p.title.length + STATE_TEXT[s.state].length + 3) * 7.2 <= w - PAD * 2;
            const est = (p.title.length + (showState ? STATE_TEXT[s.state].length + 3 : 0)) * 7.2;
            const tX = Math.max(PAD, Math.min(x0, w - PAD - est));
            return (
              <g key={p.id} opacity={hover != null && hover !== i ? 0.55 : 1}>
                <text x={tX} y={rowY(i) + 14} className="lane-title" fill={ink} textDecoration={dropped ? 'line-through' : undefined}>
                  {p.title}
                  {showState && <tspan className="lane-state"> · {STATE_TEXT[s.state]}</tspan>}
                </text>
                {moved && <line x1={x(p.baseline_start!)} x2={Math.max(x(p.baseline_end!), x(p.baseline_start!) + 4)} y1={y + BAR + 5} y2={y + BAR + 5} stroke="var(--faint)" strokeWidth={2} strokeLinecap="round" />}
                <rect x={x0} y={y} width={x1 - x0} height={BAR} rx={4} fill={fill} opacity={s.phase === 'not_started' || s.state === 'waiting' ? 0.12 : 0.22} />
                {prog > 0 && <rect x={x0} y={y} width={Math.max(prog, 4)} height={BAR} rx={4} fill={fill} />}
                {forecast && (
                  <>
                    <line x1={x1} x2={x(forecast)} y1={y + BAR / 2} y2={y + BAR / 2} stroke={late ? 'var(--danger)' : 'var(--amber)'} strokeWidth={2} strokeDasharray="4 3" />
                    <circle cx={x(forecast)} cy={y + BAR / 2} r={4} fill={late ? 'var(--danger)' : 'var(--amber)'} stroke="var(--surface)" strokeWidth={2} />
                  </>
                )}
                {s.deadline && s.deadline !== s.end && (
                  <line x1={x(s.deadline)} x2={x(s.deadline)} y1={y - 3} y2={y + BAR + 3} stroke={p.fixed_deadline ? 'var(--ink)' : 'var(--muted)'} strokeWidth={2} strokeLinecap="round" strokeDasharray={p.fixed_deadline ? undefined : '2 2'} />
                )}
                {p.fixed_start && <rect x={x0 - 1} y={y - 3} width={2} height={BAR + 6} rx={1} fill="var(--ink)" />}
                {done && (
                  <g transform={`translate(${x1 - 13}, ${y + 1})`}>
                    <path d="M2 5.5l2.6 2.6L9.5 3" fill="none" stroke="var(--surface)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                )}
                <a href={href(`/goals/${p.id}`)} aria-label={`Open ${p.title}`}>
                  <rect x={0} y={rowY(i)} width={w} height={ROW} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                </a>
              </g>
            );
          })}
        </svg>
      )}
      {hovered && (
        <div className="lane-tip" style={{ top: rowY(hover!) + ROW - 2, left: Math.min(Math.max(8, x(hovered.stats.start)), Math.max(8, w - 240)) }} role="status">
          <b>{hovered.project.title}</b>
          <span>
            {STATE_TEXT[hovered.stats.state]} · {shortDate(hovered.stats.start)} – {shortDate(hovered.stats.end)}
            {hovered.stats.deadline ? ` · deadline ${shortDate(hovered.stats.deadline)}${hovered.project.fixed_deadline ? ' (fixed)' : ''}` : ''}
          </span>
          {hovered.stats.total > 0 && (
            <span>
              {hovered.stats.done} of {hovered.stats.total} milestones
              {hovered.stats.forecast.date && hovered.stats.phase === 'active' ? ` · forecast ${shortDate(hovered.stats.forecast.date)}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** What the lane's marks mean, in a quiet row under it. */
export function LaneLegend() {
  const sw = (child: ReactNode) => (
    <svg width="22" height="12" aria-hidden="true">
      {child}
    </svg>
  );
  return (
    <div className="lane-legend" aria-label="Key">
      <span>
        {sw(<><rect x="1" y="3" width="20" height="7" rx="3" fill="var(--accent)" opacity="0.22" /><rect x="1" y="3" width="11" height="7" rx="3" fill="var(--accent)" /></>)}
        Done so far
      </span>
      <span>{sw(<line x1="2" x2="20" y1="6" y2="6" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" />)}Original plan</span>
      <span>{sw(<><line x1="2" x2="16" y1="6" y2="6" stroke="var(--amber)" strokeWidth="2" strokeDasharray="4 3" /><circle cx="17" cy="6" r="3.5" fill="var(--amber)" /></>)}Forecast</span>
      <span>{sw(<line x1="11" x2="11" y1="1" y2="11" stroke="var(--ink)" strokeWidth="2" />)}Fixed date</span>
      <span>{sw(<path d="M2 3H8V9H18" fill="none" stroke="var(--muted)" strokeWidth="1.5" />)}Waits on</span>
    </div>
  );
}

// ---------- Burn-up ----------

/**
 * Burn-up: milestones done against total scope over time. The scope line rises when you add
 * milestones (scope growth stays visible), the dashed diagonal is even pace to the target, and a
 * dashed tail from today shows where the current rate lands. Hover for the numbers on any date.
 */
export function Burnup({ project, stats, milestones, color }: { project: Goal; stats: ProjectStats; milestones: Milestone[]; color: string }) {
  const { today } = useStore();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const forecast = stats.phase === 'active' ? stats.forecast.date : null;
  const lastDate = [stats.end, today, stats.deadline, forecast].filter((d): d is ISODate => !!d).sort().at(-1)!;
  const points = burnup(milestones, stats.start, lastDate, today);
  const top = Math.max(1, ...points.map((p) => p.scope));
  const H = 168;
  const m = { l: 26, r: 64, t: 34, b: 22 };
  const w = Math.max(width, 280);
  const span = Math.max(1, daysBetween(stats.start, lastDate));
  const x = (d: ISODate) => m.l + (daysBetween(stats.start, d) / span) * (w - m.l - m.r);
  const y = (v: number) => H - m.b - (v / top) * (H - m.t - m.b);
  const step = top <= 4 ? 1 : top <= 10 ? 2 : top <= 25 ? 5 : 10;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const stepped = (vals: { date: ISODate; v: number }[]) => vals.map((p, i) => (i === 0 ? `M${x(p.date)},${y(p.v)}` : `H${x(p.date)} V${y(p.v)}`)).join(' ');
  const doneVals = points.filter((p) => p.done != null).map((p) => ({ date: p.date, v: p.done! }));
  const scopeVals = points.map((p) => ({ date: p.date, v: p.scope }));
  const doneNow = doneVals.at(-1)?.v ?? 0;
  const scopeNow = points.filter((p) => p.date <= today).at(-1)?.scope ?? points[0]?.scope ?? 0;
  const late = !!forecast && forecast > (stats.deadline ?? stats.end);
  const markers: { d: ISODate; text: string; strong: boolean }[] = [{ d: stats.end, text: 'Target', strong: false }];
  if (stats.deadline && stats.deadline !== stats.end) markers.push({ d: stats.deadline, text: project.fixed_deadline ? 'Deadline (fixed)' : 'Deadline', strong: !!project.fixed_deadline });
  const hp = hover != null ? points[hover] : null;

  if (!milestones.length) return null;
  return (
    <div className="burnup" ref={ref}>
      {width > 0 && (
        <svg
          width={w}
          height={H}
          role="img"
          aria-label={`Burn-up: ${doneNow} of ${scopeNow} milestones done${forecast ? `, forecast to finish ${shortDate(forecast)}` : ''}.`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            let best = 0;
            points.forEach((p, i) => {
              if (Math.abs(x(p.date) - px) < Math.abs(x(points[best]!.date) - px)) best = i;
            });
            setHover(best);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={m.l - 6} y={y(v) + 3.5} textAnchor="end" className="lane-axis">
                {v}
              </text>
            </g>
          ))}
          {monthStarts(stats.start, lastDate).map((d) => (
            <text key={d} x={x(d)} y={H - 6} textAnchor="middle" className="lane-axis">
              {monthName(d)}
            </text>
          ))}
          {markers.map((mk, i) => (
            <g key={mk.text}>
              <line x1={x(mk.d)} x2={x(mk.d)} y1={m.t - 6} y2={H - m.b} stroke={mk.strong ? 'var(--ink)' : 'var(--muted)'} strokeWidth={1} strokeDasharray={mk.strong ? undefined : '3 3'} />
              <text x={x(mk.d)} y={i % 2 ? m.t - 20 : m.t - 8} textAnchor={x(mk.d) > w - m.r - 40 ? 'end' : 'middle'} className="lane-axis">
                {mk.text}
              </text>
            </g>
          ))}
          {/* Even pace: from nothing at the start to today's scope at the target. */}
          <line x1={x(stats.start)} y1={y(0)} x2={x(stats.end)} y2={y(scopeNow)} stroke="var(--faint)" strokeWidth={1.5} strokeDasharray="5 4" />
          <path d={stepped(scopeVals)} fill="none" stroke="var(--ink-2)" strokeWidth={2} strokeLinejoin="round" />
          {doneVals.length > 0 && (
            <>
              <path d={`${stepped(doneVals)} V${y(0)} H${x(doneVals[0]!.date)} Z`} fill={color} opacity={0.1} />
              <path d={stepped(doneVals)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            </>
          )}
          {forecast && forecast > today && (
            <line x1={x(today)} y1={y(doneNow)} x2={x(forecast)} y2={y(scopeNow)} stroke={late ? 'var(--danger)' : 'var(--amber)'} strokeWidth={2} strokeDasharray="4 3" />
          )}
          {today >= stats.start && today <= lastDate && <line x1={x(today)} x2={x(today)} y1={m.t} y2={H - m.b} stroke="var(--accent-ink)" strokeWidth={1} />}
          {today >= stats.start && <circle cx={x(today <= lastDate ? today : lastDate)} cy={y(doneNow)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />}
          {/* Direct labels at the right edge. */}
          <text x={w - m.r + 6} y={y(scopeVals.at(-1)!.v) + 4} className="lane-label">
            {scopeVals.at(-1)!.v} total
          </text>
          {today >= stats.start && (
            <text x={Math.min(x(today) + 8, w - m.r + 6)} y={Math.min(y(doneNow) + 16, H - m.b - 4)} className="lane-label">
              {doneNow} done
            </text>
          )}
          {hp && (
            <g pointerEvents="none">
              <line x1={x(hp.date)} x2={x(hp.date)} y1={m.t} y2={H - m.b} stroke="var(--ink-2)" strokeWidth={1} />
              {hp.done != null && <circle cx={x(hp.date)} cy={y(hp.done)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />}
              <circle cx={x(hp.date)} cy={y(hp.scope)} r={4} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <div className="lane-tip" style={{ top: 6, left: Math.min(Math.max(8, x(hp.date) - 70), w - 160) }} role="status">
          <b>{hp.date === today ? 'Today' : shortDate(hp.date)}</b>
          <span>{hp.done != null ? `${hp.done} done of ${hp.scope}` : `${hp.scope} planned`}</span>
        </div>
      )}
      <div className="lane-legend" aria-label="Key">
        <span>
          <svg width="18" height="10" aria-hidden="true"><line x1="1" x2="17" y1="5" y2="5" stroke={color} strokeWidth="2" /></svg>Done
        </span>
        <span>
          <svg width="18" height="10" aria-hidden="true"><line x1="1" x2="17" y1="5" y2="5" stroke="var(--ink-2)" strokeWidth="2" /></svg>Total (scope)
        </span>
        <span>
          <svg width="18" height="10" aria-hidden="true"><line x1="1" x2="17" y1="5" y2="5" stroke="var(--faint)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>Even pace
        </span>
        {forecast && forecast > today && (
          <span>
            <svg width="18" height="10" aria-hidden="true"><line x1="1" x2="17" y1="5" y2="5" stroke={late ? 'var(--danger)' : 'var(--amber)'} strokeWidth="2" strokeDasharray="4 3" /></svg>Forecast
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Lessons ----------

/** Lessons from closed projects, shown where you plan the next one. */
export function LessonsList({ limit = 3, open = false }: { limit?: number; open?: boolean }) {
  const { data } = useStore();
  const list = lessons(data.goals).slice(0, limit);
  if (!list.length) return null;
  return (
    <details className="lessons" open={open}>
      <summary className="small">Lessons from past projects · {list.length}</summary>
      {list.map((l) => (
        <div key={l.project.id} className="lesson">
          <span className="small">{l.carry || l.worked || l.didnt}</span>
          <span className="xsmall muted">
            {l.project.title} · closed {shortDate(l.on)}
          </span>
        </div>
      ))}
    </details>
  );
}

// ---------- New project ----------

/** Add a project to a goal: what it is, its dates (fixed or flexible) and what it waits on. */
export function NewProjectSheet({ goal, onClose, initialTitle = '' }: { goal: Goal; onClose: () => void; initialTitle?: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const siblings = view.projectsOf(goal.id, false);
  const plan = view.planForGoal(goal);
  const lastEnd = siblings.map((p) => p.target_date ?? '').sort().at(-1);
  const defaultStart = lastEnd && lastEnd >= today ? addDays(lastEnd, 1) : today;
  const [title, setTitle] = useState(initialTitle);
  const [done, setDone] = useState('');
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(() => {
    const e = addDays(defaultStart, 56);
    return plan && e > plan.end_date && plan.end_date > defaultStart ? plan.end_date : e;
  });
  const [deadline, setDeadline] = useState('');
  const [fixedStart, setFixedStart] = useState(false);
  const [fixedDeadline, setFixedDeadline] = useState(false);
  const [waits, setWaits] = useState<string[]>([]);
  const [steps, setSteps] = useState({ name: '', n: 0 });
  const others = view.allProjects.filter((p) => !p.dropped_at && !p.completed_at);
  const valid = title.trim() && end >= start && (!deadline || deadline >= end);

  return (
    <Sheet title={`New project for ${goal.title}`} onClose={onClose}>
      <p className="xsmall muted" style={{ margin: '-6px 0 0' }}>
        A project is work with a finish line that moves this goal: a course, an exam, a build. It's measured by its milestones and runs inside {plan ? `${plan.solo ? 'its own clock' : plan.name} (${shortDate(plan.start_date)} – ${shortDate(plan.end_date)})` : 'its goal’s window'}.
      </p>
      <LessonsList />
      <label className="field">
        Project
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pass the AIGP" autoFocus />
      </label>
      <label className="field">
        Done means
        <input value={done} onChange={(e) => setDone(e.target.value)} placeholder="e.g. Exam passed, certificate saved" />
      </label>
      <div className="grid-2">
        <label className="field">
          Starts
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          Target end
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="field">
        Deadline (optional)
        <input type="date" value={deadline} min={end} onChange={(e) => setDeadline(e.target.value)} />
        <span className="xsmall muted" style={{ fontWeight: 400 }}>
          When it truly must be done. The gap after the target is your buffer.
        </span>
      </label>
      <div className="stack-sm">
        <label className="check-row">
          <input type="checkbox" checked={fixedStart} onChange={(e) => setFixedStart(e.target.checked)} />
          <span>
            The start is fixed <span className="xsmall muted">(an outside date, like a course start)</span>
          </span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={fixedDeadline} disabled={!deadline} onChange={(e) => setFixedDeadline(e.target.checked)} />
          <span>
            The deadline is fixed <span className="xsmall muted">(a booked exam, a due date)</span>
          </span>
        </label>
      </div>
      {others.length > 0 && (
        <div className="stack-sm">
          <span className="xsmall muted">Waits on (starts when these finish)</span>
          <div className="chips" role="group" aria-label="Waits on">
            {others.map((p) => {
              const on = waits.includes(p.id);
              return (
                <button key={p.id} type="button" className="chip" aria-pressed={on} onClick={() => setWaits(on ? waits.filter((x) => x !== p.id) : [...waits, p.id])} style={{ minHeight: 34 }}>
                  <span className="dot" style={{ width: 7, height: 7, background: p.color, marginRight: 6 }} />
                  {p.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="stack-sm">
        <span className="xsmall muted">Milestones (optional now): split it into evenly spaced steps</span>
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 92px' }}>
          <input className="input" aria-label="Step name" placeholder="e.g. Module, Week, Chapter" value={steps.name} onChange={(e) => setSteps({ ...steps, name: e.target.value })} />
          <input className="input" aria-label="How many steps" type="number" min={0} max={60} placeholder="How many" value={steps.n || ''} onChange={(e) => setSteps({ ...steps, n: Math.max(0, Math.min(60, Number(e.target.value))) })} />
        </div>
      </div>
      <button
        className="btn primary"
        disabled={!valid}
        onClick={() => {
          const { ops, id } = opsCreateProject(goal, { title, done_means: done, start_date: start, target_date: end, deadline: deadline || null, fixed_start: fixedStart, fixed_deadline: fixedDeadline && !!deadline, depends_on: waits });
          if (steps.n > 0) ops.push(...opsSplitIntoMilestones(id, steps.name || 'Step', steps.n, start, end));
          commit(ops);
          toast(`${title.trim()} added to ${goal.title}`);
          onClose();
          navigate(`/goals/${id}`);
        }}
      >
        Add project
      </button>
    </Sheet>
  );
}

// ---------- Start ----------

/**
 * Start a project. It checks the two policies first: the WIP limit (how many projects can be
 * active at once) and finish-to-start (what it waits on). Either can be overridden with a
 * reason, which goes in the decision log.
 */
export function StartProjectSheet({ project, onClose }: { project: Goal; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const stats = view.projectStats(project);
  const wip = wipStatus(data);
  const waiting = stats.waitingOn.map((id) => view.goal(id)).filter((g): g is Goal => !!g);
  const blocked = wip.full || waiting.length > 0;
  const milestones = view.milestonesOf(project.id);
  return (
    <Sheet title={`Start ${project.title}`} onClose={onClose}>
      <div className="stack-sm">
        <div className="row-between small">
          <span>Active projects</span>
          <b className="num">
            {wip.active.length} of {wip.limit}
          </b>
        </div>
        <span className="wip-meter" aria-hidden="true">
          {Array.from({ length: wip.limit }, (_, i) => (
            <span key={i} className={i < wip.active.length ? (wip.full ? 'full' : 'on') : ''} />
          ))}
        </span>
        {wip.active.length > 0 && <span className="xsmall muted">{wip.active.map((p) => p.title).join(' · ')}</span>}
      </div>
      {wip.full && (
        <div className="banner warn" role="status">
          <span>You're at your limit of {wip.limit}. Finishing or dropping one first keeps each moving; starting another spreads you thinner.</span>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="banner warn" role="status">
          <span>
            It waits on {waiting.map((g) => g.title).join(' and ')}, which {waiting.length === 1 ? "isn't" : "aren't"} done yet.
          </span>
        </div>
      )}
      {!blocked && <p className="small" style={{ margin: 0 }}>It becomes active today. Its planned dates ({shortDate(project.start_date ?? today)} – {shortDate(project.target_date ?? today)}) are saved as the baseline, so later slips show against them.</p>}
      {milestones.length === 0 && <span className="xsmall muted">Tip: add milestones on its page so pace and the forecast can work.</span>}
      {blocked && (
        <label className="field">
          Why start it anyway? (saved in the decision log)
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The course start date is fixed and the exam can wait two weeks" />
        </label>
      )}
      <button
        className={`btn ${blocked ? '' : 'primary'}`}
        disabled={blocked && !reason.trim()}
        onClick={() => {
          commit(opsStartProject(data, project, today, blocked ? { reason, why: wip.full && waiting.length ? 'both' : wip.full ? 'wip' : 'waiting' } : undefined));
          toast(`${project.title} started`);
          onClose();
        }}
      >
        {blocked ? 'Start anyway' : 'Start project'}
      </button>
    </Sheet>
  );
}

/** "+ Split into steps": N evenly spaced milestones from start to target. */
export function SplitSteps({ project, stats, onDone }: { project: Goal; stats: ProjectStats; onDone: () => void }) {
  const { commit } = useStore();
  const toast = useToast();
  const [name, setName] = useState('');
  const [n, setN] = useState(4);
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (n < 1) return;
        commit(opsSplitIntoMilestones(project.id, name || 'Step', n, stats.start, stats.end));
        toast(`Added ${n} milestones`);
        onDone();
      }}
    >
      <span className="xsmall muted">
        Evenly spaced from {shortDate(stats.start)} to {shortDate(stats.end)}
      </span>
      <div className="row-start" style={{ flexWrap: 'nowrap' }}>
        <input className="input" aria-label="Step name" placeholder="Module" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="How many" type="number" min={1} max={60} value={n} onChange={(e) => setN(Number(e.target.value))} style={{ width: 76, flex: 'none' }} />
        <button className="btn small" type="submit" style={{ flex: 'none', minHeight: 44 }}>
          Add
        </button>
      </div>
    </form>
  );
}

export function AddMilestone({ projectId, defaultDate }: { projectId: string; defaultDate: ISODate }) {
  const { commit } = useStore();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(defaultDate);
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        commit(opsAddProjectMilestone(projectId, title, due));
        setTitle('');
      }}
    >
      <input className="input" placeholder="New milestone or deliverable" aria-label="New milestone" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="row-start" style={{ flexWrap: 'nowrap' }}>
        <input className="input" type="date" aria-label="Milestone date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn small" type="submit" style={{ flex: 'none' }}>
          Add milestone
        </button>
      </div>
    </form>
  );
}

/** Projects a project can wait on: any other live project that wouldn't make a loop. */
export function dependencyChoices(view: View, project: Goal): Goal[] {
  return view.allProjects.filter((p) => p.id !== project.id && !p.dropped_at && !wouldCycle(project.id, p.id, view.data.goals));
}
