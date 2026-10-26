import { useState } from 'react';
import { groupScoreText, shortDate, type Goal, type GoalGroup, type ISODate, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { goalPrizes, groupPrize, opsSetGoalPrizes, opsSetGroupPrize, prizeWhen, unclaimedPrizes, type PrizeItem } from '../data/prizes.ts';
import { href } from '../router.ts';
import { Icon, Sheet, useToast } from './ui.tsx';

/**
 * Prizes on screen. A prize hangs on a date to hit, on finishing a goal, or on a group landing.
 * Celebration is rare and loud (one card on Today when something is earned); everything else is
 * quiet: a gift mark on the date, a small card on the goal, a score bar on the group.
 */

/** The small inline mark next to a dated prize: gift + the treat, coloured by status. */
export function PrizeTag({ p }: { p: PrizeItem }) {
  const cls = p.lost ? 'lost' : p.status === 'earned' || p.status === 'late' ? 'earned' : '';
  return (
    <span className={`prize-tag ${cls}`} title={prizeWhen(p)}>
      <Icon name="gift" size={11} stroke={2.4} /> {p.title}
      {p.claimedAt ? ' · claimed' : ''}
    </span>
  );
}

/** One prize as a row: gift, what it's for, when, and Claimed. */
export function PrizeRow({ p, showGoal = false }: { p: PrizeItem; showGoal?: boolean }) {
  const { commit } = useStore();
  const toast = useToast();
  const earned = (p.status === 'earned' || p.status === 'late') && !p.lost;
  const cls = p.lost ? 'lost' : p.claimedAt ? 'claimed' : earned ? p.status : '';
  return (
    <div className="prize-row">
      <span className={`prize-gift ${cls}`} aria-hidden>
        <Icon name={p.claimedAt ? 'check' : 'gift'} size={17} stroke={2.2} />
      </span>
      <span className="stack-sm grow" style={{ gap: 1, minWidth: 0 }}>
        <span className={`strong ${p.lost ? 'lost-text' : ''}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.title}
        </span>
        <span className="xsmall muted">
          {showGoal && p.goal ? (
            <>
              <a href={href(`/goals/${p.goal.id}`)}>{p.goal.title}</a> ·{' '}
            </>
          ) : showGoal && p.group ? (
            <>
              <a href={href(`/goals/group/${p.group.id}`)}>{p.group.name}</a> ·{' '}
            </>
          ) : null}
          {p.forText} · {p.claimedAt ? `Claimed ${shortDate(new Date(p.claimedAt).toISOString().slice(0, 10))}` : prizeWhen(p)}
        </span>
      </span>
      {earned && !p.claimedAt && (
        <button
          className="btn small"
          style={{ flex: 'none' }}
          onClick={() => {
            commit(p.claim);
            toast(`${p.title}: enjoy it.`, () => commit(p.unclaim));
          }}
        >
          Claimed
        </button>
      )}
    </div>
  );
}

/** The goal page's prize card: every prize on the goal, and a way to set the finish prize and the on-time bonus. */
export function GoalPrizes({ goal, plan }: { goal: Goal; plan: Plan | null }) {
  const { today } = useStore();
  const view = useView();
  const [editing, setEditing] = useState(false);
  const prizes = goalPrizes(view, goal, today, plan);
  const finishBy = goal.target_date ?? plan?.end_date ?? null;
  return (
    <div className="card stack-sm" aria-label="Prizes">
      <div className="row-between">
        <span className="label">Prizes</span>
        <button className="link-btn small" onClick={() => setEditing(true)}>
          {goal.prize?.trim() || goal.prize_on_time?.trim() ? 'Change' : '+ Set a prize'}
        </button>
      </div>
      {prizes.length === 0 && <span className="small muted">Nothing riding on this yet. A treat for finishing, a bigger one for finishing by {finishBy ? shortDate(finishBy) : 'the date'}, and smaller ones on the dates to hit (tap a date to add one).</span>}
      {prizes.map((p) => (
        <PrizeRow key={p.key} p={p} />
      ))}
      {editing && <GoalPrizeSheet goal={goal} finishBy={finishBy} onClose={() => setEditing(false)} />}
    </div>
  );
}

export function GoalPrizeSheet({ goal, finishBy, onClose }: { goal: Goal; finishBy: ISODate | null; onClose: () => void }) {
  const { commit } = useStore();
  const toast = useToast();
  const [prize, setPrize] = useState(goal.prize ?? '');
  const [bonus, setBonus] = useState(goal.prize_on_time ?? '');
  const judge = goal.target_date_at_set ?? finishBy;
  return (
    <Sheet title="Prizes" onClose={onClose}>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const ops = opsSetGoalPrizes(goal, prize, bonus, finishBy);
          if (ops.length) {
            commit(ops);
            toast('Prizes saved');
          }
          onClose();
        }}
      >
        <label className="field">
          When it’s finished
          <input autoFocus value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="e.g. a weekend away" />
        </label>
        <label className="field">
          And if it’s finished by {judge ? shortDate(judge) : 'the date'}
          <input value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="e.g. …plus the good one" />
        </label>
        <span className="xsmall muted">
          The bonus is judged against the finish date as it stands when you set it{goal.target_date_at_set && goal.target_date && goal.target_date_at_set !== goal.target_date ? ` (${shortDate(goal.target_date_at_set)}; the goal’s date has since moved to ${shortDate(goal.target_date)})` : ''}. Moving the date later doesn’t move the bonus. Clearing the bonus and setting it again resets that.
        </span>
        <div className="btn-row">
          <button className="btn primary" type="submit">
            Save
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** The group page's prize: the treat, the score bar toward it, and a way to set both. */
export function GroupPrizeCard({ group }: { group: GoalGroup }) {
  const { data, today } = useStore();
  const view = useView();
  const [editing, setEditing] = useState(false);
  const p = groupPrize(data, view, group, today);
  return (
    <section className="card stack-sm" aria-label="Group prize">
      <div className="row-between">
        <span className="label">Group prize</span>
        <button className="link-btn small" onClick={() => setEditing(true)}>
          {p ? 'Change' : '+ Set a prize'}
        </button>
      </div>
      {!p && <span className="small muted">A treat for the whole group landing: enough of its goals finished by the end of the season.</span>}
      {p && p.score && (
        <>
          <PrizeRow p={p} />
          <div className={`score-bar score-mark ${p.score.earned ? 'earned' : ''}`} style={{ ['--at' as string]: `${Math.round(p.score.threshold * 100)}%` }} aria-label={`${groupScoreText(p.score)} finished; needs ${Math.round(p.score.threshold * 100)}%`}>
            <span style={{ width: `${Math.round(p.score.share * 100)}%` }} />
          </div>
          <span className="xsmall muted">
            {groupScoreText(p.score)} of its goals finished · needs {Math.round(p.score.threshold * 100)}%{p.dueDate ? ` by ${shortDate(p.dueDate)}` : ''}
          </span>
        </>
      )}
      {editing && <GroupPrizeSheet group={group} onClose={() => setEditing(false)} />}
    </section>
  );
}

export function GroupPrizeSheet({ group, onClose }: { group: GoalGroup; onClose: () => void }) {
  const { commit } = useStore();
  const toast = useToast();
  const [prize, setPrize] = useState(group.prize ?? '');
  const [pct, setPct] = useState(String(Math.round((group.prize_threshold ?? 0.85) * 100)));
  return (
    <Sheet title={`${group.name}: group prize`} onClose={onClose}>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(pct);
          const ops = opsSetGroupPrize(group, prize, Number.isFinite(n) && n > 0 ? n / 100 : null);
          if (ops.length) {
            commit(ops);
            toast('Group prize saved');
          }
          onClose();
        }}
      >
        <label className="field">
          When the group lands
          <input autoFocus value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="e.g. land for the glamping site" />
        </label>
        <label className="field">
          How much of it has to finish (%)
          <input type="number" min={5} max={100} step={5} value={pct} onChange={(e) => setPct(e.target.value)} />
        </label>
        <span className="xsmall muted">Counts goals finished (not dropped ones). With four goals, 85% means all four; with seven, six of seven.</span>
        <div className="btn-row">
          <button className="btn primary" type="submit">
            Save
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const LATER_KEY = 'six.prizes.later';

function laterSet(today: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(LATER_KEY) ?? 'null') as { day: string; keys: string[] } | null;
    return raw && raw.day === today ? new Set(raw.keys) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * The celebration card on Today: the first earned, unclaimed prize. Loud once, then gone: Claimed
 * records it; Later hides it for the day (it stays on the goal and in the review until claimed).
 */
export function PrizeCelebration() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [, bump] = useState(0);
  const later = laterSet(today);
  const p = unclaimedPrizes(data, view, today).find((x) => !later.has(x.key));
  if (!p) return null;
  const where = p.goal ? p.goal.title : p.group?.name ?? '';
  return (
    <section className="card celebrate stack-sm" aria-label="Prize earned">
      <span className="row-start" style={{ gap: 8 }}>
        <Icon name="gift" size={18} stroke={2.2} />
        <span className="label" style={{ color: 'inherit' }}>
          You earned it
        </span>
      </span>
      <b style={{ fontSize: 22, lineHeight: 1.15 }}>{p.title}</b>
      <span className="small muted">
        {where} · {p.forText} · {prizeWhen(p)}
      </span>
      <div className="btn-row" style={{ marginTop: 4 }}>
        <button
          className="btn"
          onClick={() => {
            commit(p.claim);
            toast(`${p.title}: enjoy it.`, () => commit(p.unclaim));
          }}
        >
          Claimed
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            try {
              later.add(p.key);
              localStorage.setItem(LATER_KEY, JSON.stringify({ day: today, keys: [...later] }));
            } catch {
              // fine: it will show again
            }
            bump((n) => n + 1);
          }}
        >
          Later
        </button>
      </div>
    </section>
  );
}
