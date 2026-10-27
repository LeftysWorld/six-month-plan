import { useState } from 'react';
import { hasPrize, seasonArc, shortDate, type Goal, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { groupOf } from '../data/groups.ts';
import { pathsOf } from '../data/paths.ts';
import { Sheet } from './ui.tsx';

/**
 * The season card: the whole season on one page you can save, print or paste — goals with their
 * dates and prizes, grouped, with the path each is a bet on and the line you'll read on bad days.
 * Made at the start of a season (and any time after), it is the commitment in a form you can show.
 */
export function seasonCardText(data: ReturnType<typeof useStore>['data'], view: ReturnType<typeof useView>, plan: Plan, goals: Goal[]): string {
  const lines: string[] = [];
  lines.push(`${plan.name} · ${shortDate(plan.start_date)} – ${shortDate(plan.end_date)}`);
  lines.push('');
  const groups = new Map<string, Goal[]>();
  for (const g of goals) {
    const grp = groupOf(data, g);
    const key = grp?.name ?? '';
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  for (const [name, members] of groups) {
    if (name) lines.push(name.toUpperCase());
    const grp = members[0] ? groupOf(data, members[0]) : undefined;
    for (const g of members) {
      const start = view.startFor(g, plan);
      const end = view.endFor(g, plan);
      const path = g.path_id ? pathsOf(data).find((p) => p.id === g.path_id) : undefined;
      lines.push(`• ${g.title} — ${shortDate(start)} → ${shortDate(end)}${path ? ` · ${path.name}` : ''}`);
      if (g.why.trim()) lines.push(`  why: ${g.why.trim()}`);
      if (g.done_means.trim()) lines.push(`  done: ${g.done_means.trim()}`);
      const ms = view.milestonesOf(g.id);
      for (const m of ms) lines.push(`  ◇ ${shortDate(m.due_date)} ${m.title}${m.value != null ? ` (${m.value}${g.unit ? ` ${g.unit}` : ''})` : ''}${hasPrize(m) ? ` 🎁 ${m.prize}` : ''}`);
      if (hasPrize(g)) lines.push(`  🎁 finished: ${g.prize}${g.prize_on_time?.trim() ? ` · by ${shortDate(g.target_date_at_set ?? end)}: ${g.prize_on_time}` : ''}`);
    }
    if (grp && hasPrize(grp)) lines.push(`  🎁 ${name} lands (${Math.round((grp.prize_threshold ?? 0.85) * 100)}%): ${grp.prize}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
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
  const text = seasonCardText(data, view, plan, goals);
  const arc = seasonArc(plan, today);
  return (
    <Sheet title="Season card" onClose={onClose}>
      <span className="xsmall muted">
        The whole season on one page: print it, save it as a PDF, or paste the text somewhere you’ll see it. Week {arc.week} of {arc.weeks}.
      </span>
      <pre className="season-card-text">{text}</pre>
      <div className="btn-row no-print">
        <button
          className="btn primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard blocked
            }
          }}
        >
          {copied ? 'Copied' : 'Copy text'}
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      </div>
    </Sheet>
  );
}
