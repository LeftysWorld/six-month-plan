import { useState } from 'react';
import { outboxKey, useStore } from '../data/store.tsx';
import { opsProfile } from '../data/ops.ts';
import { PlanPackSheet } from './PlanPackSheet.tsx';
import { resetDemo } from '../data/local.ts';
import { navigate } from '../router.ts';
import { opsAddIdeas, parseIdeaFile, type IdeaFileItem } from '../data/backlog.ts';
import type { AppData } from '../data/model.ts';
import { opsAddPracticeWorkout, opsRemovePracticeWorkouts, practiceSource, practiceWorkouts } from '../data/practice.ts';
import { BackLink, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import type { ShellProps } from '../App.tsx';
import { getTheme, setTheme, type Theme } from '../theme.ts';
import { ReminderSettings } from '../components/ReminderSettings.tsx';

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

declare const __APP_VERSION__: string;

/** Deletes every plan, goal, task, log and review after you type DELETE. Settings stay. */
function StartOver({ onClose }: { onClose: () => void }) {
  const { db, data } = useStore();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = [
    [data.paths.filter((p) => !p.archived_at).length, 'path'],
    [data.plans.length, 'season'],
    [data.goals.length, 'goal'],
    [data.actions.length, 'task'],
    [data.sessions.filter((s) => s.status !== 'planned').length, 'logged task'],
    [data.measurements.length, 'measurement'],
    [data.reviews.length, 'review'],
  ] as const;
  const summary = counts
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
    .join(', ');

  async function wipe() {
    setBusy(true);
    setError(null);
    try {
      localStorage.removeItem(outboxKey(db.userId)); // drop any unsaved changes so they don't come back
      await db.wipeAll();
      window.location.hash = '#/';
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Start from scratch" onClose={busy ? () => {} : onClose}>
      <p className="small" style={{ margin: 0 }}>
        This permanently deletes {summary || 'everything you have added'}. Your name, time zone, units and daily hours stay.
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        Want a copy first? Close this and use Export everything.
      </p>
      <label className="field">
        Type DELETE to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
      </label>
      {error && <div className="banner warn" role="alert">Couldn't delete everything: {error}</div>}
      <button className="btn danger-solid" disabled={typed.trim().toUpperCase() !== 'DELETE' || busy} onClick={() => void wipe()}>
        {busy ? 'Deleting…' : 'Delete all my data'}
      </button>
    </Sheet>
  );
}

/** Adds goal ideas from a JSON file to the end of the backlog. Nothing else changes. */
function AddIdeas({ onClose, initial = null }: { onClose: () => void; initial?: { name: string; items: IdeaFileItem[] } | null }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; items: IdeaFileItem[] } | null>(initial);
  const [error, setError] = useState<string | null>(null);

  async function pick(f: File | undefined) {
    setError(null);
    setFile(null);
    if (!f) return;
    try {
      setFile({ name: f.name, items: parseIdeaFile(await f.text()) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const plan = file ? opsAddIdeas(data, file.items) : null;
  function run() {
    if (!plan || !plan.added.length) return;
    commit(plan.ops);
    toast(`Added ${plan.added.length} idea${plan.added.length === 1 ? '' : 's'} to the backlog`);
    onClose();
    navigate('/goals/backlog');
  }

  return (
    <Sheet title="Add ideas from a file" onClose={onClose}>
      <p className="small" style={{ margin: 0 }}>
        The ideas join the end of your backlog. Nothing you already have changes, and an idea with the same name as a goal or idea you have is skipped.
      </p>
      {file && <div className="small">{file.name}</div>}
      <label className="field">
        Choose a .json file
        <input type="file" accept="application/json,.json" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {plan && (
        <div className="banner" role="status">
          {plan.added.length ? `Adds: ${plan.added.join(', ')}` : 'Every idea in this file is already in the app.'}
          {plan.skipped.length > 0 && <div className="xsmall">Already there, skipped: {plan.skipped.join(', ')}</div>}
        </div>
      )}
      {error && <div className="banner warn" role="alert">{error}</div>}
      <button className="btn primary" disabled={!plan || !plan.added.length} onClick={run}>
        Add to the backlog
      </button>
    </Sheet>
  );
}

/** Replaces everything in the app with a JSON file (from Export everything, or one made for you). */
function ImportData({ onClose, onIdeasFile }: { onClose: () => void; onIdeasFile: (file: { name: string; items: IdeaFileItem[] }) => void }) {
  const { db } = useStore();
  const [file, setFile] = useState<{ name: string; data: AppData } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(f: File | undefined) {
    setError(null);
    setFile(null);
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as Partial<AppData>;
      // A file of goal ideas only (no goals or tasks) is added to the backlog, never used to replace everything.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed.goals) && !Array.isArray(parsed.actions) && Array.isArray(parsed.ideas)) {
        onIdeasFile({ name: f.name, items: parseIdeaFile(text) });
        return;
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.goals) || !Array.isArray(parsed.actions)) {
        throw new Error("This doesn't look like a Six Months file.");
      }
      setFile({ name: f.name, data: parsed as AppData });
    } catch (e) {
      setError(e instanceof SyntaxError ? "This file isn't valid JSON." : (e as Error).message);
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      localStorage.removeItem(outboxKey(db.userId)); // unsaved changes belong to the data being replaced
      await db.importAll(file.data);
      window.location.hash = '#/';
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const d = file?.data;
  const count = (n: number | undefined, w: string) => `${n ?? 0} ${w}${n === 1 ? '' : 's'}`;
  return (
    <Sheet title="Import from a file" onClose={busy ? () => {} : onClose}>
      <p className="small" style={{ margin: 0 }}>
        Everything in the app is replaced by what's in the file. Attachments aren't included in files, so they're left out.
      </p>
      <label className="field">
        Choose a .json file
        <input type="file" accept="application/json,.json" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {d && (
        <div className="banner" role="status">
          {file.name}: {count(d.goals?.length, 'goal')}, {count(d.actions?.length, 'task')}, {count(d.measurements?.length, 'measurement')}
        </div>
      )}
      {d && (
        <label className="field">
          Type REPLACE to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
        </label>
      )}
      {error && <div className="banner warn" role="alert">{error}</div>}
      <button className="btn danger-solid" disabled={!d || typed.trim().toUpperCase() !== 'REPLACE' || busy} onClick={() => void run()}>
        {busy ? 'Importing…' : 'Replace my data with this file'}
      </button>
    </Sheet>
  );
}

export function Settings({ demo, email, onExitDemo, onEnterDemo, onSignOut }: ShellProps) {
  const { data, db, commit, today } = useStore();
  const toast = useToast();
  const p = data.profile;
  const [pack, setPack] = useState(false);
  const [name, setName] = useState(p.display_name);
  const [partner, setPartner] = useState(p.partner_email ?? '');
  const [startOver, setStartOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [addingIdeas, setAddingIdeas] = useState<false | { initial: { name: string; items: IdeaFileItem[] } | null }>(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [p.timezone];

  return (
    <div className="stack">
      <BackLink label="Today" fallback="/today" />
      <h1>Settings</h1>

      <div className="section-label">Account</div>
      <div className="card stack-sm">
        <div className="small">
          {demo ? (
            <>
              <b>Demo mode.</b> Everything here is stored only in this browser.
            </>
          ) : (
            <>
              Signed in as <b>{email ?? 'you'}</b>. Saved to your private Supabase database.
            </>
          )}
        </div>
        <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
          {demo && onExitDemo && (
            <button className="btn primary small" onClick={onExitDemo}>
              Switch to my account
            </button>
          )}
          {!demo && onEnterDemo && (
            <button className="btn small" onClick={onEnterDemo}>
              Switch to the demo
            </button>
          )}
          {!demo && onSignOut && (
            <button
              className="btn small"
              onClick={() => {
                toast('Signing out…');
                onSignOut();
              }}
            >
              Switch user
            </button>
          )}
        </div>
        <span className="xsmall muted">
          {demo
            ? onExitDemo
              ? 'Your account’s data is untouched by anything you do in the demo. To move demo data into your account: Export here, switch, then Import.'
              : 'Add your Supabase keys to apps/web/.env.local to sign in for real.'
            : '“Switch to the demo” keeps you signed in; come back from the demo’s Settings. “Switch user” signs out, so another account can sign in on this browser.'}
        </span>
      </div>

      <div className="section-label">You</div>
      <div className="card stack">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== p.display_name && commit(opsProfile({ display_name: name.trim() }))} />
        </label>
        <label className="field">
          Time zone (decides when "today" starts)
          <select value={p.timezone} onChange={(e) => commit(opsProfile({ timezone: e.target.value }))}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Units
          <select value={p.units} onChange={(e) => commit(opsProfile({ units: e.target.value as 'lb' | 'kg' }))}>
            <option value="lb">Pounds and inches</option>
            <option value="kg">Kilograms and centimetres</option>
          </select>
        </label>
      </div>

      <div className="section-label">Appearance</div>
      <div className="seg" role="tablist" aria-label="Appearance">
        {(['system', 'dark', 'light'] as Theme[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={theme === t}
            onClick={() => {
              setTheme(t);
              setThemeState(t);
            }}
          >
            {t === 'system' ? 'Match device' : t === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>

      <ReminderSettings />

      <div className="section-label">Accountability partner</div>
      <div className="card stack">
        <label className="field">
          Their email <span style={{ fontWeight: 400 }}>(optional)</span>
          <input type="email" value={partner} onChange={(e) => setPartner(e.target.value)} onBlur={() => partner.trim() !== (p.partner_email ?? '') && commit(opsProfile({ partner_email: partner.trim() || null }))} placeholder="someone who will ask how it went" />
        </label>
        <span className="xsmall muted">
          Each weekly review ends with your week in a few lines: days you showed up, where each goal stands, prizes earned or still not taken. With an email here, that digest goes to them when you save the review (on Supabase, once <code>send-digests</code> is deployed; in demo mode, use the Send button on the review). Stakes work better when someone else can see them.
        </span>
        <label className="check-row small">
          <input type="checkbox" checked={p.review_reminder ?? true} onChange={(e) => commit(opsProfile({ review_reminder: e.target.checked }))} />
          <span>Sunday evening reminder: “two minutes to review” (needs reminders on, above)</span>
        </label>
      </div>

      <div className="section-label">Plans</div>
      <div className="card stack-sm">
        <span className="small">
          <b>Splits & Backbend Plan</b> (from Fri Oct 30): four flexibility goals in Body, a timed stretching session after every lift on Mon, Tue, Thu, Fri and Sat, a monthly check, and workouts moved off Wednesday. You see every change before it's made; applied the earlier version? This updates it.
        </span>
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setPack(true)}>
          Review
        </button>
      </div>
      {pack && <PlanPackSheet onClose={() => setPack(false)} />}

      <div className="section-label">Time available each day</div>
      <div className="card stack-sm">
        <p className="xsmall muted" style={{ margin: 0 }}>
          Used for the capacity check on Today, new goals and weekly planning.
        </p>
        <div className="grid-3" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {WEEKDAY_NAMES.map((d, i) => (
            <label key={d} className="field" style={{ alignItems: 'center' }}>
              {d}
              <input
                type="number"
                min={0}
                step={15}
                aria-label={`${d} minutes available`}
                value={p.available_minutes[i] ?? 0}
                style={{ padding: '10px 4px', textAlign: 'center' }}
                onChange={(e) => {
                  const next = [...p.available_minutes];
                  next[i] = Math.max(0, Number(e.target.value));
                  commit(opsProfile({ available_minutes: next }));
                }}
              />
            </label>
          ))}
        </div>
        <span className="xsmall muted">Minutes per day</span>
      </div>

      <div className="section-label">Your data</div>
      <div className="card stack-sm">
        <div className="small">
          {db.mode === 'demo' ? 'Demo mode: stored only in this browser.' : 'Saved to your private Supabase database.'}
        </div>
        <button className="btn" onClick={() => download(`six-months-${today}.json`, JSON.stringify(data, null, 2), 'application/json')}>
          Export everything (JSON)
        </button>
        <div className="btn-row">
          <button className="btn small" onClick={() => download(`sessions-${today}.csv`, toCsv(data.sessions as unknown as Record<string, unknown>[]), 'text/csv')}>
            Sessions CSV
          </button>
          <button
            className="btn small"
            onClick={() =>
              download(
                `measurements-${today}.csv`,
                toCsv(
                  data.measurements.map((m) => ({
                    date: m.measured_on,
                    measure: data.measurementTypes.find((t) => t.id === m.type_id)?.name ?? '',
                    value: m.value,
                    unit: data.measurementTypes.find((t) => t.id === m.type_id)?.unit ?? '',
                    note: m.note,
                  })),
                ),
                'text/csv',
              )
            }
          >
            Measurements CSV
          </button>
        </div>
        <button className="btn" onClick={() => setAddingIdeas({ initial: null })}>
          Add ideas from a file…
        </button>
        <button className="btn" onClick={() => setImporting(true)}>
          Import from a file…
        </button>
      </div>
      {addingIdeas && <AddIdeas initial={addingIdeas.initial} onClose={() => setAddingIdeas(false)} />}
      {importing && (
        <ImportData
          onClose={() => setImporting(false)}
          onIdeasFile={(file) => {
            setImporting(false);
            setAddingIdeas({ initial: file });
          }}
        />
      )}

      {demo && (
        <>
          <div className="section-label">Demo</div>
          <div className="card stack-sm">
            <div className="btn-row">
              <button
                className="btn small"
                onClick={() => {
                  resetDemo('example');
                  window.location.reload();
                }}
              >
                Reload example data
              </button>
              <button
                className="btn small danger"
                onClick={() => {
                  if (!window.confirm('Start with an empty demo? The example data will be removed from this browser.')) return;
                  resetDemo('empty');
                  window.location.reload();
                }}
              >
                Start empty
              </button>
            </div>
          </div>
        </>
      )}

      <div className="section-label">Try the workout log</div>
      <div className="card stack-sm">
        <p className="small muted" style={{ margin: 0 }}>
          Adds a copy of {practiceSource(data)?.title ?? 'your first workout'} on today only, so you can try logging sets before your first real workout. Removing it deletes it and anything you logged on it.
        </p>
        <div className="btn-row">
          <button
            className="btn small"
            disabled={!practiceSource(data)}
            onClick={() => {
              commit(opsAddPracticeWorkout(data, today));
              toast("Practice workout added. It's on Today.");
            }}
          >
            Add a practice workout today
          </button>
          {practiceWorkouts(data).length > 0 && (
            <button
              className="btn small danger"
              onClick={() => {
                commit(opsRemovePracticeWorkouts(data));
                toast('Practice workout removed');
              }}
            >
              Remove practice workout{practiceWorkouts(data).length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      <div className="section-label">Start from scratch</div>
      <div className="card stack-sm">
        <p className="small muted" style={{ margin: 0 }}>
          Delete every plan, goal, task, log and review and start with a blank app.
        </p>
        <button className="btn danger" onClick={() => setStartOver(true)}>
          Delete all my data…
        </button>
      </div>
      {startOver && <StartOver onClose={() => setStartOver(false)} />}

      <p className="xsmall muted" style={{ textAlign: 'center', margin: 0 }}>
        On a computer: N add · T Today · G Goals · B Backlog · R Review · ← → change day on Today
      </p>
      <p className="xsmall muted" style={{ textAlign: 'center' }}>
        Six Months · v0.1 · build {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}
      </p>
    </div>
  );
}
