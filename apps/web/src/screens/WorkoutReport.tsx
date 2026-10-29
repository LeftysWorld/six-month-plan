import { useMemo, useState } from 'react';
import { shortDate, type ISODate, type WorkoutReport as CoachReport } from '@six/core';
import { useStore } from '../data/store.tsx';
import { workoutReportMarkdown, workoutSnapshot, type Decision, type Snapshot } from '../data/workoutHistory.ts';
import type { Op } from '../data/model.ts';
import { BackLink, useToast } from '../components/ui.tsx';
import { Markdown } from '../components/Markdown.tsx';

const LEVELS = ['Hold', 'Add reps', 'Add weight', 'Change sets', 'Swap one exercise', 'Lighter week', 'New program'];
const STATUS_WORDS: Record<string, string> = {
  applied: 'looks applied',
  partly: 'looks partly applied',
  not_applied: 'not applied',
  pending: 'not applied yet',
  nothing_to_apply: 'nothing to apply',
};

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The workout report: your whole workout history in one report, made in one tap from the data on
 * this device (the same report the workout coach reads through the workout-agent function), and the
 * coach's weekly reports with your verdict on each.
 */
export function WorkoutReport() {
  const { data, today } = useStore();
  const toast = useToast();
  const [months, setMonths] = useState(6);
  const [asOf, setAsOf] = useState<ISODate>(today);
  const [made, setMade] = useState<{ snapshot: Snapshot; markdown: string } | null>(null);
  const reports = [...(data.workoutReports ?? [])].sort((a, b) => (a.as_of < b.as_of ? 1 : -1));
  // What became of each coach report, read from your plan history (the same rule the coach uses).
  const inferred = useMemo(() => new Map(workoutSnapshot(data, today, 24).decisions.map((d) => [d.id, d.inferred_status])), [data, today]);

  const generate = () => {
    const at = asOf > today ? today : asOf;
    setMade(workoutReportMarkdown(data, at, months));
  };

  return (
    <div className="stack">
      <BackLink label="Back" fallback="/settings" />
      <h1>Workout report</h1>
      <p className="small muted" style={{ margin: '-6px 0 0' }}>
        Everything about your workouts in one report: the plan and every change to it, each workout set by set, how each exercise is trending, your notes and past coach decisions. It's made fresh each time from your data, so an edited log is always reflected.
      </p>

      <div className="card stack-sm">
        <div className="report-controls">
          <label className="field">
            Covering
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 2 years</option>
            </select>
          </label>
          <label className="field">
            As of
            <input type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value || today)} />
          </label>
          <button type="button" className="btn primary" onClick={generate}>
            Generate report
          </button>
        </div>
        {made && (
          <div className="row-start" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn small"
              onClick={async () => toast((await copy(made.markdown)) ? 'Report copied' : "Couldn't copy here: use Download instead")}
            >
              Copy
            </button>
            <button type="button" className="btn small" onClick={() => download(`workout-history-${made.snapshot.meta.as_of}.md`, made.markdown)}>
              Download .md
            </button>
            <button type="button" className="btn small ghost" onClick={() => download(`workout-history-${made.snapshot.meta.as_of}.json`, JSON.stringify(made.snapshot, null, 2))}>
              Data (.json)
            </button>
          </div>
        )}
      </div>

      {made && (
        <div className="card">
          <Markdown text={made.markdown} />
        </div>
      )}

      <div className="section-label">Coach reports</div>
      {reports.length === 0 ? (
        <div className="card small muted">
          None yet. Once the workout coach is running, its weekly report lands here: what's going on, what to change (or not) and why. Nothing in your plan changes until you decide.
        </div>
      ) : (
        reports.map((r) => <CoachReportCard key={r.id} report={r} inferred={inferred.get(r.id) ?? null} />)
      )}
    </div>
  );
}

function CoachReportCard({ report: r, inferred }: { report: CoachReport; inferred: string | null }) {
  const { commit } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(r.user_note ?? '');
  const d = (r.decision ?? {}) as Partial<Decision>;
  const level = Number(d.change_level ?? r.change_level ?? 0);
  const recommendation = d.recommendation ?? r.recommendation;
  const save = (patch: Partial<Pick<CoachReport, 'user_status' | 'user_note'>>) => {
    const before = { user_status: r.user_status, user_note: r.user_note };
    commit([{ kind: 'update', collection: 'workoutReports', id: r.id, patch }]);
    return (): Op[] => [{ kind: 'update', collection: 'workoutReports', id: r.id, patch: before }];
  };

  return (
    <div className="card coach-report">
      <div className="coach-report-head">
        <b>Week of {shortDate(r.as_of)}</b>
        <span className="small muted">
          {recommendation === 'change' ? `Change · ${LEVELS[level] ?? `level ${level}`}` : recommendation === 'none' ? 'No recommendation' : 'Hold: no change'}
        </span>
      </div>
      {d.summary && <span className="small">{d.summary}</span>}
      {Array.isArray(d.changes) && d.changes.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {d.changes.map((c, i) => (
            <li key={i}>
              <b>{c.exercise}</b> ({c.workout}): {c.reason}
            </li>
          ))}
        </ul>
      )}
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="status-chips" role="group" aria-label="What you did with it">
          {(['applied', 'partly', 'declined'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              aria-pressed={r.user_status === s}
              onClick={() => {
                const undo = save({ user_status: r.user_status === s ? null : s });
                toast(r.user_status === s ? 'Cleared' : `Marked ${s}`, () => commit(undo()));
              }}
            >
              {s === 'applied' ? 'Applied' : s === 'partly' ? 'Partly' : 'Declined'}
            </button>
          ))}
        </div>
        {!r.user_status && inferred && <span className="xsmall muted">From your plan history: {STATUS_WORDS[inferred] ?? inferred}</span>}
      </div>
      <label className="field">
        Your note for the coach <span style={{ fontWeight: 400 }}>(optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note.trim() !== (r.user_note ?? '') && save({ user_note: note.trim() })} placeholder="e.g. too big a jump on raises, kept 12.5" />
      </label>
      <div className="row-start" style={{ gap: 8 }}>
        <button type="button" className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide the report' : 'Read the report'}
        </button>
        <button type="button" className="btn small ghost" onClick={async () => toast((await copy(r.content_md)) ? 'Copied: paste it into Claude to make the changes' : "Couldn't copy here")}>
          Copy for chat
        </button>
      </div>
      {open && <Markdown text={r.content_md} />}
      <span className="xsmall muted">
        {r.model ? `${r.model} · ` : ''}
        {r.prompt_version ? `prompts ${r.prompt_version} · ` : ''}snapshot {r.snapshot_hash || '–'}
      </span>
    </div>
  );
}
