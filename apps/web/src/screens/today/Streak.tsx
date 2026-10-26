import type { Streak } from '../../data/habit.ts';
import { href } from '../../router.ts';
import { Icon } from '../../components/ui.tsx';

/** "9-day streak": the check-in streak, with a nudge when yesterday was missed. */
export function StreakChip({ streak }: { streak: Streak }) {
  const label = streak.days === 0 ? 'Start a streak' : `${streak.days}-day streak`;
  return (
    <a
      href={href('/review')}
      className={`pill ${streak.checkedInToday ? 'on_track' : streak.missedYesterday ? 'behind' : 'none'}`}
      style={{ textDecoration: 'none', height: 30, padding: '0 12px' }}
      aria-label={`${label}. ${streak.freezes} freeze${streak.freezes === 1 ? '' : 's'} left.${streak.checkedInToday ? ' Checked in today.' : ''}`}
    >
      <Icon name={streak.checkedInToday ? 'check' : 'sparkle'} size={13} stroke={2.6} />
      {streak.missedYesterday && !streak.checkedInToday ? 'Never miss twice' : label}
    </a>
  );
}

export function StreakCard({ streak }: { streak: Streak }) {
  return (
    <div className="tile" style={{ gap: 10 }}>
      <div className="row-between">
        <span className="label">Check-ins</span>
        <span className="label">
          {streak.freezes} freeze{streak.freezes === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="num" style={{ fontSize: 30, lineHeight: 1 }}>{streak.days}</span>
        <span className="small" style={{ color: 'var(--ink-2)' }}>day{streak.days === 1 ? '' : 's'} running</span>
      </div>
      <StreakDots streak={streak} />
      <span className="xsmall muted">
        {streak.checkedInToday
          ? 'Checked in today. One thing a day keeps it going.'
          : streak.missedYesterday
            ? 'Yesterday was covered by a freeze. Log one thing today: never miss twice.'
            : 'Log any one thing today to keep it going.'}
      </span>
    </div>
  );
}

export function StreakDots({ streak }: { streak: Streak }) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}
      role="img"
      aria-label={`Checked in on ${streak.last14.filter((d) => d.state === 'done').length} of the last 14 days`}
    >
      {streak.last14.map((d) => (
        <span
          key={d.date}
          style={{
            aspectRatio: '1',
            borderRadius: 4,
            background: d.state === 'done' ? 'var(--accent)' : d.state === 'frozen' ? 'var(--blue-soft)' : d.state === 'today' ? 'transparent' : 'var(--track)',
            boxShadow: d.state === 'today' ? 'inset 0 0 0 1.5px var(--accent-ink)' : d.state === 'frozen' ? 'inset 0 0 0 1.5px var(--blue)' : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** Morning: yesterday's leftovers, today's load against your time, then "Start my day". */
