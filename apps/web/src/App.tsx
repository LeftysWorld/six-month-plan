import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import type { Db } from './data/db.ts';
import { createLocalDb } from './data/local.ts';
import type { AppData } from './data/model.ts';
import { StoreProvider, useStore } from './data/store.tsx';
import { createSupabaseDb, getSupabase, schemaWarning, supabaseConfigured } from './data/supabase.ts';
import { useView } from './data/derive.ts';
import { opsProfile } from './data/ops.ts';
import { href, useRoute } from './router.ts';
import { Icon, ToastProvider } from './components/ui.tsx';
import { Login } from './screens/Login.tsx';
import { Home } from './screens/Home.tsx';
import { Today } from './screens/Today.tsx';
import { Plans } from './screens/Plans.tsx';
import { PlanDetail } from './screens/PlanDetail.tsx';
import { GoalNew } from './screens/GoalNew.tsx';
import { GoalDetail } from './screens/GoalDetail.tsx';
import { ActionEdit } from './screens/ActionEdit.tsx';
import { ReviewHub } from './screens/ReviewHub.tsx';
import { WeeklyReview } from './screens/WeeklyReview.tsx';
import { Progress } from './screens/Progress.tsx';
import { Settings } from './screens/Settings.tsx';
import { WorkoutLog } from './screens/WorkoutLog.tsx';
import { StudyLog } from './screens/StudyLog.tsx';
import { WelcomeBack } from './screens/WelcomeBack.tsx';
import { Flow } from './screens/Flow.tsx';

const MODE_KEY = 'six.mode';

export function useDemoChoice(): [boolean, (on: boolean) => void] {
  const [demo, setDemo] = useState(() => !supabaseConfigured || localStorage.getItem(MODE_KEY) === 'demo');
  const set = useCallback((on: boolean) => {
    if (on) localStorage.setItem(MODE_KEY, 'demo');
    else localStorage.removeItem(MODE_KEY);
    setDemo(on || !supabaseConfigured);
  }, []);
  return [demo, set];
}

export function App() {
  const [demo, setDemo] = useDemoChoice();
  const [authSession, setAuthSession] = useState<AuthSession | null | undefined>(demo ? null : undefined);
  const [db, setDb] = useState<Db | null>(null);
  const [initial, setInitial] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Watch the Supabase sign-in state.
  useEffect(() => {
    if (demo) return;
    const sb = getSupabase();
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => setAuthSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, session) => setAuthSession(session));
    return () => data.subscription.unsubscribe();
  }, [demo]);

  // Pick the backend and load everything. Keyed on the user ID, not the session object,
  // so the hourly token refresh doesn't reload the app.
  const userId = authSession?.user.id ?? null;
  useEffect(() => {
    let cancelled = false;
    setInitial(null);
    setError(null);
    let next: Db | null = null;
    if (demo) next = createLocalDb();
    else if (userId) next = createSupabaseDb(getSupabase()!, userId);
    setDb(next);
    if (!next) return;
    next
      .loadAll()
      .then((data) => !cancelled && setInitial(data))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [demo, userId]);

  if (!demo && authSession === undefined) return <Splash text="Loading…" />;
  if (!demo && !authSession) return <Login onDemo={() => setDemo(true)} />;
  if (error) {
    return (
      <div className="center-screen">
        <div className="card stack" style={{ maxWidth: 420 }}>
          <h2>Couldn't load your data</h2>
          <p className="muted small">{error}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!db || !initial) return <Splash text="Loading your plan…" />;

  return (
    <StoreProvider db={db} initial={initial}>
      <ToastProvider>
        <Shell
          demo={demo}
          onExitDemo={supabaseConfigured ? () => setDemo(false) : undefined}
          onSignOut={demo ? undefined : () => void getSupabase()?.auth.signOut()}
        />
      </ToastProvider>
    </StoreProvider>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <div className="center-screen">
      <p className="muted">{text}</p>
    </div>
  );
}

export interface ShellProps {
  demo: boolean;
  onExitDemo?: () => void;
  onSignOut?: () => void;
}

function Shell(props: ShellProps) {
  const route = useRoute();
  const { sync, clearError, today, data, commit } = useStore();
  const view = useView();
  const [s0 = '', s1] = route.segments;

  const away = view.daysAway();
  const showWelcome =
    away != null && away >= 2 && data.profile.welcome_dismissed_on !== today && (s0 === '' || s0 === 'today');
  const dismissWelcome = () => commit(opsProfile({ welcome_dismissed_on: today }));

  let screen: ReactElement;
  switch (s0) {
    case '':
      screen = <Home />;
      break;
    case 'today':
      screen = <Today />;
      break;
    case 'plans':
      screen = s1 ? <PlanDetail id={s1} /> : <Plans />;
      break;
    case 'goals':
      screen = s1 === 'new' || !s1 ? <GoalNew planId={route.query.get('plan')} /> : <GoalDetail id={s1} />;
      break;
    case 'actions':
      screen = <ActionEdit id={s1 === 'new' ? null : s1 ?? null} goalId={route.query.get('goal')} />;
      break;
    case 'review':
      screen = s1 === 'run' ? <WeeklyReview kind={route.query.get('kind') ?? 'weekly'} /> : <ReviewHub />;
      break;
    case 'flow':
      screen = <Flow goalId={s1 ?? ''} />;
      break;
    case 'progress':
      screen = <Progress />;
      break;
    case 'settings':
      screen = <Settings {...props} />;
      break;
    case 'workout':
      screen = <WorkoutLog id={s1 ?? ''} />;
      break;
    case 'study':
      screen = <StudyLog id={s1 ?? ''} />;
      break;
    default:
      screen = <Home />;
  }

  const tab = s0 === '' || s0 === 'progress' || s0 === 'settings' ? 'home' : s0 === 'today' || s0 === 'workout' || s0 === 'study' ? 'today' : s0 === 'review' ? 'review' : 'plans';

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <span className="brand">Six Months</span>
        <NavLink to="/" icon="home" label="Home" current={tab === 'home'} />
        <NavLink to="/today" icon="today" label="Today" current={tab === 'today'} />
        <NavLink to="/plans" icon="plans" label="Plans" current={tab === 'plans'} />
        <NavLink to="/review" icon="review" label="Review" current={tab === 'review'} />
      </nav>
      <main className="main">
        <div className="stack">
          {props.demo && (
            <div className="banner info">
              <span>Demo mode: data stays in this browser.</span>
              <a href={href('/settings')}>Settings</a>
            </div>
          )}
          {schemaWarning && !props.demo && (
            <div className="banner warn" role="alert">
              <span>{schemaWarning}</span>
            </div>
          )}
          {sync.offline && (
            <div className="banner warn" role="status">
              <span>Offline: {sync.pending} change{sync.pending === 1 ? '' : 's'} waiting to save.</span>
            </div>
          )}
          {sync.error && (
            <div className="banner warn" role="alert">
              <span>{sync.error}</span>
              <button className="link-btn" onClick={clearError}>
                Dismiss
              </button>
            </div>
          )}
          {showWelcome ? <WelcomeBack days={away!} onDone={dismissWelcome} /> : screen}
        </div>
      </main>
    </div>
  );
}

function NavLink({ to, icon, label, current }: { to: string; icon: string; label: string; current: boolean }) {
  return (
    <a href={href(to)} aria-current={current ? 'page' : undefined}>
      <Icon name={icon} size={22} />
      {label}
    </a>
  );
}
