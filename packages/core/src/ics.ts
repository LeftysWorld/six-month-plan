/**
 * Reading a calendar's iCal feed (the "secret address in iCal format" Google Calendar gives each
 * calendar): the events, with recurring ones expanded into their dates inside a window. One-way:
 * nothing here writes to the calendar.
 *
 * Covers what calendar apps put in a feed: time zones (TZID), all-day events, RRULE (daily, weekly,
 * monthly, yearly; INTERVAL, COUNT, UNTIL, BYDAY incl. "2TU" / "-1FR", BYMONTHDAY, BYMONTH),
 * EXDATE, moved or cancelled single instances (RECURRENCE-ID) and cancelled events.
 */

export interface CalendarInstance {
  /** Stable per occurrence: the event's UID plus the occurrence's original start. */
  key: string;
  uid: string;
  title: string;
  location: string;
  all_day: boolean;
  /** Timed: start and end as UTC ISO strings. All-day: null. */
  starts_at: string | null;
  ends_at: string | null;
  /** All-day: the first day and the day after the last (YYYY-MM-DD). Timed: null. */
  start_date: string | null;
  end_date: string | null;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Stamp {
  /** UTC ms (timed) or the date at UTC midnight (all-day). */
  ms: number;
  allDay: boolean;
  /** The zone the wall time was written in (recurrences step in it, so DST stays right). */
  tz: string | null;
  /** Floating or zoned wall time, for stepping. */
  wall: { y: number; m: number; d: number; h: number; mi: number; s: number };
}

interface VEvent {
  uid: string;
  title: string;
  location: string;
  status: string;
  start: Stamp | null;
  end: Stamp | null;
  durationMs: number | null;
  rrule: Record<string, string> | null;
  exdates: Stamp[];
  rdates: Stamp[];
  recurrenceId: Stamp | null;
}

/** Unfold continuation lines and split a feed into properties. */
function lines(text: string): Prop[] {
  const raw = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: Prop[] = [];
  for (const line of raw) {
    if (!line) continue;
    // NAME;PARAM=a;PARAM2="b:c":value: the first colon outside quotes ends the name part.
    let i = 0;
    let quoted = false;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === '"') quoted = !quoted;
      else if (c === ':' && !quoted) break;
    }
    if (i >= line.length) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const p: Record<string, string> = {};
    for (const x of params) {
      const eq = x.indexOf('=');
      if (eq > 0) p[x.slice(0, eq).toUpperCase()] = x.slice(eq + 1).replace(/^"|"$/g, '');
    }
    out.push({ name: name!.toUpperCase(), params: p, value: line.slice(i + 1) });
  }
  return out;
}

const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/** The UTC offset (ms) of a time zone at an instant; 0 for an unknown zone. */
function zoneOffset(ms: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - Math.floor(ms / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** A wall-clock time in a zone → UTC ms (two passes, so times next to a DST change land right). */
export function zonedToUtc(w: Stamp['wall'], tz: string | null): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (!tz) return guess;
  let t = guess - zoneOffset(guess, tz);
  t = guess - zoneOffset(t, tz);
  return t;
}

function stamp(p: Prop | undefined, calendarTz: string | null): Stamp | null {
  if (!p) return null;
  const v = p.value.trim().split(',')[0]!;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const wall = { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
  if (p.params.VALUE === 'DATE' || m[4] == null) return { ms: Date.UTC(wall.y, wall.m - 1, wall.d), allDay: true, tz: null, wall };
  if (m[7]) return { ms: Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s), allDay: false, tz: 'UTC', wall };
  const tz = p.params.TZID ?? calendarTz;
  return { ms: zonedToUtc(wall, tz), allDay: false, tz, wall };
}

function stamps(props: Prop[], calendarTz: string | null): Stamp[] {
  return props.flatMap((p) => p.value.split(',').map((v) => stamp({ ...p, value: v }, calendarTz)).filter((s): s is Stamp => !!s));
}

/** ISO 8601 duration (P1DT2H30M) → ms. */
function duration(v: string | undefined): number | null {
  const m = v ? /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim()) : null;
  if (!m) return null;
  const ms = (((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 + +(m[4] ?? 0)) * 60 + +(m[5] ?? 0)) * 60000 + +(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/** Parse a feed into its events (masters and single-instance overrides alike). */
export function parseIcs(text: string): VEvent[] {
  const props = lines(text);
  const calendarTz = props.find((p) => p.name === 'X-WR-TIMEZONE')?.value.trim() || null;
  const out: VEvent[] = [];
  let cur: Prop[] | null = null;
  let depth = 0;
  for (const p of props) {
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      cur = [];
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (p.name === 'BEGIN') depth++;
    else if (p.name === 'END' && p.value.toUpperCase() !== 'VEVENT') depth--;
    else if (p.name === 'END') {
      const get = (n: string) => cur!.find((x) => x.name === n);
      const all = (n: string) => cur!.filter((x) => x.name === n);
      const rr = get('RRULE')?.value;
      out.push({
        uid: get('UID')?.value.trim() ?? '',
        title: unescape(get('SUMMARY')?.value ?? '') || '(No title)',
        location: unescape(get('LOCATION')?.value ?? ''),
        status: (get('STATUS')?.value ?? '').trim().toUpperCase(),
        start: stamp(get('DTSTART'), calendarTz),
        end: stamp(get('DTEND'), calendarTz),
        durationMs: duration(get('DURATION')?.value),
        rrule: rr ? Object.fromEntries(rr.split(';').map((kv) => kv.split('=') as [string, string]).filter(([k, v]) => k && v).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()])) : null,
        exdates: stamps(all('EXDATE'), calendarTz),
        rdates: stamps(all('RDATE'), calendarTz),
        recurrenceId: stamp(get('RECURRENCE-ID'), calendarTz),
      });
      cur = null;
      continue;
    }
    if (depth === 0) cur.push(p); // skip VALARM and other nested parts
  }
  return out.filter((e) => e.uid && e.start);
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dowOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (w: Stamp['wall'], n: number): Stamp['wall'] => {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { ...w, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** The wall-clock starts of a recurring event, in order, until `toMs` (or COUNT/UNTIL). */
function occurrences(e: VEvent, toMs: number): Stamp[] {
  const start = e.start!;
  const r = e.rrule!;
  const freq = r.FREQ;
  const interval = Math.max(1, Number(r.INTERVAL ?? 1) || 1);
  const count = r.COUNT ? Number(r.COUNT) : null;
  const until = r.UNTIL ? stamp({ name: 'UNTIL', params: {}, value: r.UNTIL }, start.tz)?.ms ?? null : null;
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => /^([+-]?\d+)?([A-Z]{2})$/.exec(x)).filter(Boolean).map((m) => ({ n: m![1] ? Number(m![1]) : null, dow: DAYS.indexOf(m![2]!) })) : null;
  const bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = r.BYMONTH ? r.BYMONTH.split(',').map(Number) : null;
  const toStamp = (w: Stamp['wall']): Stamp => ({ ms: start.allDay ? Date.UTC(w.y, w.m - 1, w.d) : zonedToUtc(w, start.tz === 'UTC' ? null : start.tz), allDay: start.allDay, tz: start.tz, wall: w });

  const out: Stamp[] = [];
  const push = (w: Stamp['wall']) => {
    const s = toStamp(w);
    if (s.ms < start.ms) return true;
    if ((until != null && s.ms > until) || s.ms > toMs || (count != null && out.length >= count)) return false;
    out.push(s);
    return true;
  };

  let guard = 0;
  if (freq === 'DAILY') {
    for (let w = start.wall; guard++ < 20000; w = addDays(w, interval)) {
      if (bymonth && !bymonth.includes(w.m)) continue;
      if (byday && !byday.some((b) => b.dow === dowOf(w.y, w.m, w.d))) continue;
      if (!push(w)) break;
    }
  } else if (freq === 'WEEKLY') {
    const days = byday?.map((b) => b.dow) ?? [dowOf(start.wall.y, start.wall.m, start.wall.d)];
    // Weeks start on Monday (WKST=MO, Google's default).
    const offset = (dow: number) => (dow + 6) % 7;
    let week = addDays(start.wall, -offset(dowOf(start.wall.y, start.wall.m, start.wall.d)));
    outer: for (; guard++ < 5000; week = addDays(week, 7 * interval)) {
      for (const dow of [...days].sort((a, b) => offset(a) - offset(b))) {
        if (!push(addDays(week, offset(dow)))) break outer;
      }
    }
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    let y = start.wall.y;
    let m = start.wall.m;
    const step = freq === 'MONTHLY' ? interval : 12 * interval;
    outer: for (; guard++ < 3000; ) {
      if (!bymonth || bymonth.includes(m)) {
        let days: number[];
        if (byday) {
          days = [];
          for (const b of byday) {
            const all = Array.from({ length: daysIn(y, m) }, (_, i) => i + 1).filter((d) => dowOf(y, m, d) === b.dow);
            if (b.n == null) days.push(...all);
            else {
              const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
              if (d) days.push(d);
            }
          }
        } else if (bymonthday) {
          days = bymonthday.map((d) => (d > 0 ? d : daysIn(y, m) + d + 1)).filter((d) => d >= 1 && d <= daysIn(y, m));
        } else {
          days = freq === 'YEARLY' && m !== start.wall.m ? [] : start.wall.d <= daysIn(y, m) ? [start.wall.d] : [];
        }
        for (const d of [...new Set(days)].sort((a, b) => a - b)) {
          if (!push({ ...start.wall, y, m, d })) break outer;
        }
      }
      // YEARLY with BYMONTH walks every month of the year; plain YEARLY jumps a year.
      if (freq === 'YEARLY' && bymonth) {
        m += 1;
        if (m > 12) {
          m = 1;
          y += interval;
        }
      } else {
        m += step;
        while (m > 12) {
          m -= 12;
          y += 1;
        }
      }
    }
  } else {
    out.push(start);
  }
  return out;
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Every occurrence that overlaps [fromMs, toMs], one-off and recurring, with moved and cancelled
 * instances applied. Cancelled events and instances are left out.
 */
export function expandIcs(text: string, fromMs: number, toMs: number): CalendarInstance[] {
  const events = parseIcs(text);
  const overrides = new Map<string, VEvent>();
  for (const e of events) if (e.recurrenceId) overrides.set(`${e.uid}|${e.recurrenceId.ms}`, e);
  const out: CalendarInstance[] = [];

  const emit = (e: VEvent, start: Stamp, originalMs: number) => {
    if (e.status === 'CANCELLED') return;
    const lengthMs = e.end ? e.end.ms - e.start!.ms : e.durationMs ?? (start.allDay ? 86400000 : 0);
    const endMs = start.ms + Math.max(0, lengthMs);
    if (endMs < fromMs || start.ms > toMs || (endMs === fromMs && lengthMs > 0)) return;
    out.push({
      key: `${e.uid}|${new Date(originalMs).toISOString()}`,
      uid: e.uid,
      title: e.title,
      location: e.location,
      all_day: start.allDay,
      starts_at: start.allDay ? null : new Date(start.ms).toISOString(),
      ends_at: start.allDay ? null : new Date(endMs).toISOString(),
      start_date: start.allDay ? isoDate(start.ms) : null,
      end_date: start.allDay ? isoDate(Math.max(endMs, start.ms + 86400000)) : null,
    });
  };

  for (const e of events) {
    if (e.recurrenceId) continue;
    if (!e.rrule && !e.rdates.length) {
      emit(e, e.start!, e.start!.ms);
      continue;
    }
    const excluded = new Set(e.exdates.map((x) => x.ms));
    const starts = [...(e.rrule ? occurrences(e, toMs) : [e.start!]), ...e.rdates].filter((s, i, all) => all.findIndex((x) => x.ms === s.ms) === i);
    for (const s of starts) {
      if (excluded.has(s.ms)) continue;
      const moved = overrides.get(`${e.uid}|${s.ms}`);
      if (moved) {
        emit(moved, moved.start!, s.ms);
        overrides.delete(`${e.uid}|${s.ms}`);
      } else emit(e, s, s.ms);
    }
  }
  // An override whose series isn't in the feed (or whose date the rule doesn't produce) still counts.
  for (const [k, o] of overrides) emit(o, o.start!, Number(k.split('|').at(-1)));
  return out.sort((a, b) => (a.starts_at ?? `${a.start_date}T00`).localeCompare(b.starts_at ?? `${b.start_date}T00`));
}
