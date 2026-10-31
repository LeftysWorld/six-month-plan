import { useState, type ReactNode } from 'react';
import { outboxKey, useStore } from '../data/store.tsx';
import { opsProfile } from '../data/ops.ts';
import { PlanPackSheet } from './PlanPackSheet.tsx';
import { AppUpdatesList } from './UpdateSheet.tsx';
import { resetDemo } from '../data/local.ts';
import { href, navigate } from '../router.ts';
import { opsAddIdeas, parseIdeaFile, type IdeaFileItem } from '../data/backlog.ts';
import type { AppData } from '../data/model.ts';
import { opsAddPracticeWorkout, opsRemovePracticeWorkouts, practiceSource, practiceWorkouts } from '../data/practice.ts';
import { BackLink, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import type { ShellProps } from '../App.tsx';
import { getTheme, setTheme, type Theme } from '../theme.ts';
import { ReminderSettings } from '../components/ReminderSettings.tsx';
import { BodySection, CoachSection, SetCard, Toggle, TrainingSection, nextCoachRun, runLabel } from './SettingsSections.tsx';
import { lastExport, markExported, remindersLive, useSystemStatus, type SystemStatus } from '../data/systemStatus.ts';
import { bodyPrefs, daysBetween, rulesSummary, shortDate, trainingRules, type ISODate } from '@six/core';

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

type SectionId = 'you' | 'week' | 'training' | 'body' | 'coach' | 'reminders' | 'partner' | 'data' | 'advanced';

const ICONS: Record<SectionId, string> = {
  you: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  week: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  training: 'M6 9v6M18 9v6M3 11v2M21 11v2M6 12h12',
  body: 'M4 12h16M7 8v8M11 6v12M15 8v8M19 10v4',
  coach: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z',
  reminders: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  partner: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  data: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  advanced: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
};

const GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: 'You and your week', ids: ['you', 'week'] },
  { label: 'Training and body', ids: ['training', 'body', 'coach'] },
  { label: 'Staying on track', ids: ['reminders', 'partner'] },
  { label: 'Your data', ids: ['data', 'advanced'] },
];

const TITLES: Record<SectionId, string> = {
  you: 'You',
  week: 'Week',
  training: 'Training',
  body: 'Body',
  coach: 'Workout coach',
  reminders: 'Reminders and calendar',
  partner: 'Accountability partner',
  data: 'Your data',
  advanced: 'Advanced',
};

type Pill = { text: string; tone: 'ok' | 'warn' } | null;
interface Issue {
  id: string;
  title: string;
  detail: string;
  section: SectionId;
  action: string;
}

const minutesLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

/** Everything Settings needs to know to summarise each section and flag what's broken. */
function useOverview(signedIn: boolean) {
  const { data, today } = useStore();
  const p = data.profile;
  const status = useSystemStatus(signedIn);
  const rules = trainingRules(p.training_rules);
  const body = bodyPrefs(p.body_prefs);
  const tapeCount = data.measurementTypes.filter((t) => !t.archived_at && /waist|chest|arm|shoulder|neck|thigh|hip|calf|calves|forearm/i.test(t.name)).length;
  const exported = lastExport();
  const sinceExport = exported ? daysBetween(exported as ISODate, today) : null;
  const reminders = remindersLive(status);

  const issues: Issue[] = [];
  if (status.database) issues.push({ id: 'db', title: 'Your database needs an update', detail: status.database.replace(/^Your database needs an update\.\s*/, ''), section: 'advanced', action: 'See how' });
  if (signedIn && reminders === false) issues.push({ id: 'rem', title: 'Reminders aren’t sending', detail: 'Morning, streak saver and Sunday review', section: 'reminders', action: 'Details' });
  if (signedIn && p.partner_email && status.digests === false) issues.push({ id: 'partner', title: 'Partner emails aren’t sending', detail: `Your weekly digest can’t reach ${p.partner_email}`, section: 'partner', action: 'Details' });
  if (signedIn && !p.coach_key_hash) issues.push({ id: 'coach', title: 'The workout coach isn’t connected', detail: 'No weekly review until it is', section: 'coach', action: 'Set up' });
  if (sinceExport == null || sinceExport > 14) issues.push({ id: 'backup', title: sinceExport == null ? 'No backup on this device yet' : `No backup in ${sinceExport} days`, detail: 'Export everything takes a second', section: 'data', action: 'Export' });

  const working = [
    !status.database && 'database up to date',
    signedIn && p.coach_key_hash && 'coach connected',
    signedIn && reminders === true && 'reminders on',
    exported && sinceExport != null && sinceExport <= 14 && `last backup ${shortDate(exported as ISODate)}`,
  ].filter(Boolean) as string[];

  const weekdayMin = p.available_minutes.slice(0, 5);
  const sameWeekdays = weekdayMin.every((m) => m === weekdayMin[0]);
  const summary: Record<SectionId, string> = {
    you: `${p.display_name || 'Your name'} · ${p.timezone.split('/').pop()?.replace(/_/g, ' ')} · ${p.units === 'kg' ? 'kg, cm' : 'lb, in'}`,
    week: `${sameWeekdays ? `${minutesLabel(weekdayMin[0] ?? 0)} on weekdays` : 'Time set per day'} · week starts Monday · review Sunday`,
    training: rulesSummary(rules, p.units),
    body: `Weight daily · ${tapeCount ? `${tapeCount} tape measurement${tapeCount === 1 ? '' : 's'}` : 'tape measurements'} on ${['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][body.measure_day]}`,
    coach: p.coach_key_hash ? `Connected · next run ${runLabel(nextCoachRun(), p.timezone)}` : 'Not connected',
    reminders: 'Morning reminder, streak saver, calendar feed',
    partner: p.partner_email ? `Your week, sent to ${p.partner_email}` : 'Your week, sent to someone after each review',
    data: exported ? `Last export ${shortDate(exported as ISODate)} · export, import` : 'Export, import, backups',
    advanced: 'Account, demo, plan history, delete everything',
  };
  const pills: Record<SectionId, Pill> = {
    you: null,
    week: null,
    training: null,
    body: tapeCount === 0 ? { text: 'New', tone: 'ok' } : null,
    coach: signedIn ? (p.coach_key_hash ? { text: 'On', tone: 'ok' } : { text: 'Not set up', tone: 'warn' }) : null,
    reminders: signedIn && reminders === false ? { text: 'Not set up', tone: 'warn' } : signedIn && reminders === true ? { text: 'On', tone: 'ok' } : null,
    partner: p.partner_email ? (status.digests === false ? { text: 'Not sending', tone: 'warn' } : null) : null,
    data: sinceExport == null || sinceExport > 14 ? { text: 'Back up', tone: 'warn' } : null,
    advanced: null,
  };
  return { issues, working, summary, pills, status };
}

function SectionIcon({ id }: { id: SectionId }) {
  return (
    <span className="set-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[id]} />
      </svg>
    </span>
  );
}

function PillTag({ pill }: { pill: Pill }) {
  if (!pill) return null;
  return <span className={`set-pill${pill.tone === 'warn' ? ' warn' : ''}`}>{pill.text}</span>;
}

function Attention({ issues, working, onExport }: { issues: Issue[]; working: string[]; onExport: () => void }) {
  if (!issues.length) {
    return working.length ? <div className="set-allgood">All working: {working.join(' · ')}</div> : null;
  }
  return (
    <section className="set-attention" aria-label="Needs attention">
      <div className="row-start" style={{ gap: 8 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l9.5 17h-19z" />
          <path d="M12 10v4.5M12 17.5v.01" />
        </svg>
        <b>
          {issues.length} thing{issues.length === 1 ? '' : 's'} need{issues.length === 1 ? 's' : ''} attention
        </b>
      </div>
      <div className="set-attention-list">
        {issues.map((i) =>
          i.section === 'data' ? (
            <button key={i.id} type="button" className="set-issue" onClick={onExport}>
              <span className="grow">
                <b>{i.title}</b>
                <span>{i.detail}</span>
              </span>
              <span className="set-issue-action">{i.action}</span>
            </button>
          ) : (
            <a key={i.id} className="set-issue" href={href(`/settings/${i.section}`)}>
              <span className="grow">
                <b>{i.title}</b>
                <span>{i.detail}</span>
              </span>
              <span className="set-issue-action">{i.action}</span>
            </a>
          ),
        )}
      </div>
      {working.length > 0 && <span className="xsmall muted">Working: {working.join(' · ')}</span>}
    </section>
  );
}

export function Settings(props: ShellProps & { section?: string }) {
  const { data, today } = useStore();
  const toast = useToast();
  const signedIn = !props.demo;
  const section = (Object.keys(TITLES) as SectionId[]).includes(props.section as SectionId) ? (props.section as SectionId) : null;
  const ov = useOverview(signedIn);
  const [, bump] = useState(0);
  const exportAll = () => {
    download(`six-months-${today}.json`, JSON.stringify(data, null, 2), 'application/json');
    markExported(today);
    bump((n) => n + 1);
    toast('Everything exported: keep the file somewhere safe');
  };

  const nav = (
    <nav className="set-nav" aria-label="Settings sections">
      <a className={`set-nav-item${!section ? ' on' : ''}`} href={href('/settings')} aria-current={!section ? 'page' : undefined}>
        Overview
      </a>
      {GROUPS.map((g) => (
        <div key={g.label} className="set-nav-group">
          <span className="mono">{g.label}</span>
          {g.ids.map((id) => (
            <a key={id} className={`set-nav-item${section === id ? ' on' : ''}`} href={href(`/settings/${id}`)} aria-current={section === id ? 'page' : undefined}>
              <span>{TITLES[id]}</span>
              {ov.pills[id]?.tone === 'warn' && <span className="set-dot" aria-label="Needs attention" />}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className={`set-layout${section ? ' in-section' : ''}`}>
      <aside className="set-aside">
        <BackLink label="Today" fallback="/today" />
        <h1 className="set-aside-title">Settings</h1>
        {nav}
      </aside>
      <div className="set-main">
        {section ? (
          <>
            <a className="set-back" href={href('/settings')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
              Settings
            </a>
            <h1 className="set-title">{TITLES[section]}</h1>
            <SectionBody id={section} props={props} status={ov.status} onExport={exportAll} />
          </>
        ) : (
          <div className="set-stack">
            <div className="set-home-head">
              <BackLink label="Today" fallback="/today" />
              <h1 className="set-title">Settings</h1>
            </div>
            <Attention issues={ov.issues} working={ov.working} onExport={exportAll} />
            {GROUPS.map((g) => (
              <div key={g.label} className="set-group">
                <span className="mono set-group-label">{g.label}</span>
                <div className="set-list">
                  {g.ids.map((id) => (
                    <a key={id} className="set-list-row" href={href(`/settings/${id}`)}>
                      <SectionIcon id={id} />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="row-start" style={{ gap: 8 }}>
                          <b>{TITLES[id]}</b>
                          <PillTag pill={ov.pills[id]} />
                        </span>
                        <span className="set-list-summary">{ov.summary[id]}</span>
                      </span>
                      <svg className="set-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {props.onSignOut && !props.demo && (
              <button
                type="button"
                className="btn set-signout"
                onClick={() => {
                  toast('Signing out…');
                  props.onSignOut!();
                }}
              >
                Sign out
              </button>
            )}
            <p className="xsmall muted" style={{ textAlign: 'center', margin: 0 }}>
              Six Months · v0.1 · build {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'} · <a href={href('/settings/advanced')}>Help and keyboard shortcuts</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionBody({ id, props, status, onExport }: { id: SectionId; props: ShellProps; status: SystemStatus; onExport: () => void }): ReactNode {
  switch (id) {
    case 'you':
      return <YouSection />;
    case 'week':
      return <WeekSection />;
    case 'training':
      return <TrainingSection />;
    case 'body':
      return <BodySection />;
    case 'coach':
      return <CoachSection />;
    case 'reminders':
      return <RemindersSection status={status} signedIn={!props.demo} />;
    case 'partner':
      return <PartnerSection status={status} signedIn={!props.demo} />;
    case 'data':
      return <DataSection onExport={onExport} />;
    case 'advanced':
      return <AdvancedSection {...props} />;
  }
}

// ---------- You ----------

function YouSection() {
  const { data, commit } = useStore();
  const p = data.profile;
  const [name, setName] = useState(p.display_name);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [p.timezone];
  return (
    <div className="set-stack">
      <SetCard>
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
      </SetCard>
      <SetCard title="Appearance">
        <div className="seg" role="radiogroup" aria-label="Appearance">
          {(['system', 'dark', 'light'] as Theme[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => {
                setTheme(t);
                setThemeState(t);
              }}
            >
              {t === 'system' ? 'Match device' : t === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </SetCard>
    </div>
  );
}

// ---------- Week ----------

function WeekSection() {
  const { data, commit } = useStore();
  const p = data.profile;
  return (
    <div className="set-stack">
      <SetCard title="Time available each day">
        <span className="set-hint">Used for the capacity check on Today, new goals and weekly planning.</span>
        <div className="set-minutes">
          {WEEKDAY_NAMES.map((d, i) => (
            <label key={d} className="field" style={{ alignItems: 'center' }}>
              {d}
              <input
                type="number"
                min={0}
                step={15}
                inputMode="numeric"
                aria-label={`${d} minutes available`}
                value={p.available_minutes[i] ?? 0}
                onChange={(e) => {
                  const next = [...p.available_minutes];
                  next[i] = Math.max(0, Number(e.target.value));
                  commit(opsProfile({ available_minutes: next }));
                }}
              />
            </label>
          ))}
        </div>
        <span className="set-hint">Minutes per day</span>
      </SetCard>
      <SetCard title="Your week">
        <div className="set-pair">
          <div className="set-fact">
            <span>Week starts</span>
            <b>Monday</b>
          </div>
          <div className="set-fact">
            <span>Weekly review</span>
            <b>Sunday</b>
          </div>
        </div>
        <span className="set-hint">Plans, weekly targets and reviews all run Monday to Sunday.</span>
      </SetCard>
    </div>
  );
}

// ---------- Reminders and calendar ----------

function ServiceStatus({ live, what, missing }: { live: boolean | null; what: string; missing: string }) {
  if (live === null) return null;
  return live ? (
    <div className="set-allgood">{what}</div>
  ) : (
    <div className="banner warn small" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <b>Not set up yet</b>
      <span>{missing}</span>
    </div>
  );
}

function RemindersSection({ status, signedIn }: { status: SystemStatus; signedIn: boolean }) {
  const { data, commit } = useStore();
  const p = data.profile;
  const live = remindersLive(status);
  return (
    <div className="set-stack">
      {signedIn && (
        <ServiceStatus
          live={live}
          what="The reminder service is running."
          missing={`Sending reminders needs the reminder service${status.pushKey === false ? ' and a push key' : ''}, which ${status.pushKey === false && status.reminders === false ? 'aren’t' : 'isn’t'} running yet. Your choices below are saved and used as soon as it is.`}
        />
      )}
      <ReminderSettings />
      <SetCard title="Weekly review">
        <Toggle label="Sunday evening reminder" hint="“Two minutes to review”" on={p.review_reminder ?? true} onChange={(on) => commit(opsProfile({ review_reminder: on }))} />
      </SetCard>
      {signedIn && status.calendar === false && (
        <div className="banner info small">The calendar feed link won’t open in a calendar app until the calendar service is running.</div>
      )}
    </div>
  );
}

// ---------- Accountability partner ----------

function PartnerSection({ status, signedIn }: { status: SystemStatus; signedIn: boolean }) {
  const { data, commit } = useStore();
  const p = data.profile;
  const [partner, setPartner] = useState(p.partner_email ?? '');
  return (
    <div className="set-stack">
      <p className="set-lede">Stakes work better when someone else can see them. After each weekly review, your week in a few lines goes to them: days you showed up, where each goal stands, prizes earned or still not taken.</p>
      {signedIn && p.partner_email && <ServiceStatus live={status.digests} what={`Your weekly digest goes to ${p.partner_email}.`} missing="Emails need the digest service, which isn’t running yet. The address is saved; in the meantime, the review has a Send button that opens the digest in your own email." />}
      <SetCard>
        <label className="field">
          Their email <span style={{ fontWeight: 400 }}>(optional)</span>
          <input type="email" value={partner} onChange={(e) => setPartner(e.target.value)} onBlur={() => partner.trim() !== (p.partner_email ?? '') && commit(opsProfile({ partner_email: partner.trim() || null }))} placeholder="someone who will ask how it went" />
        </label>
      </SetCard>
    </div>
  );
}

// ---------- Your data ----------

function DataSection({ onExport }: { onExport: () => void }) {
  const { data, db, today } = useStore();
  const [importing, setImporting] = useState(false);
  const [addingIdeas, setAddingIdeas] = useState<false | { initial: { name: string; items: IdeaFileItem[] } | null }>(false);
  const exported = lastExport();
  const sets = data.workoutSets.map((w) => {
    const s = data.sessions.find((x) => x.id === w.session_id);
    return { date: s?.date ?? '', workout: s?.title ?? '', exercise: w.exercise, set: w.set_no, weight: w.weight, reps: w.reps, done: w.done };
  });
  return (
    <div className="set-stack">
      <SetCard title="Backup">
        <span className="small">{db.mode === 'demo' ? 'Demo mode: stored only in this browser.' : 'Saved to your private database. A copy of your own is still worth keeping.'}</span>
        <span className="set-hint">{exported ? `Last exported on this device: ${shortDate(exported as ISODate)}${daysBetween(exported as ISODate, today) > 14 ? ' (over two weeks ago)' : ''}.` : 'Not exported on this device yet.'} Every two weeks is plenty.</span>
        <button type="button" className="btn primary" onClick={onExport}>
          Export everything
        </button>
      </SetCard>
      <SetCard title="Spreadsheets">
        <div className="btn-row">
          <button type="button" className="btn small" onClick={() => download(`workouts-${today}.csv`, toCsv(sets as unknown as Record<string, unknown>[]), 'text/csv')}>
            Workout sets
          </button>
          <button type="button" className="btn small" onClick={() => download(`sessions-${today}.csv`, toCsv(data.sessions as unknown as Record<string, unknown>[]), 'text/csv')}>
            Sessions
          </button>
          <button
            type="button"
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
            Measurements
          </button>
        </div>
      </SetCard>
      <SetCard title="Import">
        <span className="set-hint">A full export replaces your data; a list of ideas (text or CSV) is added to your backlog.</span>
        <button type="button" className="btn" onClick={() => setImporting(true)}>
          Import from a file…
        </button>
      </SetCard>
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
    </div>
  );
}

// ---------- Advanced ----------

function AdvancedSection({ demo, email, onExitDemo, onEnterDemo, onSignOut }: ShellProps) {
  const { data, commit, today } = useStore();
  const toast = useToast();
  const [pack, setPack] = useState(false);
  const [startOver, setStartOver] = useState(false);
  return (
    <div className="set-stack">
      <SetCard title="Account">
        <span className="small">{demo ? <><b>Demo mode.</b> Everything here is stored only in this browser.</> : <>Signed in as <b>{email ?? 'you'}</b>.</>}</span>
        {((demo && onExitDemo) || (!demo && (onEnterDemo || onSignOut))) && (
        <div className="btn-row">
          {demo && onExitDemo && (
            <button type="button" className="btn primary small" onClick={onExitDemo}>
              Switch to my account
            </button>
          )}
          {!demo && onEnterDemo && (
            <button type="button" className="btn small" onClick={onEnterDemo}>
              Try the demo
            </button>
          )}
          {!demo && onSignOut && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                toast('Signing out…');
                onSignOut();
              }}
            >
              Sign out
            </button>
          )}
        </div>
        )}
        <span className="set-hint">{demo ? 'Your account’s data is untouched by anything you do in the demo.' : 'The demo keeps you signed in; come back from the demo’s Settings.'}</span>
        {demo && (
          <div className="btn-row">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                resetDemo('example');
                window.location.reload();
              }}
            >
              Reload example data
            </button>
            <button
              type="button"
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
        )}
      </SetCard>

      <SetCard title="Plan packs and updates">
        <span className="small">
          <b>Splits & Backbend Plan</b>: four flexibility goals, a stretching session after each lift, a monthly check. Review it to see every change, or update an earlier version.
        </span>
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setPack(true)}>
          Review the plan pack
        </button>
        <span className="set-hint">Smaller changes, applied with one tap (Today shows any that are waiting):</span>
        <AppUpdatesList />
      </SetCard>
      {pack && <PlanPackSheet onClose={() => setPack(false)} />}

      <SetCard title="Practice workout">
        <span className="set-hint">Adds a copy of {practiceSource(data)?.title ?? 'your first workout'} on today only, to try logging without touching your real history.</span>
        <div className="btn-row">
          <button
            type="button"
            className="btn small"
            disabled={!practiceSource(data)}
            onClick={() => {
              commit(opsAddPracticeWorkout(data, today));
              toast("Practice workout added. It's on Today.");
            }}
          >
            Add a practice workout
          </button>
          {practiceWorkouts(data).length > 0 && (
            <button
              type="button"
              className="btn small danger"
              onClick={() => {
                commit(opsRemovePracticeWorkouts(data));
                toast('Practice workout removed');
              }}
            >
              Remove it
            </button>
          )}
        </div>
      </SetCard>

      <SetCard title="Help">
        <span className="small">On a computer: N add · T Today · G Goals · B Backlog · R Review · ← → change day on Today</span>
        <span className="set-hint">Six Months · v0.1 · build {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}</span>
      </SetCard>

      <SetCard title="Start from scratch">
        <span className="set-hint">Delete every plan, goal, task, log and review and start with a blank app. Export first.</span>
        <button type="button" className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => setStartOver(true)}>
          Delete all my data…
        </button>
      </SetCard>
      {startOver && <StartOver onClose={() => setStartOver(false)} />}
    </div>
  );
}
