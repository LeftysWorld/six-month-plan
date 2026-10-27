import { useState, type FormEvent } from 'react';
import { getSupabase } from '../data/supabase.ts';

/**
 * Sign in. Two ways: a password (set once in the Supabase dashboard; no email involved), or an
 * emailed magic link (needs Supabase's mailer, which is rate-limited and often filtered until you
 * add an SMTP provider). For one person running their own app, the password is the dependable one.
 */
export function Login({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<'password' | 'create' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || !email.trim()) return;
    setState('sending');
    if (mode === 'create') {
      if (password.length < 8) {
        setState('error');
        setMessage('Use at least 8 characters.');
        return;
      }
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
      if (error) {
        setState('error');
        setMessage(/rate limit/i.test(error.message) ? 'Supabase tried to send a confirmation email and hit its limit. Turn off Authentication → Providers → Email → “Confirm email” in the dashboard, then try again — no email is needed.' : error.message);
      } else if (!data.session) {
        // Confirm-email is still on in the project: the account exists but needs the link.
        setState('sent');
        setMessage('confirm');
      }
      return;
    }
    if (mode === 'password') {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setState('error');
        setMessage(/invalid/i.test(error.message) ? 'That email and password don’t match. Set or reset the password in Supabase → Authentication → Users.' : error.message);
      }
      // On success the app re-renders signed in; nothing else to do here.
      return;
    }
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    });
    if (error) {
      setState('error');
      setMessage(error.message);
    } else {
      setState('sent');
    }
  }

  return (
    <div className="center-screen">
      <div className="stack" style={{ width: '100%', maxWidth: 400 }}>
        <div>
          <img src="/icon.svg" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
          <h1 style={{ marginTop: 16 }}>Six Months</h1>
          <p className="muted">Your six-month plan, one day at a time.</p>
        </div>
        {state === 'sent' ? (
          <div className="card stack-sm">
            <h2>Check your email</h2>
            <p className="muted small">
              {message === 'confirm'
                ? `Your account is made, but this project still asks new accounts to confirm by email, and we sent one to ${email}. To skip that step, turn off “Confirm email” under Authentication → Providers → Email in Supabase, then sign in with your password.`
                : `We sent a sign-in link to ${email}. Open it on this device to continue. Supabase’s built-in mailer is slow and sometimes lands in spam; if nothing comes, sign in with a password instead.`}
            </p>
            <button className="link-btn" onClick={() => (setState('idle'), setMode('password'))}>
              Use a password instead
            </button>
          </div>
        ) : (
          <form className="card stack" onSubmit={submit}>
            <label className="field">
              Email
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {mode !== 'link' && (
              <label className="field">
                {mode === 'create' ? 'Choose a password' : 'Password'}
                <span className="pw-row">
                  <input type={show ? 'text' : 'password'} required minLength={mode === 'create' ? 8 : undefined} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                    {show ? 'Hide' : 'Show'}
                  </button>
                </span>
              </label>
            )}
            <button className="btn primary" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? (mode === 'create' ? 'Creating…' : 'Signing in…') : mode === 'password' ? 'Sign in' : mode === 'create' ? 'Create my account' : 'Email me a sign-in link'}
            </button>
            {state === 'error' && (
              <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
                {message}
              </p>
            )}
            <div className="row-start" style={{ gap: 12, flexWrap: 'wrap' }}>
              {mode !== 'create' && (
                <button type="button" className="link-btn small" onClick={() => (setMode('create'), setState('idle'))}>
                  New here? Create an account
                </button>
              )}
              {mode !== 'password' && (
                <button type="button" className="link-btn small" onClick={() => (setMode('password'), setState('idle'))}>
                  I have a password
                </button>
              )}
              {mode !== 'link' && (
                <button type="button" className="link-btn small" onClick={() => (setMode('link'), setState('idle'))}>
                  Email me a link instead
                </button>
              )}
            </div>
            {mode === 'create' && <span className="xsmall muted">Made right here, no email needed — as long as “Confirm email” is off in Supabase (Authentication → Providers → Email). Turn sign-ups off there once your account exists.</span>}
          </form>
        )}
        <button className="btn ghost" onClick={onDemo}>
          Try the demo instead
        </button>
      </div>
    </div>
  );
}
