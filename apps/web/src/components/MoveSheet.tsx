import { useState } from 'react';
import type { Goal } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { currentWindow, opsMoveGoals, ownClockWindow, planMove, windowLine, type Destination } from '../data/move.ts';
import type { ChainLevel } from '../data/chain.ts';
import { Sheet, useToast } from './ui.tsx';

const LEVEL_WORD: Record<ChainLevel, string> = { quarter: '3-month goal', month: 'month goal', week: 'week goal' };

/**
 * Move one goal or a whole group into a batch, or onto their own clock. Shows what carries over
 * (daily tasks, history and this week's goal always do) and what needs setting again.
 */
export function MoveSheet({ goals, title, initial, onClose }: { goals: Goal[]; title?: string; initial?: Destination | null; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const batches = view.batches;
  const [dest, setDest] = useState<Destination | null>(initial ?? null);
  const [months, setMonths] = useState<3 | 6>(initial?.kind === 'own' ? initial.months : 6);
  const chosen: Destination | null = dest?.kind === 'own' ? { kind: 'own', months } : dest;
  const name = title ?? (goals.length === 1 ? goals[0]!.title : `${goals.length} goals`);

  // What the move would mean, goal by goal.
  const moves = chosen
    ? goals.map((g) => planMove(data, g, chosen.kind === 'plan' ? chosen.plan : ownClockWindow(g, months, today), today))
    : [];
  const staying = chosen?.kind === 'plan' ? goals.filter((g) => currentWindow(data, g.id, today)?.id === chosen.plan.id) : [];
  const moving = goals.length - staying.length;
  const toWindow = chosen ? (chosen.kind === 'plan' ? chosen.plan : ownClockWindow(goals[0]!, months, today)) : null;
  const dropped = moves.filter((m) => m.dropped.length && !staying.includes(m.goal));

  return (
    <Sheet title={`Move ${name}`} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        {goals.length === 1
          ? `Now in ${currentWindow(data, goals[0]!.id, today)?.name ?? 'no window'}.`
          : `${goals.map((g) => g.title).join(', ')}.`}{' '}
        Daily tasks, logs and readings stay. The goal's 3-month, month and week goals move to the new window's calendar.
      </span>

      <div className="stack-sm" role="radiogroup" aria-label="Move to">
        {batches.map((p) => {
          const on = chosen?.kind === 'plan' && chosen.plan.id === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} className={`choice${on ? ' on' : ''}`} onClick={() => setDest({ kind: 'plan', plan: p })} style={{ textAlign: 'left' }}>
              <b>{p.name}</b>
              <span>{windowLine(p, today)}</span>
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={chosen?.kind === 'own'} className="choice" onClick={() => setDest({ kind: 'own', months })} style={{ textAlign: 'left' }}>
          <b>{goals.length === 1 ? 'Its own clock' : 'Each on its own clock'}</b>
          <span>Starts today, independent of any batch</span>
        </button>
        {chosen?.kind === 'own' && (
          <div className="seg" role="tablist" aria-label="Length">
            {([3, 6] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={months === m} onClick={() => setMonths(m)}>
                {m} months
              </button>
            ))}
          </div>
        )}
        {batches.length === 0 && <span className="xsmall muted">No batches running. Make one with “New batch” on the Goals page, or use an own clock.</span>}
      </div>

      {chosen && toWindow && (
        <div className="card tight stack-sm">
          {moving === 0 ? (
            <span className="small">{goals.length === 1 ? 'It is' : 'They are'} already in {toWindow.name}.</span>
          ) : (
            <>
              <span className="small">
                <b>{chosen.kind === 'own' ? `Own clock, ${months} months` : toWindow.name}</b>: {windowLine(toWindow, today)}
              </span>
              <span className="xsmall muted">This week’s goal and daily tasks carry over.</span>
              {dropped.map((m) => (
                <span key={m.goal.id} className="xsmall" style={{ color: 'var(--amber-ink)' }}>
                  {goals.length > 1 ? `${m.goal.title}: ` : ''}the {m.dropped.map((l) => LEVEL_WORD[l]).join(' and ')} {m.dropped.length === 1 ? 'needs' : 'need'} setting again (the dates don’t line up).
                </span>
              ))}
              {toWindow.start_date > today && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>This batch hasn’t started: pace and reviews begin {toWindow.start_date}.</span>}
            </>
          )}
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!chosen || moving === 0}
          onClick={() => {
            if (!chosen) return;
            const movers = goals.filter((g) => !staying.includes(g));
            commit(opsMoveGoals(data, movers, chosen, today));
            toast(`${movers.length === 1 ? movers[0]!.title : `${movers.length} goals`} moved to ${chosen.kind === 'plan' ? chosen.plan.name : 'own clock'}`);
            onClose();
          }}
        >
          {moving > 1 ? `Move ${moving} goals` : 'Move'}
        </button>
      </div>
    </Sheet>
  );
}
