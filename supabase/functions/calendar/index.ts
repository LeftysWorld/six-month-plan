// calendar: a read-only iCalendar (.ics) feed of the next 14 days.
// One 30-minute "Check in" event per day at your reminder time, listing that day's tasks, with an alert.
// Public URL, protected by the secret token in profiles.calendar_token:
//   https://YOUR-PROJECT.supabase.co/functions/v1/calendar?token=YOUR-TOKEN
// Deploy: supabase functions deploy calendar --no-verify-jwt
// Optional secret APP_URL (e.g. https://six.example.com) adds a link back to the app on each event.

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ProfileRow {
  user_id: string;
  timezone: string | null;
  reminder_time: string | null;
}
interface SessionRow {
  date: string;
  title: string;
  status: string;
  priority: boolean;
  slot: number;
  created_at: string;
}

const DAYS = 14;
const DEFAULT_TZ = 'America/New_York';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function validZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Wall-clock parts of an instant in a time zone. */
function zonedParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}

/** UTC milliseconds for a local date + time in a time zone (handles DST). */
function zonedToUtc(date: string, minutes: number, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, timeZone);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const next = guess + (wall - seen);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

function todayIn(timeZone: string, now: Date): string {
  const p = zonedParts(now.getTime(), timeZone);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

function timeToMinutes(value: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!m) return 8 * 60;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/** 20261021T120000Z */
function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 TEXT escaping. */
function esc(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (UTF-8), never splitting a character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Method not allowed', 405);
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!UUID_RE.test(token)) return text('Missing or invalid token', 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return text('Server not configured', 500);
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: prof, error: profError } = await sb
    .from('profiles')
    .select('user_id, timezone, reminder_time')
    .eq('calendar_token', token)
    .maybeSingle();
  if (profError) return text('Could not load calendar', 500);
  if (!prof) return text('Calendar not found', 404);
  const profile = prof as ProfileRow;

  const tz = validZone(profile.timezone);
  const now = new Date();
  const first = todayIn(tz, now);
  const last = addDays(first, DAYS - 1);
  const startMin = timeToMinutes(profile.reminder_time);

  const { data: sessData, error: sessError } = await sb
    .from('sessions')
    .select('date, title, status, priority, slot, created_at')
    .eq('user_id', profile.user_id)
    .gte('date', first)
    .lte('date', last)
    .in('status', ['planned', 'done']);
  if (sessError) return text('Could not load tasks', 500);

  const byDate = new Map<string, SessionRow[]>();
  for (const s of (sessData ?? []) as SessionRow[]) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }

  const stamp = icsUtc(now.getTime());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Six Months//Check-ins//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Six Months',
    `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (let i = 0; i < DAYS; i++) {
    const date = addDays(first, i);
    const tasks = (byDate.get(date) ?? []).sort(
      (a, b) => Number(b.priority) - Number(a.priority) || a.slot - b.slot || a.created_at.localeCompare(b.created_at),
    );
    const n = tasks.length;
    const start = zonedToUtc(date, startMin, tz);
    const summary = `Check in · ${n} ${n === 1 ? 'task' : 'tasks'}`;
    const description = n > 0
      ? tasks.map((t) => `${t.status === 'done' ? '✓' : '•'} ${t.title}`).join('\n')
      : 'Nothing planned yet — add one thing.';
    lines.push(
      'BEGIN:VEVENT',
      `UID:checkin-${date}-${profile.user_id}@six-months`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsUtc(start)}`,
      `DTEND:${icsUtc(start + 30 * 60 * 1000)}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(description)}`,
      'TRANSP:TRANSPARENT',
    );
    if (appUrl) lines.push(`URL:${appUrl}/#/today`);
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(summary)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  const body = lines.map(fold).join('\r\n') + '\r\n';
  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="six-months.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  });
});
