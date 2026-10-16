import { useState, type FormEvent } from 'react';
import { getSupabase } from '../data/supabase.ts';

/** Email magic-link sign-in. No password to remember. */
export function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || !email.trim()) return;
    setState('sending');
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
            <p className="muted small">We sent a sign-in link to {email}. Open it on this device to continue.</p>
            <button className="link-btn" onClick={() => setState('idle')}>
              Use a different email
            </button>
          </div>
        ) : (
          <form className="card stack" onSubmit={submit}>
            <label className="field">
              Email
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn primary" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {state === 'error' && (
              <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
                {message}
              </p>
            )}
          </form>
        )}
        <button className="btn ghost" onClick={onDemo}>
          Try the demo instead
        </button>
      </div>
    </div>
  );
}
