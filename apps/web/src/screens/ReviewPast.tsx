import { previousReview, shortDate, type Review } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView } from '../data/derive.ts';
import { BackLink, Empty } from '../components/ui.tsx';
import { PastRow, reviewTitle } from './ReviewHub.tsx';

/** Every finished review, newest first. */
export function ReviewList() {
  const { data } = useStore();
  const past = [...data.reviews].filter((r) => r.status === 'done').sort((a, b) => (a.period_end < b.period_end ? 1 : -1));
  return (
    <div className="stack">
      <BackLink label="Review" fallback="/review" />
      <h1>Past reviews</h1>
      <div className="card stack-sm">
        {past.length === 0 && <span className="small muted">No reviews yet.</span>}
        {past.map((r) => (
          <PastRow key={r.id} review={r} />
        ))}
      </div>
    </div>
  );
}

const ANSWER: Record<string, string> = { yes: 'Yes', partly: 'Partly', no: 'No' };
const RESULT: Record<string, string> = { hit: 'Hit', partly: 'Partly', missed: 'Missed' };
const RETRO_RESULT: Record<string, string> = { hit: 'Achieved', partly: 'Partly', missed: 'Not this time' };
const DECISION: Record<string, string> = { keep: 'Kept', adjust: 'Adjusted', drop: 'Dropped' };

/** Everything one review recorded: results, answers, reflections and the changes it made. */
export function ReviewDetail({ id }: { id: string }) {
  const { data } = useStore();
  const view = useView();
  const r = data.reviews.find((x) => x.id === id);
  if (!r) return <Empty title="Review not found." />;
  const prev = previousReview(data.reviews, r.kind, r.period_start);
  const changes = data.changeLog.filter((c) => c.review_id === r.id);
  const results = r.goal_results ?? [];
  const decisions = r.goal_decisions ?? [];
  const goalName = (goalId: string) => view.goal(goalId)?.title ?? 'A removed goal';
  const goalColor = (goalId: string) => view.goal(goalId)?.color ?? 'var(--muted)';

  return (
    <div className="stack">
      <BackLink label="Review" fallback="/review" />
      <h1>{reviewTitle(r)}</h1>
      <span className="small muted" style={{ marginTop: -8 }}>
        {shortDate(r.period_start)} – {shortDate(r.period_end)}
        {r.completed_at ? ` · saved ${shortDate(r.completed_at.slice(0, 10))}` : ''}
      </span>

      <div className="grid-3">
        <div className="card tight">
          <div className="xsmall muted">Tasks done</div>
          <div className="num" style={{ fontSize: 18 }}>
            {fmt(r.actions_done, 0)} of {r.actions_planned}
          </div>
        </div>
        <div className="card tight">
          <div className="xsmall muted">Time</div>
          <div className="num" style={{ fontSize: 18 }}>
            {r.minutes_done ? minutesText(r.minutes_done) : '–'}
          </div>
          {r.minutes_planned ? <div className="xsmall muted">of {minutesText(r.minutes_planned)}</div> : null}
        </div>
        <div className="card tight">
          <div className="xsmall muted">Last change kept?</div>
          <div className="num" style={{ fontSize: 18 }}>
            {r.commitment_kept ? ANSWER[r.commitment_kept] : '–'}
          </div>
        </div>
      </div>

      {prev?.change_next && r.commitment_kept && (
        <div className="card tight small" style={{ color: 'var(--ink-2)' }}>
          The change from the review before: “{prev.change_next}”
        </div>
      )}

      {results.length > 0 && (
        <div className="card stack-sm">
          <span className="label">Goals</span>
          {results.map((g) => (
            <div key={g.goal_id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <span className="dot" style={{ background: goalColor(g.goal_id), marginTop: 6 }} />
              <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="small strong">{goalName(g.goal_id)}</span>
                {g.note && <span className="xsmall muted">{g.note}</span>}
              </div>
              <span className="small strong" style={{ color: g.result === 'hit' ? 'var(--accent-ink)' : g.result === 'missed' ? 'var(--amber-ink)' : 'var(--ink-2)' }}>
                {(r.kind === 'retro' ? RETRO_RESULT : RESULT)[g.result]}
              </span>
            </div>
          ))}
        </div>
      )}

      {decisions.length > 0 && (
        <div className="card stack-sm">
          <span className="label">Decisions</span>
          {decisions.map((d) => (
            <div key={d.goal_id} className="row-between small">
              <span className="row-start" style={{ flexWrap: 'nowrap' }}>
                <span className="dot" style={{ background: goalColor(d.goal_id) }} />
                {goalName(d.goal_id)}
              </span>
              <b>{DECISION[d.decision]}</b>
            </div>
          ))}
        </div>
      )}

      <Notes review={r} />

      {r.obstacles.length > 0 && (
        <div className="card tight small">
          <span className="label">Got in the way</span> {r.obstacles.join(', ')}
        </div>
      )}

      {changes.length > 0 && (
        <div className="card stack-sm">
          <span className="label">Changes made</span>
          {changes.map((c) => (
            <span key={c.id} className="small">
              {c.summary} <span className="xsmall muted">· from {shortDate(c.effective_from)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Notes({ review: r }: { review: Review }) {
  const retro = r.kind === 'retro';
  const rows: [string, string][] = [
    [retro ? 'What worked' : 'What went well', r.went_well],
    [retro ? "What didn't" : 'What got in the way', r.got_in_way],
    ['What to change next', retro ? '' : r.change_next],
    ['Carries into the next plan', r.carry_forward ?? ''],
  ];
  const shown = rows.filter(([, text]) => text.trim());
  if (!shown.length) return null;
  return (
    <div className="card stack-sm">
      {shown.map(([label, text]) => (
        <div key={label} className="stack-sm" style={{ gap: 2 }}>
          <span className="label">{label}</span>
          <span className="small" style={{ whiteSpace: 'pre-wrap' }}>
            {text}
          </span>
        </div>
      ))}
    </div>
  );
}
