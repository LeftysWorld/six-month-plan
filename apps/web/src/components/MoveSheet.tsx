import { useState } from 'react';
import type { Goal, Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { currentWindow, opsMoveGoals, windowLine } from '../data/move.ts';
import { Sheet, useToast } from './ui.tsx';

/**
 * Move one goal or a whole group to another season. Daily tasks, history, dates and this week's
 * goal all carry over; only the review calendar changes.
 */
export function MoveSheet({ goals, title, initial, onClose }: { goals: Goal[]; title?: string; initial?: Plan | null; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const seasons = view.batches;
  const [dest, setDest] = useState<Plan | null>(initial ?? null);
  const name = title ?? (goals.length === 1 ? goals[0]!.title : `${goals.length} goals`);
  const staying = dest ? goals.filter((g) => currentWindow(data, g.id, today)?.id === dest.id) : [];
  const moving = goals.length - staying.length;

  return (
    <Sheet title={`Move ${name}`} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        {goals.length === 1 ? `Now in ${currentWindow(data, goals[0]!.id, today)?.name ?? 'no season'}.` : `${goals.map((g) => g.title).join(', ')}.`} Daily tasks, logs, dates and this
        week’s goal stay; only the season whose reviews cover it changes.
      </span>
      <div className="stack-sm" role="radiogroup" aria-label="Move to">
        {seasons.map((p) => {
          const on = dest?.id === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} className={`choice${on ? ' on' : ''}`} onClick={() => setDest(p)} style={{ textAlign: 'left' }}>
              <b>{p.name}</b>
              <span>{windowLine(p, today)}</span>
            </button>
          );
        })}
        {seasons.length === 0 && <span className="xsmall muted">No season running. Start one on the Goals page first.</span>}
      </div>
      {dest && moving === 0 && <span className="small">{goals.length === 1 ? 'It is' : 'They are'} already in {dest.name}.</span>}
      {dest && moving > 0 && dest.start_date > today && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>This season hasn’t started: pace and reviews begin {dest.start_date}.</span>}
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!dest || moving === 0}
          onClick={() => {
            if (!dest) return;
            const movers = goals.filter((g) => !staying.includes(g));
            commit(opsMoveGoals(data, movers, dest, today));
            toast(`${movers.length === 1 ? movers[0]!.title : `${movers.length} goals`} moved to ${dest.name}`);
            onClose();
          }}
        >
          {moving > 1 ? `Move ${moving} goals` : 'Move'}
        </button>
      </div>
    </Sheet>
  );
}
