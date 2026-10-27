import { useState } from 'react';
import { hasPrize, seasonArc, shortDate, type Goal, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { groupOf } from '../data/groups.ts';
import { pathsOf } from '../data/paths.ts';
import { goalTrack } from '../data/season.ts';
import { headlineTally } from '../data/tally.ts';
import { Icon, Sheet } from './ui.tsx';

/**
 * The season card: the commitment on one page. What this season is for, the few goals it carries,
 * what done looks like for each, the dates on the way and the prizes. Read it in thirty seconds at
 * the start, on a bad day, and at the retrospective. Copy it as text or print it.
 */
export function seasonCardText(data: ReturnType<typeof useStore>['data'], view: ReturnType<typeof useView>, plan: Plan, goals: Goal[]): string {
  const lines: string[] = [];
  lines.push(`${plan.name} · ${shortDate(plan.start_date)} – ${shortDate(plan.end_date)}`);
  lines.push('');
  for (const { name, members, group } of sections(data, goals)) {
    if (name) lines.push(name.toUpperCase());
    for (const g of members) {
      const start = view.startFor(g, plan);
      const end = view.endFor(g, plan);
      const path = g.path_id ? pathsOf(data).find((p) => p.id === g.path_id) : undefined;
      lines.push(`• ${g.title} — ${shortDate(start)} → ${shortDate(end)}${path ? ` · ${path.name}` : ''}`);
      if (g.why.trim()) lines.push(`  why: ${g.why.trim()}`);
      if (g.done_means.trim()) lines.push(`  done: ${g.done_means.trim()}`);
      for (const m of view.milestonesOf(g.id)) lines.push(`  ${m.completed_at ? '◆' : '◇'} ${shortDate(m.due_date)} ${m.title}${hasPrize(m) ? ` 🎁 ${m.prize}` : ''}`);
      if (hasPrize(g)) lines.push(`  🎁 finished: ${g.prize}${g.prize_on_time?.trim() ? ` · by ${shortDate(g.target_date_at_set ?? end)}: ${g.prize_on_time}` : ''}`);
    }
    if (group && hasPrize(group)) lines.push(`  🎁 ${name} lands (${Math.round((group.prize_threshold ?? 0.85) * 100)}%): ${group.prize}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function sections(data: ReturnType<typeof useStore>['data'], goals: Goal[]) {
  const out: { name: string; members: Goal[]; group: ReturnType<typeof groupOf> }[] = [];
  for (const g of goals) {
    const group = groupOf(data, g);
    const name = group?.name ?? '';
    const have = out.find((s) => s.name === name);
    if (have) have.members.push(g);
    else out.push({ name, members: [g], group });
  }
  // Groups first, loose goals last.
  return out.sort((a, b) => Number(!a.name) - Number(!b.name));
}

export function SeasonCardButton({ plan, goals }: { plan: Plan; goals: Goal[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link-btn small" onClick={() => setOpen(true)}>
        Season card
      </button>
      {open && <SeasonCardSheet plan={plan} goals={goals} onClose={() => setOpen(false)} />}
    </>
  );
}

export function SeasonCardSheet({ plan, goals, onClose }: { plan: Plan; goals: Goal[]; onClose: () => void }) {
  const { data, today } = useStore();
  const view = useView();
  const [copied, setCopied] = useState(false);
  const arc = seasonArc(plan, today);
  const live = goals.filter((g) => !g.archived_at);
  const paths = pathsOf(data);
  const phaseWord: Record<string, string> = { before: 'before the start', start: 'the start', build: 'building', middle: 'the middle', push: 'the push', finish: 'the finish', after: 'finished' };
  const colors = live.map((g) => g.color);
  const band = colors.length > 1 ? `linear-gradient(90deg, ${colors.join(', ')})` : colors[0] ?? 'var(--gradient)';
  return (
    <Sheet title="Season card" onClose={onClose}>
      <article className="scard" aria-label={`${plan.name} season card`}>
        <div className="scard-band" style={{ background: band }} aria-hidden="true" />
        <header className="scard-head">
          <h2 className="scard-title">{plan.name}</h2>
          <span className="small muted">
            {shortDate(plan.start_date)} – {shortDate(plan.end_date)}
            {arc.phase === 'before' ? ` · starts in ${Math.max(1, Math.ceil((new Date(plan.start_date).getTime() - new Date(today).getTime()) / 86400000))} days` : arc.phase === 'after' ? ' · finished' : ` · week ${arc.week} of ${arc.weeks}, ${phaseWord[arc.phase]}`}
          </span>
          <span className="scard-count">
            {live.length} goal{live.length === 1 ? '' : 's'} · {live.filter((g) => g.completed_at).length} done
          </span>
        </header>

        {sections(data, live).map(({ name, members, group }) => (
          <section key={name || '_loose'} className="scard-section">
            {name && (
              <div className="scard-section-head">
                <span className="scard-section-name">{name}</span>
                {group && hasPrize(group) && (
                  <span className="scard-prize">
                    <Icon name="gift" size={12} stroke={2.2} /> {group.prize} <span className="muted">· if {Math.round((group.prize_threshold ?? 0.85) * 100)}% land</span>
                  </span>
                )}
              </div>
            )}
            {members.map((g) => {
              const t = goalTrack(view, g, plan);
              const path = g.path_id ? paths.find((p) => p.id === g.path_id) : undefined;
              const ms = view.milestonesOf(g.id);
              const tally = headlineTally(view, g.id, today);
              const done = !!g.completed_at;
              return (
                <div key={g.id} className="scard-goal">
                  <div className="scard-goal-head">
                    <span className="dot" style={{ background: g.color, width: 10, height: 10, flex: 'none' }} />
                    <span className="scard-goal-title" style={done ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
                      {g.title}
                    </span>
                    {path && (
                      <span className="scard-path" style={{ color: path.color }}>
                        {path.name}
                      </span>
                    )}
                  </div>
                  <div className="scard-goal-body">
                    <div className="scard-line">
                      <span className="scard-k">Done means</span>
                      <span className="scard-v">
                        {tally ? tally.m.title : t.target}
                        <span className="muted"> · by {shortDate(t.by)}</span>
                      </span>
                    </div>
                    {g.why.trim() && (
                      <div className="scard-line">
                        <span className="scard-k">Why</span>
                        <span className="scard-v scard-why">“{g.why.trim()}”</span>
                      </div>
                    )}
                    {t.started && !done && (
                      <div className="scard-line">
                        <span className="scard-k">Now</span>
                        <span className="scard-v">
                          {t.now}
                          <span className="muted"> · {t.status.toLowerCase()}</span>
                        </span>
                      </div>
                    )}
                    {ms.length > 0 && (
                      <div className="scard-line">
                        <span className="scard-k">Dates</span>
                        <span className="scard-v scard-dates">
                          {ms.map((m) => (
                            <span key={m.id} className={`scard-date${m.completed_at ? ' done' : m.due_date < today ? ' late' : ''}`}>
                              <i aria-hidden="true">{m.completed_at ? '◆' : '◇'}</i> {shortDate(m.due_date)} <span>{m.title}</span>
                              {hasPrize(m) && <Icon name="gift" size={11} stroke={2.2} />}
                            </span>
                          ))}
                        </span>
                      </div>
                    )}
                    {hasPrize(g) && (
                      <div className="scard-line">
                        <span className="scard-k">Prize</span>
                        <span className="scard-v scard-prize">
                          <Icon name="gift" size={12} stroke={2.2} /> {g.prize}
                          {g.prize_on_time?.trim() ? <span className="muted"> · {g.prize_on_time} if by {shortDate(g.target_date_at_set ?? t.by)}</span> : null}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
        {live.length === 0 && <span className="small muted">No goals in this season yet.</span>}
        <footer className="scard-foot small">{arc.line}</footer>
      </article>
      <div className="btn-row no-print">
        <button
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(seasonCardText(data, view, plan, goals));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard blocked
            }
          }}
        >
          {copied ? 'Copied' : 'Copy as text'}
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      </div>
    </Sheet>
  );
}
