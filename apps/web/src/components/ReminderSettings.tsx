import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { opsProfile } from '../data/ops.ts';
import { supabaseConfigured } from '../data/supabase.ts';
import { disablePush, enablePush, pushEnabled, pushSupport } from '../push.ts';

const DEFAULT_TIME = '08:00';

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Older browsers: select-and-copy fallback.
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(el);
    return ok;
  }
}

/** Settings section: push reminders on this device, reminder times, and the calendar feed. */
export function ReminderSettings() {
  const { data, db, commit } = useStore();
  const profile = data.profile;
  const reminderTime = (profile.reminder_time || DEFAULT_TIME).slice(0, 5);
  const evening = profile.evening_reminder ?? true;
  const signedIn = db.mode === 'supabase' && supabaseConfigured;
  const support = useMemo(() => pushSupport(), []);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!signedIn || !support.supported) {
      setEnabled(false);
      return;
    }
    pushEnabled().then((on) => {
      if (alive) setEnabled(on);
    });
    return () => {
      alive = false;
    };
  }, [signedIn, support.supported]);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
      } else {
        await enablePush();
        setEnabled(true);
      }
    } catch (e) {
      setError((e as Error).message);
      setEnabled(await pushEnabled());
    } finally {
      setBusy(false);
    }
  }

  const base = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/+$/, '');
  const feedUrl = signedIn && base && profile.calendar_token
    ? `${base}/functions/v1/calendar?token=${profile.calendar_token}`
    : null;
  const webcalUrl = feedUrl ? feedUrl.replace(/^https?:\/\//, 'webcal://') : null;

  async function copyFeed() {
    if (!feedUrl) return;
    const ok = await copyText(feedUrl);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  }

  let status: string;
  if (!signedIn) status = 'Off';
  else if (!support.supported) status = support.needsInstall ? 'Needs Home Screen' : 'Not available';
  else if (enabled === null) status = 'Checking…';
  else status = enabled ? 'On for this device' : 'Off';

  return (
    <>
      <div className="section-label">Reminders</div>
      <div className="card stack-sm">
        <div className="row-between">
          <div>
            <div className="label">Push reminders</div>
            <div className="small">{status}</div>
          </div>
          {signedIn && support.supported && (
            <button
              type="button"
              className={enabled ? 'btn small ghost' : 'btn small primary'}
              onClick={toggle}
              disabled={busy || enabled === null}
            >
              {busy ? 'Working…' : enabled ? 'Turn off' : 'Enable'}
            </button>
          )}
        </div>

        {!signedIn ? (
          <div className="banner info small">
            Reminders need sign-in: connect the app to Supabase and sign in with your email to get them on your phone.
          </div>
        ) : support.needsInstall ? (
          <div className="banner info small">
            On iPhone, add this site to your Home Screen (Share → Add to Home Screen), then open it from there to turn on
            reminders.
          </div>
        ) : !support.supported ? (
          <div className="xsmall muted">{support.reason}</div>
        ) : null}

        {error && <div className="banner warn small" role="alert">{error}</div>}

        <label className="field">
          <span className="label">Morning reminder</span>
          <input
            type="time"
            value={reminderTime}
            onChange={(e) => {
              const value = (e.target as HTMLInputElement).value;
              if (/^\d{2}:\d{2}/.test(value)) commit(opsProfile({ reminder_time: value.slice(0, 5) }));
            }}
          />
        </label>
        <div className="xsmall muted">Today’s count and your first task. Times use your time zone ({profile.timezone}).</div>

        <label className="row-start">
          <input
            type="checkbox"
            checked={evening}
            onChange={(e) => commit(opsProfile({ evening_reminder: (e.target as HTMLInputElement).checked }))}
          />
          <span className="small">Streak saver at 9 pm if nothing is checked off yet</span>
        </label>

        {feedUrl && webcalUrl && (
          <div className="stack-sm">
            <div className="label">Calendar feed</div>
            <div className="xsmall muted">
              A daily check-in event with an alert, listing that day’s tasks for the next 2 weeks. Works with Apple, Google
              and Outlook calendars. Anyone with this link can see your task titles.
            </div>
            <div className="mono xsmall" style={{ wordBreak: 'break-all' }}>{feedUrl}</div>
            <div className="row-start">
              <button type="button" className="btn small" onClick={copyFeed}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <a className="btn small ghost" href={webcalUrl}>
                Add to calendar
              </a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
