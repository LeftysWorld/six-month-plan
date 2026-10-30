import { useState } from 'react';
import { useStore } from '../data/store.tsx';
import { opsProfile } from '../data/ops.ts';
import { getSupabase } from '../data/supabase.ts';
import { Icon, useToast } from './ui.tsx';

/**
 * Setting up the workout coach from the app, no command line: the app serves the coach's door
 * itself (/api/workout-agent on Vercel), makes the coach's key here, tests the connection, and
 * shows exactly what to paste into GitHub, where the weekly run lives.
 */

const REPO = 'https://github.com/LeftysWorld/workout-coach';
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

export function CoachSetup() {
  const { data, commit, db } = useStore();
  const p = data.profile;
  const [key, setKey] = useState<string | null>(null);
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [replacing, setReplacing] = useState(false);
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
        <span className="small muted">It opens your workout history to the coach, and nothing else. Only a fingerprint of it is stored, so it's shown once: copy it into GitHub straight away (step 3).</span>
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
            {replacing && <span className="xsmall muted">The old key stops working; paste the new one into GitHub.</span>}
          </div>
        )}
      </div>

      <div className="coach-step">
        <b>3. Paste into GitHub, where the weekly run lives</b>
        <span className="small">
          In <a href={`${REPO}/settings/secrets/actions`} target="_blank" rel="noreferrer">workout-coach → Settings → Secrets and variables → Actions</a>, add each as a <b>New repository secret</b>:
        </span>
        <CopyRow label="WORKOUT_AGENT_URL" value={door} />
        <div className="coach-copy">
          <span className="mono">WORKOUT_AGENT_KEY</span>
          <span className="small muted">{key ? 'the key from step 2' : hasKey ? 'the key you copied in step 2 (make a new one if you lost it)' : 'make it in step 2'}</span>
        </div>
        <div className="coach-copy">
          <span className="mono">ANTHROPIC_API_KEY</span>
          <span className="small muted">
            from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com → API Keys</a>
          </span>
        </div>
        <div className="coach-copy">
          <span className="mono">LANGSMITH_API_KEY</span>
          <span className="small muted">
            optional, from <a href="https://smith.langchain.com/settings" target="_blank" rel="noreferrer">LangSmith → Settings → API Keys</a>: every run traced step by step
          </span>
        </div>
        <span className="small">
          Then on the <b>Variables</b> tab, add <code>COACH_PUBLISH</code> = <code>false</code> for the first 2–3 weeks (reports show in GitHub only), then change it to <code>true</code> to get them here.
        </span>
      </div>

      <div className="coach-step">
        <b>4. Run it</b>
        <span className="small">
          It runs on its own every Friday at 11 pm. To run it now:{' '}
          <a href={`${REPO}/actions/workflows/weekly.yml`} target="_blank" rel="noreferrer">
            Actions → Weekly review → Run workflow
          </a>
          . The report shows in the run's summary, and here once publishing is on.
        </span>
        <span className="small muted">
          {reports.length ? `Last report: ${reports[0]!.as_of} (${reports[0]!.recommendation}).` : 'No coach reports here yet.'}{' '}
          <a href="#/workouts/report">Open the workout report</a>
        </span>
      </div>
    </div>
  );
}
