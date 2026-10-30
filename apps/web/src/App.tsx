import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import type { Db } from './data/db.ts';
import { createLocalDb } from './data/local.ts';
import type { AppData } from './data/model.ts';
import { StoreProvider, useStore } from './data/store.tsx';
import { createSupabaseDb, getSupabase, schemaWarning, supabaseConfigured } from './data/supabase.ts';
import { useView } from './data/useView.ts';
import { opsProfile } from './data/ops.ts';
import { href, navigate, useRoute } from './router.ts';
import { Icon, ToastProvider } from './components/ui.tsx';
import { useNavRail } from './components/navRail.ts';
import { Login } from './screens/Login.tsx';
import { Today } from './screens/Today.tsx';
import { QuickAdd } from './screens/today/QuickAdd.tsx';
import { useShownDay } from './data/shownDay.ts';
import { Plans } from './screens/Plans.tsx';
import { GoalNew } from './screens/GoalNew.tsx';
import { ReviewHub } from './screens/ReviewHub.tsx';
import { Review } from './screens/Review.tsx';
import { ReviewDetail, ReviewList } from './screens/ReviewPast.tsx';
import { ThenNow } from './screens/ThenNow.tsx';
import { PhotoTimeline } from './screens/PhotoTimeline.tsx';
import { Progress } from './screens/Progress.tsx';
import { Settings } from './screens/Settings.tsx';
import { setAppBadge } from './push.ts';
import { WelcomeBack } from './screens/WelcomeBack.tsx';
import { Flow } from './screens/Flow.tsx';
import { Backlog } from './screens/Backlog.tsx';
import { Completed } from './screens/Completed.tsx';
import { Roadmap } from './screens/Roadmap.tsx';
import { Calendar } from './screens/Calendar.tsx';
import { Habits } from './screens/Habits.tsx';
import { GroupPage } from './screens/GroupPage.tsx';
import { PathDetail, Paths } from './screens/Paths.tsx';

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
          email={demo ? null : authSession?.user.email ?? null}
          onExitDemo={supabaseConfigured ? () => setDemo(false) : undefined}
          onEnterDemo={demo || !supabaseConfigured ? undefined : () => setDemo(true)}
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
  /** Who is signed in (null in demo mode). */
  email?: string | null;
  /** Demo → the real account (sign-in screen, or straight in when a session exists). */
  onExitDemo?: () => void;
  /** Signed in → the demo in this browser, without signing out. */
  onEnterDemo?: () => void;
  onSignOut?: () => void;
}

function Shell(props: ShellProps) {
  const route = useRoute();
  const { sync, clearError, today, data, commit } = useStore();
  const view = useView();
  // The day Today is showing (when it isn't today): the dock's + adds to it.
  const shownDay = useShownDay();
  const [s0 = '', s1, s2] = route.segments;
  const [adding, setAdding] = useState(false);
  const nav = useNavRail();

  const away = view.daysAway();
  const showWelcome =
    away != null && away >= 2 && data.profile.welcome_dismissed_on !== today && (s0 === '' || s0 === 'today' || s0 === 'home');
  const dismissWelcome = () => commit(opsProfile({ welcome_dismissed_on: today }));

  // Today's open tasks: shown in the browser tab and on the home-screen icon.
  const openToday = view.sessionsOn(today).filter((x) => x.status === 'planned').length;
  useEffect(() => {
    document.title = openToday ? `(${openToday}) Six Months` : 'Six Months';
    setAppBadge(openToday);
  }, [openToday]);

  // Keyboard shortcuts on a computer: N add, T today, G goals (now), M roadmap, B later (backlog), P paths, C calendar, H habits, R review.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('.sheet')) return;
      const k = e.key.toLowerCase();
      if (k === 'n') {
        e.preventDefault();
        setAdding(true);
      } else if (k === 't') navigate('/today');
      else if (k === 'g') navigate('/goals');
      else if (k === 'b') navigate('/goals/backlog');
      else if (k === 'm') navigate('/goals/roadmap');
      else if (k === 'c') navigate('/calendar');
      else if (k === 'h') navigate('/habits');
      else if (k === 'p') navigate('/paths');
      else if (k === 'r') navigate('/review');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let screen: ReactElement;
  switch (s0) {
    case '':
    case 'today':
    case 'home':
      // /today/2026-11-14 opens that day (from the calendar).
      screen = s0 === 'today' && s1 && /^\d{4}-\d{2}-\d{2}$/.test(s1) ? <Today key={s1} date={s1} /> : <Today />;
      break;
    case 'plans':
    case 'goals':
      if (s0 === 'goals' && s1 === 'new') screen = <GoalNew ideaId={route.query.get('idea')} pathId={route.query.get('path')} />;
      else if (s0 === 'goals' && s1 === 'backlog') screen = <Backlog />;
      else if (s0 === 'goals' && s1 === 'completed') screen = <Completed />;
      else if (s0 === 'goals' && (s1 === 'roadmap' || s1 === 'timeline')) screen = <Roadmap />;
      else if (s0 === 'goals' && s1 === 'group' && s2) screen = <GroupPage id={s2} />;
      else if (s0 === 'goals' && s1 && s2 === 'photos') screen = <PhotoTimeline goalId={s1} />;
      else if (s0 === 'goals' && s1) screen = <Flow goalId={s1} />;
      else screen = <Plans />;
      break;
    case 'review':
      if (s1 === 'run') screen = <Review kind={route.query.get('kind') ?? 'weekly'} />;
      else if (s1 === 'past') screen = s2 ? <ReviewDetail id={s2} /> : <ReviewList />;
      else if (s1 === 'then-now') screen = <ThenNow planId={route.query.get('plan')} />;
      else screen = <ReviewHub />;
      break;
    case 'progress':
      screen = <Progress />;
      break;
    case 'roadmap':
      screen = <Roadmap />;
      break;
    case 'calendar':
      screen = <Calendar />;
      break;
    case 'habits':
      screen = <Habits />;
      break;
    case 'paths':
      screen = s1 ? <PathDetail id={s1} /> : <Paths />;
      break;
    case 'settings':
      screen = <Settings {...props} />;
      break;
    default:
      screen = <Today />;
  }

  const tab = s0 === 'calendar' ? 'calendar' : s0 === 'habits' ? 'habits' : s0 === 'review' || s0 === 'progress' ? 'review' : s0 === 'plans' || s0 === 'goals' || s0 === 'paths' || s0 === 'roadmap' ? 'goals' : s0 === 'settings' ? 'none' : 'today';

  return (
    <div className="shell">
      {nav.floating && <div className="dock-spacer" aria-hidden="true" />}
      {nav.floating && <button type="button" className="dock-scrim" aria-label="Close the menu" onClick={nav.close} />}
      <div className={`dock${nav.open ? '' : ' rail'}${nav.floating ? ' floating' : ''}`} onClick={(e) => nav.floating && (e.target as HTMLElement).closest('a') && nav.close()}>
        <nav className="nav" aria-label="Main">
          <span className="brand">Six Months</span>
          <NavLink to="/today" icon="today" label="Today" current={tab === 'today'} />
          <NavLink to="/goals" icon="plans" label="Goals" current={tab === 'goals'} />
          <NavLink to="/habits" icon="habit" label="Habits" current={tab === 'habits'} />
          <NavLink to="/calendar" icon="calendar" label="Calendar" current={tab === 'calendar'} />
          <NavLink to="/review" icon="review" label="Review" current={tab === 'review'} />
        </nav>
        <button type="button" className="dock-add" aria-label="Add a task, log something or save a goal idea" onClick={() => setAdding(true)}>
          <Icon name="plus" size={24} stroke={2.4} />
          <span className="dock-add-label">Add or log</span>
        </button>
        <button type="button" className="nav-toggle" onClick={nav.toggle} aria-expanded={nav.open} aria-label={nav.open ? 'Collapse the menu' : 'Expand the menu'} title={nav.open ? 'Collapse the menu' : 'Expand the menu'}>
          <span style={{ display: 'inline-flex', transform: nav.open ? 'rotate(180deg)' : 'none' }}>
            <Icon name="chevron" size={16} stroke={2.4} />
          </span>
          <span className="nav-toggle-label">Collapse</span>
        </button>
      </div>
      <main className={`main${tab === 'today' ? ' main-roomy' : ''}`}>
        <div className="stack">
          {props.demo && (
            <div className="banner info">
              <span>Demo mode: data stays in this browser.</span>
              {props.onExitDemo ? (
                <button type="button" className="link-btn small" onClick={props.onExitDemo}>
                  Switch to my account
                </button>
              ) : (
                <a href={href('/settings')}>Settings</a>
              )}
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
      {adding && <QuickAdd date={shownDay ?? today} onClose={() => setAdding(false)} />}
    </div>
  );
}

function NavLink({ to, icon, label, current }: { to: string; icon: string; label: string; current: boolean }) {
  return (
    <a href={href(to)} aria-current={current ? 'page' : undefined} aria-label={label} title={label}>
      <Icon name={icon} size={current ? 20 : 22} stroke={current ? 2 : 1.9} />
      <span className="nav-label">{label}</span>
    </a>
  );
}
