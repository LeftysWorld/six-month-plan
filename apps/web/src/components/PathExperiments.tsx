import { useState } from 'react';
import { GAUGE_KEYS, addDays, shortDate, type ISODate, type Path, type PathExperiment, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { minutesText } from '../data/derive.ts';
import { experimentsOf, opsAddExperiment, opsDeleteExperiment, opsFinishExperiment, opsReopenExperiment, opsRestoreExperiment, opsUpdateExperiment, pathReport, reportRange, timeByPath } from '../data/experiments.ts';
import { pathsOf } from '../data/paths.ts';
import { href } from '../router.ts';
import { Icon, Sheet, useToast } from './ui.tsx';

/**
 * Experiments on a path: the small, dated things that answer its questions. Add one against a
 * question (or free), tick it off with what you learned; the answer lands on the question.
 */
export function PathExperiments({ path }: { path: Path }) {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState<PathExperiment | null>(null);
  const exps = experimentsOf(data, path.id);
  const open = exps.filter((e) => !e.completed_at);
  const done = exps.filter((e) => e.completed_at);
  const qText = (id: string | null) => path.questions.find((q) => q.id === id)?.text ?? null;
  return (
    <section className="card stack-sm" aria-label="Experiments">
      <div className="row-between">
        <span className="label">Experiments</span>
        <button className="link-btn small" onClick={() => setAdding(true)}>
          + Experiment
        </button>
      </div>
      {exps.length === 0 && <span className="small muted">A question is too abstract to act on; a goal is too big to try. An experiment is two weeks and one phone call: “call one glamping owner and ask what they sold for.” It shows on Today when it’s due, and what you learn lands on the question.</span>}
      {open.map((e) => (
        <ExperimentRow key={e.id} e={e} question={qText(e.question_id)} onFinish={() => setFinishing(e)} />
      ))}
      {done.length > 0 && open.length > 0 && <span className="xsmall muted">Done</span>}
      {done.map((e) => (
        <ExperimentRow key={e.id} e={e} question={qText(e.question_id)} onFinish={() => setFinishing(e)} />
      ))}
      {adding && <ExperimentSheet path={path} onClose={() => setAdding(false)} />}
      {finishing && (
        <FinishSheet
          e={finishing}
          onClose={() => setFinishing(null)}
          onSave={(result) => {
            if (finishing.completed_at) {
              commit(opsUpdateExperiment(finishing, { result }));
              toast('Result saved');
            } else {
              commit(opsFinishExperiment(data, finishing, result, today));
              toast(`${finishing.title}: done${finishing.question_id && result.trim() ? ' · answer added to the question' : ''}`, () => commit(opsReopenExperiment(finishing)));
            }
            setFinishing(null);
          }}
        />
      )}
    </section>
  );
}

function ExperimentRow({ e, question, onFinish }: { e: PathExperiment; question: string | null; onFinish: () => void }) {
  const { today, commit } = useStore();
  const toast = useToast();
  const late = !e.completed_at && e.due_date < today;
  return (
    <div className="list-row" style={{ padding: '8px 0' }}>
      <button
        type="button"
        className={`ring ${e.completed_at ? 'done' : ''}`}
        style={{ width: 22, height: 22, flex: 'none', cursor: 'pointer' }}
        aria-label={e.completed_at ? `${e.title} done, tap to reopen` : `Finish ${e.title}`}
        onClick={() => {
          if (e.completed_at) {
            commit(opsReopenExperiment(e));
            toast(`${e.title} reopened`);
          } else onFinish();
        }}
      >
        {e.completed_at && <Icon name="check" size={12} stroke={3.2} />}
      </button>
      <button type="button" className="grow cal-row-btn" onClick={onFinish} style={{ minWidth: 0 }}>
        <div className="small" style={{ textDecoration: e.completed_at ? 'line-through' : undefined, color: e.completed_at ? 'var(--muted)' : undefined }}>
          {e.title}
        </div>
        <div className="xsmall muted">
          {e.completed_at ? `Done ${shortDate(e.completed_at.slice(0, 10))}` : `By ${shortDate(e.due_date)}${late ? ' · past due' : ''}`}
          {question ? ` · answers: ${question}` : ''}
        </div>
        {e.result && <div className="xsmall" style={{ color: 'var(--ink-2)' }}>{e.result}</div>}
      </button>
      <button
        type="button"
        className="link-btn small"
        aria-label={`Delete ${e.title}`}
        onClick={() => {
          commit(opsDeleteExperiment(e));
          toast(`${e.title} deleted`, () => commit(opsRestoreExperiment(e)));
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export function ExperimentSheet({ path, questionId: q0, title: t0 = '', onClose, onAdded }: { path: Path; questionId?: string | null; title?: string; onClose: () => void; onAdded?: (id: string) => void }) {
  const { today, commit } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState(t0);
  const [due, setDue] = useState<ISODate>(addDays(today, 14));
  const [questionId, setQuestionId] = useState<string>(q0 ?? path.questions.find((q) => !q.answered_at)?.id ?? '');
  const [note, setNote] = useState('');
  return (
    <Sheet title="An experiment" onClose={onClose}>
      <span className="row-start small muted" style={{ gap: 6, marginTop: -8 }}>
        <span className="dot" style={{ background: path.color }} /> {path.name}
      </span>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const { ops, id } = opsAddExperiment(path.id, title, due, questionId || null, note);
          commit(ops);
          toast(`${title.trim()} · by ${shortDate(due)}. It shows on Today that day.`);
          onAdded?.(id);
          onClose();
        }}
      >
        <label className="field">
          What you’ll try
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call one glamping owner and ask what they sold for" />
        </label>
        <label className="field">
          By when
          <input type="date" value={due} min={today} onChange={(e) => e.target.value && setDue(e.target.value)} />
        </label>
        {path.questions.length > 0 && (
          <label className="field">
            The question it answers
            <select value={questionId} onChange={(e) => setQuestionId(e.target.value)}>
              <option value="">None in particular</option>
              {path.questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.text}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Notes <span style={{ fontWeight: 400 }}>(optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="who, where, what to ask" />
        </label>
        <span className="xsmall muted">Keep it under two weeks and one step. If it needs a season, it’s a goal: make one from the path instead.</span>
        <div className="btn-row">
          <button className="btn primary" type="submit" disabled={!title.trim()}>
            Add
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function FinishSheet({ e, onClose, onSave }: { e: PathExperiment; onClose: () => void; onSave: (result: string) => void }) {
  const [result, setResult] = useState(e.result);
  return (
    <Sheet title={e.completed_at ? 'What you learned' : 'Finish the experiment'} onClose={onClose}>
      <span className="small">{e.title}</span>
      {e.note && <span className="xsmall muted">{e.note}</span>}
      <form
        className="stack-sm"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSave(result);
        }}
      >
        <label className="field">
          What did it tell you?
          <textarea autoFocus rows={3} value={result} onChange={(ev) => setResult(ev.target.value)} placeholder="One or two lines. This becomes the answer on the question." />
        </label>
        <div className="btn-row">
          <button className="btn primary" type="submit">
            {e.completed_at ? 'Save' : 'Done'}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Where your goal time went, by path, as one stacked bar: what you said matters vs where the hours go. */
export function TimeByPath({ plan }: { plan: Plan | null }) {
  const { data, today } = useStore();
  const range = reportRange(plan, today);
  const { rows, total } = timeByPath(data, range);
  if (total === 0) return null;
  return (
    <section className="card stack-sm" aria-label="Time by path">
      <div className="row-between">
        <span className="label">Where the hours went</span>
        <span className="xsmall muted">
          {shortDate(range.start)} – {shortDate(range.end)} · {minutesText(total)}
        </span>
      </div>
      <div className="path-time-bar" role="img" aria-label={rows.map((r) => `${r.path?.name ?? 'No path'} ${Math.round(r.share * 100)}%`).join(', ')}>
        {rows.map((r) => (
          <span key={r.path?.id ?? 'none'} style={{ width: `${Math.max(1, r.share * 100)}%`, background: r.path?.color ?? 'var(--border-strong)' }} title={`${r.path?.name ?? 'No path'} · ${minutesText(r.minutes)}`} />
        ))}
      </div>
      <div className="row-start" style={{ gap: 12, flexWrap: 'wrap' }}>
        {rows.map((r) => (
          <span key={r.path?.id ?? 'none'} className="xsmall row-start" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <span className="dot" style={{ background: r.path?.color ?? 'var(--border-strong)' }} />
            {r.path ? <a href={href(`/paths/${r.path.id}`)}>{r.path.name}</a> : <span className="muted">No path</span>} · {Math.round(r.share * 100)}%
          </span>
        ))}
      </div>
    </section>
  );
}

/** The path report: gauges over time, what moved, questions and experiments, goals, hours. */
export function PathReportCard({ path, plan }: { path: Path; plan: Plan | null }) {
  const { data, today } = useStore();
  const view = useView();
  const range = reportRange(plan, today);
  const r = pathReport(data, view, path, range);
  const max = 5;
  return (
    <section className="card stack-sm" aria-label="Path report">
      <div className="row-between">
        <span className="label">Report · {shortDate(range.start)} – {shortDate(range.end)}</span>
        <span className="xsmall muted">
          {r.goalsFinished} finished · {r.goalsRunning} running
        </span>
      </div>
      <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>
        {r.summary}
      </p>
      {r.gaugeTrend.length > 1 && (
        <div className="stack-sm" style={{ gap: 4 }}>
          <span className="xsmall muted">Gauges, rating by rating</span>
          <div className="gauge-trend" role="img" aria-label={r.gaugeTrend.map((g) => `${shortDate(g.on)}: ${g.avg ?? '–'}`).join(', ')}>
            {r.gaugeTrend.map((g) => (
              <span key={g.on} className="gauge-trend-col">
                <span className="gauge-trend-bar" style={{ height: `${((g.avg ?? 0) / max) * 100}%`, background: path.color }} />
                <span className="xsmall muted">{shortDate(g.on).replace(/ \d+$/, '')}</span>
              </span>
            ))}
          </div>
          <span className="xsmall muted">
            {GAUGE_KEYS.map((k) => `${k} ${r.gaugeTrend[0]!.gauges[k] ?? '–'} → ${r.gaugeTrend.at(-1)!.gauges[k] ?? '–'}`).join(' · ')}
          </span>
        </div>
      )}
      {pathsOf(data).length > 1 && r.minutes > 0 && <span className="xsmall muted">{Math.round(r.share * 100)}% of your goal time this season went here.</span>}
    </section>
  );
}
