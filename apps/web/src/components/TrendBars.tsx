import { useState } from 'react';
import { shortDate, type WeekPoint } from '@six/core';
import { fmt, minutesText } from '../data/derive.ts';

/**
 * Weekly completion as bars, one slot per week (oldest first), so a plan with only two weeks
 * of history shows two bars in an eight-week frame rather than two giant blocks. Weeks with
 * nothing to judge (before the plan, or nothing planned) are faint stubs. A dashed line marks
 * 75%: below it a week counts as short and uses the "behind" colour.
 */
export function TrendBars({ weeks, height = 72, highlight }: { weeks: WeekPoint[]; height?: number; highlight?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const judged = weeks.filter((w) => w.rate != null);
  if (judged.length === 0) return <span className="xsmall muted">Your first finished week shows up here.</span>;
  const avg = judged.reduce((sum, w) => sum + Math.min(1, w.rate!), 0) / judged.length;
  const pct = (r: number | null) => (r == null ? '–' : `${Math.round(Math.min(1, r) * 100)}%`);
  const lastJudged = weeks.reduce((best, w, i) => (w.rate != null ? i : best), -1);
  const shownIndex = hover ?? (highlight ? weeks.findIndex((w) => w.monday === highlight) : lastJudged);
  const shown = weeks[shownIndex >= 0 ? shownIndex : lastJudged]!;
  const summary = judged.map((w) => `Week of ${shortDate(w.monday)}: ${pct(w.rate)} (${fmt(w.credit, 0)} of ${w.planned})`).join('. ');
  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      <div className="row-between xsmall" style={{ color: 'var(--ink-2)', gap: 8 }}>
        <span>
          Week of {shortDate(shown.monday)}: <b style={{ color: 'var(--ink)' }}>{pct(shown.rate)}</b>
          {shown.rate != null ? ` · ${fmt(shown.credit, 0)} of ${shown.planned}` : ' · nothing to judge'}
          {shown.minutesDone ? ` · ${minutesText(shown.minutesDone)}` : ''}
        </span>
        <span style={{ whiteSpace: 'nowrap' }}>
          Avg {Math.round(avg * 100)}% · {judged.length} wk
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 6 }}>
        <div className="mono" style={{ position: 'relative', height, fontSize: 9.5 }} aria-hidden="true">
          <span style={{ position: 'absolute', top: -5, right: 0 }}>100</span>
          <span style={{ position: 'absolute', top: height * 0.25 - 5, right: 0 }}>75</span>
        </div>
        <div
          role="img"
          aria-label={`Weekly completion, average ${Math.round(avg * 100)}% over ${judged.length} week${judged.length === 1 ? '' : 's'}. ${summary}`}
          style={{ position: 'relative', height, display: 'grid', gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`, gap: 6, alignItems: 'end' }}
          onMouseLeave={() => setHover(null)}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, borderTop: '1px solid var(--line)' }} aria-hidden="true" />
          <div style={{ position: 'absolute', left: 0, right: 0, top: height * 0.25, borderTop: '1px dashed var(--border-strong, var(--line))' }} aria-hidden="true" />
          {weeks.map((w, i) => {
            const value = w.rate == null ? 0 : Math.min(1, w.rate);
            const short = w.rate != null && w.rate < 0.75;
            const isShown = i === shownIndex;
            return (
              <button
                key={w.monday}
                type="button"
                aria-label={`Week of ${shortDate(w.monday)}: ${w.rate == null ? 'nothing to judge' : pct(w.rate)}`}
                title={`Week of ${shortDate(w.monday)}: ${w.rate == null ? 'nothing to judge' : `${pct(w.rate)} · ${fmt(w.credit, 0)} of ${w.planned}`}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(i)}
                style={{ height: '100%', border: 0, padding: 0, background: 'none', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default' }}
              >
                <span
                  style={{
                    display: 'block',
                    width: '100%',
                    maxWidth: 36,
                    height: w.rate == null ? 3 : `${Math.max(4, value * 100)}%`,
                    borderRadius: '5px 5px 2px 2px',
                    background: w.rate == null ? 'var(--track)' : short ? 'var(--amber)' : 'var(--accent)',
                    opacity: w.rate == null ? 1 : isShown ? 1 : 0.55,
                    transition: 'opacity 0.15s',
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 6 }}>
        <span />
        <div className="row-between mono" style={{ fontSize: 10 }}>
          <span>{shortDate(weeks[0]!.monday)}</span>
          <span>{shortDate(weeks[weeks.length - 1]!.monday)}</span>
        </div>
      </div>
    </div>
  );
}
