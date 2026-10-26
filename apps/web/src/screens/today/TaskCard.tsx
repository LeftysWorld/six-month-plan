import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Session } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { fmt, minutesText } from '../../data/derive.ts';
import { useView } from '../../data/useView.ts';
import { readingOn } from '../../data/connect.ts';
import { Icon } from '../../components/ui.tsx';
import { WorkoutCardPlan } from '../../components/Workout.tsx';

const SWIPE_DONE = 84;

/** One task card: tap the round button to check it off, tap the card for the log sheet, swipe left to finish it. */
export function TaskCard({ session, hint, onToggle, onOpen, swipe }: { session: Session; hint?: string | null; onToggle: () => void; onOpen: () => void; swipe: boolean }) {
  const view = useView();
  const { data } = useStore();
  const action = view.action(session.action_id);
  const goals = view.goalsForAction(session.action_id).filter((g) => !g.archived_at && !g.completed_at);
  const s = session;
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; on: boolean; moved: boolean } | null>(null);

  const ring =
    s.status === 'done' ? 'done' : s.status === 'partial' || s.status === 'minimum' ? 'part' : s.status === 'skipped' ? 'skip' : '';
  const label =
    s.status === 'planned' ? `Mark ${s.title} done` : `${s.title}, ${s.status === 'minimum' ? 'minimum kept' : s.status}. Tap to undo`;

  let meta: string | null = [action?.cue ? action.cue : null, goals.map((g) => g.title).join(' + ') || null].filter(Boolean).join(' · ') || null;
  if (s.status === 'minimum') meta = `Minimum kept${action?.min_label ? ` · ${action.min_label}` : ''}`;
  if (s.status === 'partial') meta = s.planned_count ? `Partial · ${s.actual_count ?? 0} of ${s.planned_count}` : 'Partial';
  if (s.status === 'skipped') meta = s.obstacles.length ? `Skipped · ${s.obstacles.join(', ')}` : 'Skipped';
  if (s.origin === 'unplanned') meta = s.status === 'planned' ? 'Extra today' : 'Logged extra';
  if (hint && s.status === 'planned') meta = [hint, meta].filter(Boolean).join(' · ');
  const fileCount = data.attachments.filter((a) => a.session_id === s.id).length;
  if (fileCount > 0) meta = [meta, fileCount === 1 ? '1 file' : `${fileCount} files`].filter(Boolean).join(' · ');

  const right =
    s.status === 'done' || s.status === 'partial' || s.status === 'minimum'
      ? s.actual_minutes != null
        ? `${s.actual_minutes}m`
        : ''
      : s.planned_count
        ? `${s.planned_count} · ${minutesText(s.planned_minutes)}`
        : s.planned_minutes
          ? minutesText(s.planned_minutes)
          : '';

  const onDown = (e: ReactPointerEvent) => {
    if (!swipe || e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY, on: false, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my)) return;
      d.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.moved = true;
    setDx(Math.max(-120, Math.min(0, mx)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.on && dx <= -SWIPE_DONE) onToggle();
    setDx(0);
  };

  const logged = s.status === 'done' || s.status === 'partial' || s.status === 'minimum';
  // A measure task shows the number it saved that day.
  const reading = action?.kind === 'measure' && logged ? readingOn(data, action.measurement_type_id, s.date) : null;
  const unit = reading != null ? data.measurementTypes.find((t) => t.id === action?.measurement_type_id)?.unit ?? '' : '';
  const topLine = reading != null ? `${fmt(reading)}${unit ? ` ${unit}` : ''}` : right;

  return (
    <div className="task-card-wrap">
      {swipe && dx < 0 && (
        <div className="swipe-action" style={{ opacity: Math.min(1, -dx / SWIPE_DONE) }} aria-hidden="true">
          <Icon name="check" size={16} stroke={2.6} /> Done
        </div>
      )}
      <div
        className={`up-next-card task-card${dx ? ' dragging' : ''}${s.status !== 'planned' ? ' logged' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <button type="button" className="task-card-body" onClick={() => !dx && onOpen()} aria-label={`${s.title}: details`}>
          {topLine && (
            <span className="mono" style={{ color: logged ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
              {topLine}
            </span>
          )}
          <span className={`task-card-title${s.status === 'done' ? ' done' : ''}`}>
            {s.title}
            {s.planned_count && s.status === 'planned' ? ` ×${s.planned_count}` : ''}
          </span>
          {meta && (
            <span className="task-card-meta" style={{ color: s.status === 'minimum' || s.status === 'partial' ? 'var(--amber-ink)' : undefined }}>
              {goals.map((g) => (
                <span key={g.id} className="dot" style={{ width: 7, height: 7, background: g.color, boxShadow: `0 0 10px ${g.color}`, marginRight: goals.length > 1 ? -3 : 0 }} />
              ))}
              <span style={{ marginLeft: goals.length > 1 ? 3 : 0 }}>{meta}</span>
            </span>
          )}
          {action?.kind === 'workout' && action.workout_plan?.length ? <WorkoutCardPlan session={s} plan={action.workout_plan} /> : null}
        </button>
        <button type="button" className={`tick-btn ${ring}`} aria-label={label} onClick={onToggle}>
          {s.status === 'done' || s.status === 'planned' ? <Icon name="check" size={22} stroke={2.6} /> : s.status === 'skipped' ? <Icon name="x" size={20} stroke={2.4} /> : <Icon name="minus" size={22} stroke={2.6} />}
        </button>
      </div>
    </div>
  );
}
