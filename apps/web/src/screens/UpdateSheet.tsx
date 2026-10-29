import { useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { APP_UPDATES, applyUpdate, type AppUpdate } from '../data/updates.ts';
import { Sheet, useToast } from '../components/ui.tsx';

/** Review one app update: what it changes, its choices, then apply (with Undo). */
export function AppUpdateSheet({ update, onClose }: { update: AppUpdate; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const p = useMemo(() => update.preview(data, today), [update, data, today]);
  const [options, setOptions] = useState<Record<string, boolean>>(() => Object.fromEntries(p.options.map((o) => [o.id, o.on])));
  const blocked = p.blocked ?? (p.done ? 'Already done.' : null);
  return (
    <Sheet title={update.title} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        Here's what changes. Nothing you've logged is lost, and Undo puts it back.
      </span>
      {p.lines.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {p.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {p.options.map((o) => (
        <label key={o.id} className="check-row small">
          <input type="checkbox" checked={!!options[o.id]} onChange={(e) => setOptions({ ...options, [o.id]: e.target.checked })} />
          <span>{o.label}</span>
        </label>
      ))}
      {blocked && <div className="banner info">{blocked}</div>}
      <div className="row-between">
        <button type="button" className="link-btn" onClick={onClose}>
          Not now
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!!blocked}
          onClick={() => {
            const { ops, undo } = applyUpdate(update, data, today, options);
            commit(ops);
            toast(`${update.title}: done`, () => commit(undo));
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </Sheet>
  );
}

const dismissKey = (u: AppUpdate) => `six.update.dismissed.${u.id}`;

/** On Today: one line per update that's waiting, with Review. "Not now" hides it on this device. */
export function AppUpdatesNudge() {
  const { data, today } = useStore();
  const [open, setOpen] = useState<AppUpdate | null>(null);
  const [, bump] = useState(0);
  const waiting = APP_UPDATES.filter((u) => {
    try {
      if (localStorage.getItem(dismissKey(u)) === '1') return false;
    } catch {
      // storage blocked: show it
    }
    const p = u.preview(data, today);
    return !p.done && !p.blocked;
  });
  return (
    <>
      {waiting.map((u) => (
        <div key={u.id} className="banner info row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="small">{u.nudge}</span>
          <span className="row-start" style={{ gap: 8 }}>
            <button
              type="button"
              className="link-btn small"
              onClick={() => {
                try {
                  localStorage.setItem(dismissKey(u), '1');
                } catch {
                  // storage blocked
                }
                bump((n) => n + 1);
              }}
            >
              Not now
            </button>
            <button type="button" className="btn small primary" onClick={() => setOpen(u)}>
              Review
            </button>
          </span>
        </div>
      ))}
      {open && <AppUpdateSheet update={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Settings → Plans: every update, waiting or done. */
export function AppUpdatesList() {
  const { data, today } = useStore();
  const [open, setOpen] = useState<AppUpdate | null>(null);
  return (
    <>
      {APP_UPDATES.map((u) => {
        const p = u.preview(data, today);
        return (
          <div key={u.id} className="row-between small" style={{ gap: 10 }}>
            <span>
              <b>{u.title}</b>
              <span className="muted"> · {p.blocked ? 'not for your goals' : p.done ? 'applied' : 'waiting'}</span>
            </span>
            {!p.done && !p.blocked && (
              <button type="button" className="btn small" onClick={() => setOpen(u)}>
                Review
              </button>
            )}
          </div>
        );
      })}
      {open && <AppUpdateSheet update={open} onClose={() => setOpen(null)} />}
    </>
  );
}
