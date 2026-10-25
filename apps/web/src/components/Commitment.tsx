import { useState } from 'react';
import { addDays, shortDate, weekStart, type ISODate, type Review } from '@six/core';
import { readCheck, writeCheck, type CommitmentCheck } from '../data/insights.ts';

/**
 * The one change you said you'd make this week, with a light "On it / Slipping" check.
 * Shown on Today and in Review so the change shapes the week, not just the next review.
 */
export function CommitmentCard({ review, text, forWeek, today, compact = false }: { review: Review; text: string; forWeek: ISODate; today: ISODate; compact?: boolean }) {
  const [check, setCheck] = useState<CommitmentCheck | null>(() => readCheck(review.id));
  const upcoming = forWeek > weekStart(today);
  const pick = (v: CommitmentCheck) => {
    const next = check === v ? null : v;
    writeCheck(review.id, next);
    setCheck(next);
  };
  return (
    <div className={`card stack-sm${compact ? ' tight' : ''}`} style={{ gap: 8 }}>
      <span className="label" style={{ color: 'var(--accent-ink)' }}>
        {upcoming ? `Next week's change · from ${shortDate(forWeek)}` : `This week's change · through ${shortDate(addDays(forWeek, 6))}`}
      </span>
      <p style={{ margin: 0, fontSize: compact ? 15 : 17, lineHeight: 1.35, fontWeight: 550, letterSpacing: '-0.01em' }}>{text}</p>
      {!upcoming && (
        <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="xsmall muted">Your next review asks whether it happened.</span>
          <div className="chips" role="group" aria-label="How is it going?" style={{ gap: 6 }}>
            <button className="chip" style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }} aria-pressed={check === 'on'} onClick={() => pick('on')}>
              On it
            </button>
            <button className="chip" style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }} aria-pressed={check === 'slipping'} onClick={() => pick('slipping')}>
              Slipping
            </button>
          </div>
        </div>
      )}
      {!upcoming && check === 'slipping' && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>Make it smaller rather than skipping it: one time this week still counts as partly.</span>}
    </div>
  );
}
