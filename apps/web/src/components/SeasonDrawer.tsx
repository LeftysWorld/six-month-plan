import { useEffect, useRef, type ReactNode } from 'react';
import { daysBetween, shortDate, weekStart, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { goalTrack, nextCheckpoint, nextReviewWord } from '../data/season.ts';
import { seasonStartSteps } from './SeasonStart.tsx';
import { Icon } from './ui.tsx';
import type { Placed } from '../screens/Season.tsx';

/**
 * One line about the season above the board: on pace, days to the checkpoint, the review, the
 * start checklist and the finish lines. "Show" opens the season panel as a drawer.
 */
export function SeasonStrip({ season, members, onShow, open }: { season: Plan; members: Placed[]; onShow: () => void; open: boolean }) {
  const view = useView();
  const { today, data } = useStore();
  const weekReviewed = data.reviews.some((r) => r.kind === 'weekly' && r.status === 'done' && r.period_start === weekStart(today));
  const paced = members.filter((m) => goalTrack(view, m.card.goal, m.plan).label !== 'none');
  const behind = paced.filter((m) => goalTrack(view, m.card.goal, m.plan).label === 'behind').length;
  const cp = nextCheckpoint(season, today);
  const start = seasonStartSteps(view, season, members.map((m) => m.card.goal), today);
  return (
    <section className="season-strip" aria-label="This season">
      <button type="button" className="season-strip-bar" onClick={onShow} aria-haspopup="dialog" aria-expanded={open}>
        <b>This season</b>
        <span>
          <b>
            {paced.length - behind} of {paced.length}
          </b>{' '}
          on pace
        </span>
        <span>
          <b>{Math.max(0, daysBetween(today, cp))} days</b> to the checkpoint
        </span>
        <span>
          Review <b>{nextReviewWord(today, weekReviewed)}</b>
        </span>
        {start && (
          <span>
            Week {start.arc.week || 1} checklist <b>{start.left === 0 ? 'all set' : `${start.left} to go`}</b>
          </span>
        )}
        <span>
          By {shortDate(season.end_date)}: <b>{members.length} finish line{members.length === 1 ? '' : 's'}</b>
        </span>
        <span className="season-strip-show">
          Show <Icon name="chevron" size={14} stroke={2.4} />
        </span>
      </button>
    </section>
  );
}

/** The season panel, sliding in from the right over a dimmed page. Esc or the scrim closes it. */
export function SeasonDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="season-drawer-wrap">
      <button type="button" className="season-drawer-scrim" aria-label="Close the season panel" onClick={onClose} />
      <aside className="season-drawer" role="dialog" aria-modal="true" aria-label="This season">
        <div className="row-between">
          <b style={{ fontSize: 18 }}>This season</b>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={18} stroke={2.4} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
