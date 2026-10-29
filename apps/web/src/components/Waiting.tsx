import { useState } from 'react';
import { shortDate, type GoalIdea } from '@six/core';
import { useStore } from '../data/store.tsx';
import { navigate } from '../router.ts';
import { opsSetWaiting, opsStartAnyway, waitChoices, waiters, waitText, type WaitInfo } from '../data/waiting.ts';
import { Sheet, useToast } from './ui.tsx';

/**
 * The pieces of "waiting on" that more than one screen shows: the picker, the badge, "Start anyway",
 * and Today's "it's ready" prompt.
 */

/** A select of what something can wait on: open goals, and under each its open milestones. */
export function WaitPicker({ value, onChange, exceptGroupId, label = 'Waits on' }: { value: string; onChange: (v: string) => void; exceptGroupId?: string; label?: string }) {
  const { data } = useStore();
  const choices = waitChoices(data, exceptGroupId);
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Nothing: it can start any time</option>
        {choices.map(({ goal, milestones }) => (
          <optgroup key={goal.id} label={goal.title}>
            <option value={`goal:${goal.id}`}>{goal.title} (done)</option>
            {milestones.map((m) => (
              <option key={m.id} value={`ms:${m.id}`}>
                {m.title} · {shortDate(m.due_date)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="xsmall muted" style={{ fontWeight: 400 }}>
        Not a date: it stays in Later until that's done, then Today asks if you're ready. Pick the one thing it really needs (the job), not the whole group.
      </span>
    </label>
  );
}

/** "⏳ Waiting · 6 weeks on Land an AI product owner role", or "Ready: … is done". */
export function WaitBadge({ info }: { info: WaitInfo }) {
  return <span className={`wait-badge${info.met ? ' ready' : ''}`}>{info.met ? '✓ ' : '⏳ '}{waitText(info)}</span>;
}

/** Start a waiting idea before what it waits on is done: say why, then make the goal. */
export function StartAnywaySheet({ idea, info, onClose }: { idea: GoalIdea; info: WaitInfo; onClose: () => void }) {
  const { commit } = useStore();
  const toast = useToast();
  const [reason, setReason] = useState('');
  return (
    <Sheet title={`Start ${idea.title} now?`} onClose={onClose}>
      <span className="small" style={{ marginTop: -8, color: 'var(--ink-2)' }}>
        It's waiting on <b>{info.label}</b>
        {info.weeks > 0 ? `, ${info.weeks} week${info.weeks === 1 ? '' : 's'} so far` : ''}. Starting now is fine when something changed. Say what, and it goes on the idea's note.
      </span>
      <label className="field">
        What changed
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Found financing, or the research needs no money" />
      </label>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose}>
          Keep waiting
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!reason.trim()}
          onClick={() => {
            commit(opsStartAnyway(idea, info, reason));
            toast(`${idea.title} isn't waiting anymore`);
            onClose();
            navigate(`/goals/new?idea=${idea.id}`);
          }}
        >
          Start anyway
        </button>
      </div>
    </Sheet>
  );
}

const promptKey = (id: string, metAt: string | null) => `six.waiting.ready.${id}.${metAt ?? ''}`;

/**
 * On Today: something that was waiting is ready ("Land an AI product owner role is done. Glamping
 * site was waiting on it"). An idea: prepare it (the wait comes off and its goal form opens). A
 * group: it stops waiting. "Later" hides the prompt on this device.
 */
export function WaitingReady() {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const [, bump] = useState(0);
  const ready = waiters(data, today).filter((w) => {
    if (!w.info.met) return false;
    try {
      return localStorage.getItem(promptKey(w.id, w.info.metAt)) !== '1';
    } catch {
      return true;
    }
  });
  if (!ready.length) return null;
  return (
    <>
      {ready.map((w) => (
        <div key={w.id} className="banner info row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="small">
            <b>{w.info.label}</b> is done. <b>{w.title}</b> was waiting on it{w.info.weeks ? ` (${w.info.weeks} week${w.info.weeks === 1 ? '' : 's'})` : ''}. {w.kind === 'idea' ? 'Ready to prepare it?' : 'Its goals can start.'}
          </span>
          <span className="row-start" style={{ gap: 8 }}>
            <button
              type="button"
              className="link-btn small"
              onClick={() => {
                try {
                  localStorage.setItem(promptKey(w.id, w.info.metAt), '1');
                } catch {
                  // storage blocked
                }
                bump((n) => n + 1);
              }}
            >
              Later
            </button>
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                if (w.kind === 'idea') {
                  commit(opsSetWaiting('ideas', w.idea, ''));
                  navigate(`/goals/new?idea=${w.idea.id}`);
                } else {
                  commit(opsSetWaiting('groups', w.group, ''));
                  toast(`${w.group.name} isn't waiting anymore`);
                }
              }}
            >
              {w.kind === 'idea' ? 'Prepare it' : 'Done waiting'}
            </button>
          </span>
        </div>
      ))}
    </>
  );
}

/** For the weekly review: what's still waiting, and for how long. */
export function WaitingReviewCard() {
  const { data, today } = useStore();
  const list = waiters(data, today).filter((w) => !w.info.met);
  if (!list.length) return null;
  return (
    <div className="card stack-sm">
      <span className="label">Still waiting</span>
      {list.map((w) => (
        <div key={w.id} className="row-between small" style={{ gap: 10 }}>
          <span>
            <b>{w.title}</b> <span className="muted">· {w.kind === 'group' ? 'group' : 'idea'}</span>
          </span>
          <span className="muted" style={{ textAlign: 'right' }}>
            {w.info.weeks} week{w.info.weeks === 1 ? '' : 's'} on {w.info.label}
            {w.info.due ? ` · due ${shortDate(w.info.due)}` : ''}
          </span>
        </div>
      ))}
      <span className="xsmall muted">If it's been long, decide on purpose: keep waiting, find another way, or let it go.</span>
    </div>
  );
}

