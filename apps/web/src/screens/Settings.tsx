import { useState } from 'react';
import { useStore } from '../data/store.tsx';
import { opsProfile } from '../data/ops.ts';
import { resetDemo } from '../data/local.ts';
import { BackLink, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import type { ShellProps } from '../App.tsx';

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

export function Settings({ demo, onExitDemo, onSignOut }: ShellProps) {
  const { data, db, commit, today } = useStore();
  const toast = useToast();
  const p = data.profile;
  const [name, setName] = useState(p.display_name);
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [p.timezone];

  return (
    <div className="stack">
      <BackLink label="Home" fallback="/" />
      <h1>Settings</h1>

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
      </div>

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
            {onExitDemo && (
              <button className="btn primary" onClick={onExitDemo}>
                Sign in to save for real
              </button>
            )}
          </div>
        </>
      )}

      {onSignOut && (
        <button
          className="btn"
          onClick={() => {
            toast('Signing out…');
            onSignOut();
          }}
        >
          Sign out
        </button>
      )}
      <p className="xsmall muted" style={{ textAlign: 'center' }}>
        Six Months · v0.1 · build {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}
      </p>
    </div>
  );
}
