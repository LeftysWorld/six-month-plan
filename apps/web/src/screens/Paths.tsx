import { useState } from 'react';
import { GAUGE_KEYS, shortDate, type Path, type PathGauges } from '@six/core';
import { useStore } from '../data/store.tsx';
import { minutesText } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import {
  GAUGE_HINT,
  GAUGE_NAME,
  blankPath,
  gaugeAverage,
  opsAddQuestion,
  opsAnswerQuestion,
  opsArchivePath,
  opsCreatePath,
  opsMovePath,
  opsNotePath,
  opsRatePath,
  opsRemoveQuestion,
  opsRestorePath,
  opsSetGoalPath,
  opsSetIdeaPath,
  opsUpdatePath,
  pathLetter,
  pathProgress,
  pathsOf,
} from '../data/paths.ts';
import { goalTrack } from '../data/season.ts';
import { href, navigate } from '../router.ts';
import { BackLink, Icon, Sheet, useToast } from '../components/ui.tsx';
import { IdeaAdd } from './Backlog.tsx';
import { PathExperiments, PathReportCard, TimeByPath } from '../components/PathExperiments.tsx';

/**
 * Odyssey paths: the three five-year lives you could live, side by side. Path A is where you're
 * heading; Path B is what you'd do if A vanished; Path C is what you'd do if money and image didn't
 * matter. Each shows its headline, its year-by-year sketch, your four gauges, and progress measured
 * from the goals on it. A season's goals are how you prototype a path.
 */
export function Paths() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const paths = pathsOf(data);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const [adding, setAdding] = useState(false);

  function add(path: Path) {
    commit(opsCreatePath(path));
    toast(`${path.name || 'Path'} added`, () => commit([{ kind: 'delete', collection: 'paths', id: path.id }]));
    navigate(`/paths/${path.id}`);
  }

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">{paths.length ? `${paths.length} path${paths.length === 1 ? '' : 's'} · 5 years` : 'ODYSSEY PLAN'}</span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <BackLink label="Goals" fallback="/goals" />
      <h1 style={{ marginTop: -4 }}>Paths</h1>

      {paths.length === 0 ? (
        <div className="card dark stack-sm">
          <h2>Three lives you could live.</h2>
          <p className="muted small" style={{ margin: 0 }}>
            An Odyssey Plan sketches three five-year paths: <b>A</b>, the life you're already heading toward; <b>B</b>, what you'd do if that vanished tomorrow; <b>C</b>, what you'd do if money and
            image didn't matter. Each gets a headline, a line per year, four gauges, and the questions a small experiment would answer. Your seasons' goals are those experiments: every goal points at a
            path, so each path's progress is measured, not guessed.
          </p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            Sketch Path A
          </button>
        </div>
      ) : (
        <>
          <div className="paths-grid">
            {paths.map((p, i) => (
              <PathCard key={p.id} path={p} index={i} count={paths.length} />
            ))}
          </div>
          <TimeByPath plan={view.mainPlan} />
        </>
      )}
      {paths.length > 0 && paths.length < 3 && (
        <button className="btn ghost" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} stroke={2.2} /> Sketch Plan {['A', 'B', 'C'][paths.length]}
        </button>
      )}
      {paths.length >= 3 && (
        <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
          + Another path
        </button>
      )}
      <span className="xsmall muted">Re-rate the gauges at each 3-month checkpoint; the retrospective asks what the season taught you about each path.</span>

      {adding && <PathSheet path={blankPath(data, today)} onClose={() => setAdding(false)} onSave={add} />}
    </div>
  );
}

/** One path as a card: headline, gauges, progress from its goals, open questions. */
function PathCard({ path, index, count }: { path: Path; index: number; count: number }) {
  const { data, commit } = useStore();
  const view = useView();
  const p = pathProgress(view, path);
  const avg = gaugeAverage(path.gauges);
  return (
    <section className="card stack-sm path-card" style={{ ['--c' as string]: path.color }} aria-label={`${pathLetter(data, path)}: ${path.name}`}>
      <div className="row-between">
        <span className="mono" style={{ color: path.color }}>
          {pathLetter(data, path).toUpperCase()}
        </span>
        <span className="row-start" style={{ gap: 2 }}>
          <button type="button" className="icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => commit(opsMovePath(data, path, 'up'))}>
            <Icon name="chevron" size={14} stroke={2.4} />
          </button>
          <button type="button" className="icon-btn down" aria-label="Move down" disabled={index === count - 1} onClick={() => commit(opsMovePath(data, path, 'down'))}>
            <Icon name="chevron" size={14} stroke={2.4} />
          </button>
        </span>
      </div>
      <a href={href(`/paths/${path.id}`)} className="path-card-link">
        <h2 className="path-name">{path.name || 'Untitled path'}</h2>
        {path.headline && <p className="path-headline">{path.headline}</p>}
        <Gauges gauges={path.gauges} compact />
        <span className="season-track" style={{ marginLeft: 0 }} aria-label={`${p.prog}% of this path's goals done`}>
          <span className="season-fill" style={{ width: `${p.prog}%`, background: path.color }} />
        </span>
        <span className="xsmall muted">
          {p.goals.length === 0
            ? 'No goals on this path yet'
            : `${p.finished} of ${p.goals.length} goal${p.goals.length === 1 ? '' : 's'} done${p.running ? ` · ${p.running} running${p.judged ? `, ${p.onPace} on pace` : ''}` : ''}`}
          {p.minutes ? ` · ${minutesText(p.minutes)} on ${p.days} day${p.days === 1 ? '' : 's'}` : ''}
        </span>
        <span className="xsmall muted">
          {p.questionsOpen ? `${p.questionsOpen} open question${p.questionsOpen === 1 ? '' : 's'}` : path.questions.length ? 'Every question answered' : 'No questions yet'}
          {p.waiting.length ? ` · ${p.waiting.length} idea${p.waiting.length === 1 ? '' : 's'} waiting` : ''}
          {avg != null ? ` · gauges ${avg}/5` : ''}
        </span>
      </a>
    </section>
  );
}

/** The four gauges as rows of five dots. */
export function Gauges({ gauges, compact = false, onChange }: { gauges: Partial<PathGauges>; compact?: boolean; onChange?: (g: Partial<PathGauges>) => void }) {
  return (
    <div className={`gauges${compact ? ' compact' : ''}`}>
      {GAUGE_KEYS.map((k) => (
        <div key={k} className="gauge-row" title={GAUGE_HINT[k]}>
          <span className="gauge-name">{GAUGE_NAME[k]}</span>
          <span className="gauge-dots" role={onChange ? 'radiogroup' : undefined} aria-label={onChange ? `${GAUGE_NAME[k]}: ${GAUGE_HINT[k]}` : `${GAUGE_NAME[k]} ${gauges[k] ?? 'not rated'} of 5`}>
            {[1, 2, 3, 4, 5].map((n) =>
              onChange ? (
                <button key={n} type="button" role="radio" aria-checked={gauges[k] === n} aria-label={`${n}`} className={`gauge-dot${(gauges[k] ?? 0) >= n ? ' on' : ''}`} onClick={() => onChange({ ...gauges, [k]: gauges[k] === n ? undefined : n })} />
              ) : (
                <span key={n} className={`gauge-dot${(gauges[k] ?? 0) >= n ? ' on' : ''}`} />
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Make or edit a path: name, headline, why, a line per year. */
function PathSheet({ path, onClose, onSave }: { path: Path; onClose: () => void; onSave: (p: Path) => void }) {
  const [name, setName] = useState(path.name);
  const [headline, setHeadline] = useState(path.headline);
  const [why, setWhy] = useState(path.why);
  const [years, setYears] = useState<string[]>(path.years.length ? path.years : ['', '', '', '', '']);
  const fresh = !path.name;
  return (
    <Sheet title={fresh ? 'A path' : 'Edit path'} onClose={onClose}>
      <label className="field">
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The AI governance consultant" />
      </label>
      <label className="field">
        Headline <span style={{ fontWeight: 400 }}>(six words)</span>
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Trusted, independent, three clients, Myrtle Beach" />
      </label>
      <label className="field">
        Why this life
        <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What it would give you that the others wouldn't" />
      </label>
      <div className="stack-sm">
        <span className="label">Year by year</span>
        {years.map((y, i) => (
          <label key={i} className="field">
            Year {i + 1}
            <input value={y} onChange={(e) => setYears(years.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? 'e.g. AIGP and ISO 42001 passed, first paid engagement' : i === 4 ? 'e.g. Where you are in five years' : ''} />
          </label>
        ))}
      </div>
      <button className="btn primary" disabled={!name.trim()} onClick={() => onSave({ ...path, name: name.trim(), headline: headline.trim(), why: why.trim(), years })}>
        {fresh ? 'Add path' : 'Save'}
      </button>
    </Sheet>
  );
}

/**
 * One path: its sketch, the gauges to rate, the questions a prototype would answer, the goals and
 * ideas on it (with their progress), and what each season taught you about it.
 */
export function PathDetail({ id }: { id: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const path = data.paths.find((p) => p.id === id);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState('');
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  if (!path) {
    return (
      <div className="stack">
        <BackLink label="Paths" fallback="/paths" />
        <div className="card empty">That path isn't here any more.</div>
      </div>
    );
  }
  const p = pathProgress(view, path);
  const running = p.goals.filter((g) => !g.completed_at);
  const finished = p.goals.filter((g) => g.completed_at);
  const otherGoals = view.activeGoals.filter((g) => g.path_id !== path.id);
  const otherIdeas = data.ideas.filter((i) => i.status === 'backlog' && i.path_id !== path.id);
  const lastRated = path.gauge_log.at(-1)?.on;

  return (
    <div className="stack">
      <BackLink label="Paths" fallback="/paths" />
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <span className="mono" style={{ color: path.color }}>
            {pathLetter(data, path).toUpperCase()} · {path.horizon_years} YEARS
          </span>
          <h1 style={{ margin: 0 }}>{path.name}</h1>
          {path.headline && <p className="path-headline" style={{ margin: 0 }}>{path.headline}</p>}
        </div>
        <button className="btn small" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      {path.why && <p className="then-now-why">“{path.why}”</p>}

      <section className="card stack-sm" aria-label="Year by year">
        <span className="label">Year by year</span>
        {path.years.map((y, i) => (
          <div key={i} className="row-start small" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span className="mono" style={{ flex: 'none', width: 44, color: 'var(--muted)' }}>
              YEAR {i + 1}
            </span>
            <span style={{ color: y ? 'inherit' : 'var(--muted)' }}>{y || '—'}</span>
          </div>
        ))}
      </section>

      <section className="card stack-sm" aria-label="Gauges">
        <div className="row-between">
          <span className="label">Gauges</span>
          <span className="xsmall muted">{lastRated ? `Rated ${shortDate(lastRated)}` : 'Tap the dots to rate'}</span>
        </div>
        <Gauges
          gauges={path.gauges}
          onChange={(g) => {
            const ops = opsRatePath(path, g, today);
            if (ops.length) commit(ops);
          }}
        />
        {path.gauge_log.length > 1 && (
          <span className="xsmall muted">
            {path.gauge_log
              .slice(-4)
              .map((e) => `${shortDate(e.on)}: ${gaugeAverage(e.gauges) ?? '–'}`)
              .join(' → ')}
          </span>
        )}
      </section>

      <section className="card stack-sm" aria-label="Progress">
        <span className="label">Progress, from your goals</span>
        <span className="season-track" style={{ marginLeft: 0 }} aria-label={`${p.prog}% of this path's goals done`}>
          <span className="season-fill" style={{ width: `${p.prog}%`, background: path.color }} />
        </span>
        <span className="small">
          {p.goals.length === 0 ? 'No goals on this path yet.' : `${p.finished} of ${p.goals.length} goal${p.goals.length === 1 ? '' : 's'} done.`}
          {p.minutes ? ` ${minutesText(p.minutes)} put in on ${p.days} day${p.days === 1 ? '' : 's'}.` : ''}
        </span>
        {running.map((g) => {
          const plan = view.planForGoal(g);
          const t = plan ? goalTrack(view, g, plan) : null;
          return (
            <a key={g.id} href={href(`/goals/${g.id}`)} className="row-between small" style={{ textDecoration: 'none', color: 'inherit', gap: 8 }}>
              <span className="row-start" style={{ gap: 8, minWidth: 0, flexWrap: 'nowrap' }}>
                <span className="dot" style={{ background: g.color, flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</span>
              </span>
              <span className="xsmall muted" style={{ flex: 'none' }}>
                {t ? `${t.status} · ${t.prog}%` : ''}
              </span>
            </a>
          );
        })}
        {finished.map((g) => (
          <a key={g.id} href={href(`/goals/${g.id}`)} className="row-between small muted" style={{ textDecoration: 'none', gap: 8 }}>
            <span className="row-start" style={{ gap: 8, minWidth: 0, flexWrap: 'nowrap' }}>
              <Icon name="check" size={13} stroke={3} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</span>
            </span>
            <span className="xsmall" style={{ flex: 'none' }}>
              Done {shortDate(view.dayOf(g.completed_at!))}
            </span>
          </a>
        ))}
        <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn small primary" href={href(`/goals/new?path=${path.id}`)}>
            Prototype this: make a goal
          </a>
          {otherGoals.length > 0 && (
            <select className="input" style={{ maxWidth: 220 }} aria-label="Put a goal on this path" value="" onChange={(e) => { const g = otherGoals.find((x) => x.id === e.target.value); if (g) { commit(opsSetGoalPath(g, path.id)); toast(`${g.title} is on ${pathLetter(data, path)}`, () => commit(opsSetGoalPath(g, g.path_id ?? null))); } }}>
              <option value="">Put a running goal on this path…</option>
              {otherGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      <section className="card stack-sm" aria-label="Open questions">
        <span className="label">Questions a prototype would answer</span>
        {path.questions.length === 0 && <span className="small muted">What would you need to find out before you'd commit to this life? One question at a time; a season's goal can answer it.</span>}
        {path.questions.map((q) => (
          <div key={q.id} className="stack-sm" style={{ gap: 4 }}>
            <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <span className="row-start small" style={{ gap: 8, alignItems: 'flex-start', minWidth: 0 }}>
                <span className={`ring ${q.answered_at ? 'done' : ''}`} style={{ width: 20, height: 20, flex: 'none', marginTop: 1 }}>
                  {q.answered_at && <Icon name="check" size={11} stroke={3.2} />}
                </span>
                <span style={{ textDecoration: q.answered_at ? 'line-through' : undefined, color: q.answered_at ? 'var(--muted)' : undefined }}>{q.text}</span>
              </span>
              <span className="row-start" style={{ gap: 2, flex: 'none' }}>
                <button type="button" className="link-btn small" onClick={() => { setAnswering(answering === q.id ? null : q.id); setAnswer(q.answer); }}>
                  {q.answered_at ? 'Edit' : 'Answer'}
                </button>
                <button type="button" className="link-btn small" aria-label={`Remove question: ${q.text}`} onClick={() => { commit(opsRemoveQuestion(path, q.id)); toast('Question removed', () => commit(opsUpdatePath({ ...path, questions: path.questions.filter((x) => x.id !== q.id) }, { questions: path.questions }))); }}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            </div>
            {q.answer && answering !== q.id && (
              <span className="xsmall" style={{ color: 'var(--ink-2)', marginLeft: 28 }}>
                {q.answer}
                {q.answered_at ? ` · ${shortDate(view.dayOf(q.answered_at))}` : ''}
              </span>
            )}
            {answering === q.id && (
              <form
                className="row-start"
                style={{ gap: 8, marginLeft: 28, flexWrap: 'nowrap' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  commit(opsAnswerQuestion(path, q.id, answer, today));
                  toast(answer.trim() ? 'Answered' : 'Answer cleared');
                  setAnswering(null);
                }}
              >
                <input className="input" autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="What you learned" />
                <button className="btn small primary" type="submit">
                  Save
                </button>
              </form>
            )}
          </div>
        ))}
        <form
          className="row-start"
          style={{ gap: 8, flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!question.trim()) return;
            commit(opsAddQuestion(path, question));
            setQuestion('');
          }}
        >
          <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Would anyone pay for a 90-day governance readiness check?" />
          <button className="btn small" type="submit" disabled={!question.trim()}>
            Add
          </button>
        </form>
      </section>

      <PathExperiments path={path} />
      <PathReportCard path={path} plan={view.mainPlan} />

      <section className="card stack-sm" aria-label="Ideas on this path">
        <span className="label">Ideas waiting on this path</span>
        {p.waiting.length === 0 && <span className="small muted">Nothing in the backlog for this path yet.</span>}
        {p.waiting.map((i) => (
          <div key={i.id} className="row-between small" style={{ gap: 8 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
            <a className="link-btn small" href={href(`/ideas/${i.id}/plan?path=${path.id}`)} style={{ flex: 'none' }}>
              Make it a goal
            </a>
          </div>
        ))}
        <IdeaAdd placeholder="An idea for this path…" pathId={path.id} />
        {otherIdeas.length > 0 && (
          <select className="input" aria-label="Move an idea onto this path" value="" onChange={(e) => { const i = otherIdeas.find((x) => x.id === e.target.value); if (i) { commit(opsSetIdeaPath(i, path.id)); toast(`${i.title} is on ${pathLetter(data, path)}`); } }}>
            <option value="">Move a backlog idea onto this path…</option>
            {otherIdeas.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="card stack-sm" aria-label="What the seasons taught you">
        <span className="label">What the seasons taught you</span>
        {path.notes.length === 0 && <span className="small muted">The retrospective asks this for each path. You can write it any time.</span>}
        {[...path.notes]
          .sort((a, b) => (a.on < b.on ? 1 : -1))
          .map((n) => (
            <span key={n.on} className="small" style={{ color: 'var(--ink-2)' }}>
              <span className="mono" style={{ fontSize: 10.5 }}>
                {shortDate(n.on).toUpperCase()}
              </span>{' '}
              {n.text}
            </span>
          ))}
        <form
          className="row-start"
          style={{ gap: 8, flexWrap: 'nowrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            const ops = opsNotePath(path, note, today);
            if (ops.length) {
              commit(ops);
              toast('Noted');
              setNote('');
            }
          }}
        >
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you know now that you didn't" />
          <button className="btn small" type="submit" disabled={!note.trim()}>
            Add
          </button>
        </form>
      </section>

      <button
        className="link-btn small"
        style={{ alignSelf: 'flex-start', color: 'var(--muted)' }}
        onClick={() => {
          const goals = data.goals.filter((g) => g.path_id === path.id);
          const ideas = data.ideas.filter((i) => i.path_id === path.id);
          commit(opsArchivePath(data, path, true));
          toast(`${path.name} let go. Its goals and ideas stay.`, () => commit(opsRestorePath(path, goals, ideas)));
          navigate('/paths');
        }}
      >
        Let this path go
      </button>

      {editing && (
        <PathSheet
          path={path}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            const ops = opsUpdatePath(path, { name: next.name, headline: next.headline, why: next.why, years: next.years });
            if (ops.length) {
              commit(ops);
              toast('Path saved', () => commit(opsUpdatePath(next, { name: path.name, headline: path.headline, why: path.why, years: path.years })));
            }
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
