import { useState } from 'react';
import { shortDate, type WeekPoint } from '@six/core';
import { fmt, minutesText } from '../data/derive.ts';

/**
 * Weekly completion as thin bars (one per week, oldest first). Bars under 75% use the
 * "behind" colour and every bar has a tooltip; the latest week is labelled directly.
 */
export function TrendBars({ weeks: all, height = 64, highlight }: { weeks: WeekPoint[]; height?: number; highlight?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Weeks before anything was planned (e.g. before the plan started) are left out.
  const first = all.findIndex((w) => w.rate != null);
  const weeks = first > 0 ? all.slice(first) : all;
  const judged = weeks.filter((w) => w.rate != null);
  if (judged.length === 0) return <span className="xsmall muted">No finished weeks yet.</span>;
  const avg = judged.reduce((sum, w) => sum + Math.min(1, w.rate!), 0) / judged.length;
  const pct = (r: number | null) => (r == null ? '–' : `${Math.round(Math.min(1, r) * 100)}%`);
  const shown = hover != null ? weeks[hover]! : weeks[weeks.length - 1]!;
  const summary = weeks.map((w) => `Week of ${shortDate(w.monday)}: ${w.rate == null ? 'nothing planned' : `${pct(w.rate)} (${fmt(w.credit, 0)} of ${w.planned})`}`).join('. ');
  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      <div className="row-between xsmall" style={{ color: 'var(--ink-2)' }}>
        <span>
          {hover != null ? `Week of ${shortDate(shown.monday)}` : 'Latest week'}:{' '}
          <b style={{ color: 'var(--ink)' }}>{pct(shown.rate)}</b>
          {shown.rate != null ? ` · ${fmt(shown.credit, 0)} of ${shown.planned}` : ''}
          {shown.minutesDone ? ` · ${minutesText(shown.minutesDone)}` : ''}
        </span>
        <span>Average {Math.round(avg * 100)}%</span>
      </div>
      <div
        role="img"
        aria-label={`Weekly completion, average ${Math.round(avg * 100)}%. ${summary}`}
        style={{ position: 'relative', height, display: 'flex', alignItems: 'flex-end', gap: 2 }}
        onMouseLeave={() => setHover(null)}
      >
        {/* 75% guide: below it a week counts as short. */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.75, borderTop: '1px dashed var(--line-2, var(--line))' }} aria-hidden="true" />
        {weeks.map((w, i) => {
          const value = w.rate == null ? 0 : Math.min(1, w.rate);
          const short = w.rate != null && w.rate < 0.75;
          const isHighlight = highlight ? w.monday === highlight : i === weeks.length - 1;
          return (
            <button
              key={w.monday}
              type="button"
              aria-label={`Week of ${shortDate(w.monday)}: ${w.rate == null ? 'nothing planned' : pct(w.rate)}`}
              title={`Week of ${shortDate(w.monday)}: ${w.rate == null ? 'nothing planned' : `${pct(w.rate)} · ${fmt(w.credit, 0)} of ${w.planned}`}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(i)}
              style={{ flex: 1, height: '100%', border: 0, padding: 0, background: 'none', display: 'flex', alignItems: 'flex-end', cursor: 'default' }}
            >
              <span
                style={{
                  display: 'block',
                  width: '100%',
                  height: w.rate == null ? 2 : `${Math.max(4, value * 100)}%`,
                  borderRadius: '4px 4px 0 0',
                  background: w.rate == null ? 'var(--track)' : short ? 'var(--amber)' : 'var(--accent)',
                  opacity: hover == null ? (isHighlight ? 1 : 0.55) : hover === i ? 1 : 0.4,
                  transition: 'opacity 0.15s',
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="row-between mono" style={{ fontSize: 10 }}>
        <span>{shortDate(weeks[0]!.monday)}</span>
        <span>{shortDate(weeks[weeks.length - 1]!.monday)}</span>
      </div>
    </div>
  );
}
