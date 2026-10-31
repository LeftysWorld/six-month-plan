import { useEffect, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { opsProfile } from '../data/ops.ts';
import { getSupabase } from '../data/supabase.ts';
import { Icon, useToast } from './ui.tsx';

/**
 * Setting up the workout coach from the app, no command line and no GitHub: the app serves the
 * coach's door itself (/api/workout-agent on Vercel), makes the coach's key here, tests the
 * connection, and shows exactly what to paste into the coach's own Vercel project, which runs it
 * every Friday (and on Run in Vercel → Cron Jobs).
 */

const VERCEL_ENV = 'https://vercel.com/dashboard';
const SUPABASE_KEYS = 'https://supabase.com/dashboard/project/_/settings/api-keys';

type Test = { state: 'idle' | 'running' } | { state: 'ok'; detail: string } | { state: 'fail'; detail: string; fix?: string };

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `wc_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const toast = useToast();
  return (
    <div className="coach-copy">
      <span className="mono">{label}</span>
      <code className={secret ? 'secret' : ''}>{value}</code>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => toast(`${label} copied`));
        }}
      >
        Copy
      </button>
    </div>
  );
}

// ---------- Run the coach now ----------

const COACH_URL_KEY = 'six.coachUrl';
/** The coach's own Vercel project (the address Vercel shows for it). */
const DEFAULT_COACH_URL = 'https://workout-coach-peach.vercel.app';

export function coachUrl(): string {
  try {
    return (localStorage.getItem(COACH_URL_KEY) || DEFAULT_COACH_URL).replace(/\/+$/, '');
  } catch {
    return DEFAULT_COACH_URL;
  }
}

interface RunResult {
  as_of?: string;
  recommendation?: string;
  change_level?: number;
  summary?: string;
  changes?: number;
  published?: boolean;
  failed?: boolean;
  error?: string | null;
}

/**
 * "Run the coach now": starts one review on the coach's Vercel project with your sign-in (the coach
 * checks it's the account its key belongs to), waits for it (a minute or two), shows what it said and
 * brings the new report in. The Friday schedule is separate and unchanged.
 */
export function RunCoachButton() {
  const { db, reload } = useStore();
  const toast = useToast();
  const [state, setState] = useState<{ phase: 'idle' } | { phase: 'running'; since: number } | { phase: 'done'; result: RunResult } | { phase: 'error'; message: string }>({ phase: 'idle' });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.phase !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.phase]);

  if (db.mode !== 'supabase') return <span className="small muted">Sign in to run the coach.</span>;

  async function run() {
    setState({ phase: 'running', since: Date.now() });
    setNow(Date.now());
    try {
      const { data: s } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
      const token = s.session?.access_token;
      if (!token) return setState({ phase: 'error', message: "You're not signed in. Sign in and try again." });
      const res = await fetch(`${coachUrl()}/api/run`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      const body = (await res.json().catch(() => ({}))) as RunResult;
      if (!res.ok) return setState({ phase: 'error', message: body.error ?? `The coach answered ${res.status}.` });
      setState({ phase: 'done', result: body });
      await reload();
      toast(body.published ? 'Coach report saved' : 'The coach ran (report not saved: publishing is off)');
    } catch (e) {
      setState({ phase: 'error', message: `Couldn't reach the coach at ${coachUrl()}: ${(e as Error).message}. Check its address in Settings → Workout coach → Set up the weekly coach.` });
    }
  }

  const secs = state.phase === 'running' ? Math.max(0, Math.round((now - state.since) / 1000)) : 0;
  return (
    <div className="stack-sm" style={{ gap: 8 }}>
      <button type="button" className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => void run()} disabled={state.phase === 'running'}>
        {state.phase === 'running' ? `Running… ${secs}s` : 'Run the coach now'}
      </button>
      {state.phase === 'running' && <span className="xsmall muted">It reads your history, thinks it through and writes the report: usually a minute or two. Keep this page open.</span>}
      {state.phase === 'done' && (
        <div className={`banner ${state.result.failed ? 'warn' : 'info'} small`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <b>
            {state.result.failed ? 'The coach ran into a problem' : state.result.recommendation === 'change' ? `Change, level ${state.result.change_level}` : state.result.recommendation === 'hold' ? 'Hold: no change' : 'No recommendation this week'}
            {state.result.as_of ? ` · as of ${state.result.as_of}` : ''}
          </b>
          {state.result.summary && <span>{state.result.summary}</span>}
          {state.result.failed && state.result.error && <span>{state.result.error}</span>}
          <span>{state.result.published ? 'The full report is in Review → Workout report.' : 'Publishing is off (COACH_PUBLISH=false), so it was not saved here.'}</span>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="banner warn small" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <b>It didn't run</b>
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}

function CoachAddress() {
  const [value, setValue] = useState(coachUrl());
  return (
    <label className="field small">
      The coach's address (from its Vercel project)
      <input
        value={value}
        inputMode="url"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const v = value.trim().replace(/\/+$/, '');
          try {
            if (!v || v === DEFAULT_COACH_URL) localStorage.removeItem(COACH_URL_KEY);
            else localStorage.setItem(COACH_URL_KEY, v);
          } catch {
            // storage blocked: the default stays
          }
          setValue(v || DEFAULT_COACH_URL);
        }}
      />
    </label>
  );
}

export function CoachSetup() {
  const { data, commit, db } = useStore();
  const p = data.profile;
  const [key, setKey] = useState<string | null>(null);
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [replacing, setReplacing] = useState(false);
  // Only Vercel's scheduler needs this one: made here so there's nothing to invent.
  const [cron] = useState(newKey);
  const signedIn = db.mode === 'supabase';
  const door = `${window.location.origin}/api/workout-agent`;
  const hasKey = !!p.coach_key_hash;
  const reports = [...(data.workoutReports ?? [])].sort((a, b) => (a.as_of < b.as_of ? 1 : -1));

  async function makeKey() {
    const k = newKey();
    commit(opsProfile({ coach_key_hash: await sha256Hex(k) }));
    setKey(k);
    setReplacing(false);
  }

  async function runTest() {
    setTest({ state: 'running' });
    try {
      const { data: s } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
      const token = s.session?.access_token;
      if (!token) return setTest({ state: 'fail', detail: "You're not signed in.", fix: 'Sign in, then test again.' });
      const res = await fetch(`${door}/history?format=md`, { headers: { authorization: `Bearer ${token}` } });
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && /markdown/.test(type)) {
        const md = await res.text();
        const workouts = (md.match(/^- \*\*/gm) ?? []).length;
        return setTest({ state: 'ok', detail: `Connected. The coach can read your history (${workouts} workout${workouts === 1 ? '' : 's'} in the last 8 weeks).` });
      }
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { missing?: string[] };
        return setTest({ state: 'fail', detail: `The app's server is missing ${body.missing?.join(' and ') ?? 'a setting'}.`, fix: 'Do step 1, then Redeploy in Vercel and test again.' });
      }
      if (res.status === 404 || /html/.test(type)) return setTest({ state: 'fail', detail: "The coach's door isn't live on this site yet.", fix: 'Wait for Vercel to finish deploying the latest version (a minute or two), then test again. It only runs on the Vercel site, not on a preview on your computer.' });
      if (res.status === 401) return setTest({ state: 'fail', detail: 'Your sign-in was refused.', fix: 'Sign out and in again, then test again.' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return setTest({ state: 'fail', detail: body.error ?? `The server answered ${res.status}.`, fix: /coach_key_hash|column/.test(body.error ?? '') ? 'Run supabase/migrations/20261125000000_coach_key.sql in Supabase → SQL Editor.' : undefined });
    } catch (e) {
      setTest({ state: 'fail', detail: (e as Error).message });
    }
  }

  if (!signedIn) {
    return <span className="small muted">Sign in to set up the workout coach: it reads your history from the database.</span>;
  }

  return (
    <div className="coach-setup">
      <div className="coach-step">
        <b>1. Give the app's server its database key</b>
        <span className="small muted">Once. The key stays on the server; the coach never sees it.</span>
        <ol className="small coach-list">
          <li>
            In <a href={SUPABASE_KEYS} target="_blank" rel="noreferrer">Supabase → Project Settings → API Keys</a>, copy the <b>service_role</b> secret (Reveal, then Copy).
          </li>
          <li>
            In <a href={VERCEL_ENV} target="_blank" rel="noreferrer">Vercel</a>, open this app's project → Settings → Environment Variables. Add <code>SUPABASE_SERVICE_ROLE_KEY</code> with that value, for Production. Save.
          </li>
          <li>In Vercel → Deployments, open the top one → ⋯ → Redeploy.</li>
        </ol>
        <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn small" onClick={() => void runTest()} disabled={test.state === 'running'}>
            {test.state === 'running' ? 'Testing…' : 'Test the connection'}
          </button>
          {test.state === 'ok' && (
            <span className="small coach-ok">
              <Icon name="check" size={15} stroke={2.6} /> {test.detail}
            </span>
          )}
        </div>
        {test.state === 'fail' && (
          <div className="banner warn small" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <b>{test.detail}</b>
            {test.fix && <span>{test.fix}</span>}
          </div>
        )}
      </div>

      <div className="coach-step">
        <b>2. Make the coach's key</b>
        <span className="small muted">Like a password the coach uses to read your workout history (and nothing else). The app keeps only a fingerprint of it, so it's shown once: you'll paste it into Vercel in step 3, so keep this open.</span>
        {key ? (
          <CopyRow label="WORKOUT_AGENT_KEY" value={key} secret />
        ) : hasKey && !replacing ? (
          <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="small coach-ok">
              <Icon name="check" size={15} stroke={2.6} /> A key is set.
            </span>
            <button type="button" className="link-btn small" onClick={() => setReplacing(true)}>
              Make a new one
            </button>
          </div>
        ) : (
          <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn small primary" onClick={() => void makeKey()}>
              {hasKey ? 'Replace the key' : "Make the coach's key"}
            </button>
            {replacing && <span className="xsmall muted">The old key stops working: update WORKOUT_AGENT_KEY in the coach's Vercel project, then Redeploy it.</span>}
          </div>
        )}
      </div>

      <div className="coach-step">
        <b>3. Put the coach on Vercel</b>
        <span className="small muted">The coach is its own small Vercel project. Once, about two minutes.</span>
        <ol className="small coach-list">
          <li>
            In <a href="https://vercel.com/new" target="_blank" rel="noreferrer">Vercel → Add New → Project</a>, find <b>workout-coach</b> and click Import.
          </li>
          <li>Leave everything as it is, but open <b>Environment Variables</b> and add these five (name on the left, value on the right):</li>
        </ol>
        <CopyRow label="WORKOUT_AGENT_URL" value={door} />
        {key ? (
          <CopyRow label="WORKOUT_AGENT_KEY" value={key} secret />
        ) : (
          <div className="coach-copy">
            <span className="mono">WORKOUT_AGENT_KEY</span>
            <span className="small muted">{hasKey ? 'the key you copied in step 2 (lost it? Make a new one there)' : 'make it in step 2 first'}</span>
          </div>
        )}
        <CopyRow label="CRON_SECRET" value={cron} secret />
        <div className="coach-copy">
          <span className="mono">ANTHROPIC_API_KEY</span>
          <span className="small muted">
            from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com → API Keys</a> (Create Key)
          </span>
        </div>
        <div className="coach-copy">
          <span className="mono">LANGSMITH_API_KEY</span>
          <span className="small muted">
            optional, from <a href="https://smith.langchain.com/settings" target="_blank" rel="noreferrer">LangSmith → Settings → API Keys</a>: every run traced step by step
          </span>
        </div>
        <ol className="small coach-list" start={3}>
          <li>Click <b>Deploy</b>.</li>
        </ol>
      </div>

      <div className="coach-step">
        <b>4. Run it</b>
        <span className="small">It runs itself every Friday at 11 pm. To test it now:</span>
        <CoachAddress />
        <RunCoachButton />
        <span className="small muted">
          {reports.length ? `Last report: ${reports[0]!.as_of} (${reports[0]!.recommendation}).` : 'No coach reports here yet.'}{' '}
          <a href="#/workouts/report">Open the workout report</a>
        </span>
      </div>
    </div>
  );
}
