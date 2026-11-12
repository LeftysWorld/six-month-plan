import { useEffect, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { eventsOn, type DayEvent } from '../../data/googleCalendar.ts';
import { href } from '../../router.ts';

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

/**
 * What's on your calendar this day (Settings → Google Calendar), at the top of Today, read-only:
 * all-day events first, then by time. Not tasks: nothing counts them. On today, what's over fades
 * and what's on now is marked.
 */
export function DayCalendar({ day }: { day: string }) {
  const { data, today } = useStore();
  const tz = data.profile.timezone;
  const [now, setNow] = useState(() => minutesNow(tz));
  useEffect(() => {
    const t = setInterval(() => setNow(minutesNow(tz)), 30_000);
    return () => clearInterval(t);
  }, [tz]);
  if (!(data.calendarFeeds ?? []).length) return null;
  const events = eventsOn(data, day, tz);
  if (!events.length) return null;
  const isToday = day === today;
  const state = (d: DayEvent) => {
    if (day < today) return 'past';
    if (!isToday || d.time === 'All day') return '';
    return d.end <= now ? 'past' : d.start <= now ? 'now' : '';
  };
  const left = isToday ? events.filter((d) => state(d) !== 'past').length : events.length;

  return (
    <section className="card stack-sm day-cal" aria-label="Calendar">
      <div className="row-between" style={{ gap: 8 }}>
        <span className="label">Calendar</span>
        <a className="xsmall muted" href={href('/settings/calendar')}>
          {isToday ? (left ? `${left} still to come` : 'All done for today') : `${events.length} event${events.length === 1 ? '' : 's'}`}
        </a>
      </div>
      <ol className="day-cal-list">
        {events.map((d) => {
          const s = state(d);
          return (
            <li key={d.event.id} className={`day-cal-row ${s}`} style={{ ['--cal' as string]: d.feed?.color || '#4285f4' }}>
              <span className="day-cal-time num">{d.time}</span>
              <span className="day-cal-bar" aria-hidden="true" />
              <span className="day-cal-body">
                <span className="day-cal-title">
                  {d.event.title || 'Busy'}
                  {s === 'now' && <span className="routine-chip">Now</span>}
                </span>
                {d.event.location && s !== 'past' && <span className="day-cal-note">{d.event.location}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
