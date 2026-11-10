import { useEffect, useState } from 'react';
import { WAKE_CHOICES, dailyRoutine, isPushupPracticeOnly, routineNow, routineRows, timeOfDay } from '@six/core';
import { useStore } from '../../data/store.tsx';
import { useView } from '../../data/useView.ts';
import { opsProfile } from '../../data/ops.ts';
import { Icon, useToast } from '../../components/ui.tsx';

const FOLD_KEY = 'six.routine.folded';

/** Minutes after midnight now, in your time zone. */
function minutesNow(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return n('hour') * 60 + n('minute');
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}

/** "in 25 min", "in 2 h 10 min". */
function inText(minutes: number): string {
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${h} h${m ? ` ${m} min` : ''}`;
}

/**
 * Your day, on Today between the check-in and the week's goals: the routine at clock times, built
 * around one wake-up time. On a rest day (no workout today) the pre-workout and the lift drop out.
 * What's under way or next is marked; what's past fades and drops its
 * note. Change "Up at" and the whole day moves with it. Folds to one line (remembered on this
 * device) that still says what's next.
 */
export function DailyRoutine() {
  const { data, commit, today } = useStore();
  const toast = useToast();
  const view = useView();
  const routine = dailyRoutine(data.profile.daily_routine);
  // A lifting day is a day with a workout on it (moved or not, done or still to do); any other day is a
  // rest day: no pre-workout, no lift. A workout skipped today makes it a rest day too.
  // The optional home push-up practice isn't lifting: Wed and Sun stay rest days.
  const lift = view.sessionsOn(today).some((s) => {
    const a = view.action(s.action_id);
    return s.status !== 'skipped' && a?.kind === 'workout' && !isPushupPracticeOnly(a.workout_plan);
  });
  const rows = routineRows(routine, lift);
  const [now, setNow] = useState(() => minutesNow(data.profile.timezone));
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLD_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const t = setInterval(() => setNow(minutesNow(data.profile.timezone)), 30_000);
    return () => clearInterval(t);
  }, [data.profile.timezone]);

  const fold = (on: boolean) => {
    setFolded(on);
    try {
      localStorage.setItem(FOLD_KEY, on ? '1' : '0');
    } catch {
      // storage blocked: just for now
    }
  };

  const setWake = (wake: number) => {
    const before = data.profile.daily_routine ?? null;
    // Only the wake-up is saved; the items come from the app, so changes to them (rest days) reach you.
    commit(opsProfile({ daily_routine: { ...(data.profile.daily_routine ?? {}), wake, items: undefined } }));
    const lights = routineRows({ ...routine, wake }, lift).at(-1);
    toast(`Up at ${timeOfDay(wake)}${lights ? ` · ${lights.item.what.toLowerCase()} ${timeOfDay(lights.start)}` : ''}`, () => commit(opsProfile({ daily_routine: before })));
  };

  const where = routineNow(rows, now);
  const focus = where.current ?? where.next;
  const focusRow = focus != null ? rows[focus]! : null;
  const summary = focusRow
    ? `${where.current != null ? 'Now' : 'Next'}: ${focusRow.item.what} · ${focusRow.time}`
    : `Done for today · up at ${timeOfDay(routine.wake)}`;

  if (folded) {
    return (
      <button type="button" className="ritual-fold routine-fold" onClick={() => fold(false)} aria-expanded={false}>
        <span className="label">{lift ? 'Your day' : 'Rest day'}</span>
        <span className="xsmall muted routine-fold-sub">{summary}</span>
        <Icon name="chevron" size={14} stroke={2.2} />
      </button>
    );
  }

  return (
    <section className="card stack-sm routine" aria-label="Your day">
      <div className="row-between" style={{ gap: 8 }}>
        <button type="button" className="routine-head" onClick={() => fold(true)} aria-expanded>
          <span className="label">{lift ? 'Your day' : 'Rest day'}</span>
          <Icon name="chevron" size={14} stroke={2.2} />
        </button>
        <label className="routine-wake small">
          Up at
          <select value={routine.wake} onChange={(e) => setWake(Number(e.target.value))} aria-label="Wake-up time">
            {(WAKE_CHOICES.includes(routine.wake) ? WAKE_CHOICES : [...WAKE_CHOICES, routine.wake].sort((a, b) => a - b)).map((m) => (
              <option key={m} value={m}>
                {timeOfDay(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className="routine-list">
        {rows.map((r, i) => {
          const state = i === where.current ? 'now' : i === where.next && where.current == null ? 'next' : where.past(i) ? 'past' : '';
          return (
            <li key={`${r.item.at}-${r.item.what}`} className={`routine-row ${state}`} aria-current={state === 'now' || state === 'next' ? 'time' : undefined}>
              <span className="routine-time num">{r.time}</span>
              <span className="routine-mark" aria-hidden="true">
                {state === 'past' ? <Icon name="check" size={11} stroke={3} /> : null}
              </span>
              <span className="routine-body">
                <span className="routine-what">
                  {r.item.what}
                  {state === 'now' && <span className="routine-chip">Now</span>}
                  {state === 'next' && <span className="routine-chip">Next · {inText(r.start - now)}</span>}
                </span>
                {r.note && state !== 'past' && <span className="routine-note">{r.note}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
