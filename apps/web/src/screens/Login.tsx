import { useState, type FormEvent } from 'react';
import { getSupabase } from '../data/supabase.ts';

/**
 * Sign in. Two ways: a password (set once in the Supabase dashboard; no email involved), or an
 * emailed magic link (needs Supabase's mailer, which is rate-limited and often filtered until you
 * add an SMTP provider). For one person running their own app, the password is the dependable one.
 */
export function Login({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || !email.trim()) return;
    setState('sending');
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
            <p className="muted small">We sent a sign-in link to {email}. Open it on this device to continue. Supabase’s built-in mailer is slow and sometimes lands in spam; if nothing comes, sign in with a password instead.</p>
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
            {mode === 'password' && (
              <label className="field">
                Password
                <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            )}
            <button className="btn primary" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? 'Signing in…' : mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
            </button>
            {state === 'error' && (
              <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
                {message}
              </p>
            )}
            <button type="button" className="link-btn small" onClick={() => (setMode(mode === 'password' ? 'link' : 'password'), setState('idle'))}>
              {mode === 'password' ? 'Email me a sign-in link instead' : 'Use a password instead'}
            </button>
            {mode === 'password' && <span className="xsmall muted">No password yet? Supabase → Authentication → Users → Add user → your email, a password, “Auto confirm user” on.</span>}
          </form>
        )}
        <button className="btn ghost" onClick={onDemo}>
          Try the demo instead
        </button>
      </div>
    </div>
  );
}
