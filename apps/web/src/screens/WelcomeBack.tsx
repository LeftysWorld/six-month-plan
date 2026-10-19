import { addDays, weekStart } from '@six/core';
import { useStore } from '../data/store.tsx';
import { minutesText, useView } from '../data/derive.ts';
import type { Op } from '../data/model.ts';
import { navigate } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';

/** Shown after two or more days away, instead of a wall of missed tasks. */
export function WelcomeBack({ days, onDone }: { days: number; onDone: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const name = data.profile.display_name;
  const todays = view.sessionsOn(today).filter((s) => s.status === 'planned');
  const todayMinutes = todays.reduce((sum, s) => sum + s.planned_minutes, 0);

  // Remaining planned sessions this week, shrunk to their minimum version.
  const sunday = addDays(weekStart(today), 6);
  const remaining = data.sessions.filter((s) => s.status === 'planned' && s.date && s.date >= today && s.date <= sunday);
  const lighter = remaining.map((s) => {
    const a = view.action(s.action_id);
    return { s, minutes: a?.min_minutes ?? Math.min(s.planned_minutes, 15), count: a?.min_count ?? s.planned_count };
  });
  const lighterPerDay = Math.round(lighter.reduce((sum, l) => sum + l.minutes, 0) / Math.max(1, new Set(remaining.map((s) => s.date)).size));

  function makeLighter() {
    const ops: Op[] = lighter.map(({ s, minutes, count }) => ({
      kind: 'update',
      collection: 'sessions',
      id: s.id,
      patch: { planned_minutes: minutes, planned_count: count },
    }));
    commit(ops);
    toast('This week is lighter: minimum versions until Sunday');
    onDone();
    navigate('/today');
  }

  return (
    <div className="stack" style={{ paddingTop: 24 }}>
      <svg width="120" height="84" viewBox="0 0 120 84" aria-hidden="true">
        <path d="M4 70 Q30 52 60 62 T116 50" fill="none" style={{ stroke: 'var(--border-strong)' }} strokeWidth="3" strokeLinecap="round" />
        <circle cx="84" cy="26" r="16" style={{ fill: 'var(--gold-soft)' }} />
        <circle cx="84" cy="26" r="9" style={{ fill: 'var(--gold)' }} />
        <path d="M4 78 Q40 64 70 72 T116 64" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Welcome back{name ? `, ${name}` : ''}.</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--ink-2)' }}>
          It's been {days} days. Your goals and history are all still here. Where do you want to pick up?
        </p>
      </div>
      <Option
        icon="chevron"
        tint="var(--accent-soft)"
        ink="var(--accent-ink)"
        title="Continue with today"
        detail={`Your normal list · ${todays.length} item${todays.length === 1 ? '' : 's'} · ${minutesText(todayMinutes)}`}
        onClick={() => {
          onDone();
          navigate('/today');
        }}
        primary
      />
      {remaining.length > 0 && (
        <Option
          icon="minus"
          tint="var(--amber-soft)"
          ink="var(--amber)"
          title="Make this week lighter"
          detail={`Minimum versions until Sunday · about ${minutesText(lighterPerDay)} a day`}
          onClick={makeLighter}
        />
      )}
      <Option
        icon="plans"
        tint="var(--violet-soft)"
        ink="var(--violet-ink)"
        title="Review my plan"
        detail="Look at goals and adjust before starting again"
        onClick={() => {
          onDone();
          navigate('/plans');
        }}
      />
      <p className="small muted" style={{ margin: 0 }}>
        The days you were away show as <b style={{ color: 'var(--ink-2)' }}>not logged</b>, not failed.
      </p>
    </div>
  );
}

function Option(props: { icon: string; tint: string; ink: string; title: string; detail: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      className="card"
      onClick={props.onClick}
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        textAlign: 'left',
        cursor: 'pointer',
        borderColor: props.primary ? 'var(--accent)' : undefined,
        boxShadow: props.primary ? '0 0 0 1px var(--accent)' : undefined,
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 12, background: props.tint, color: props.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        <Icon name={props.icon} />
      </span>
      <span>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 16 }}>{props.title}</span>
        <span className="small muted">{props.detail}</span>
      </span>
    </button>
  );
}
