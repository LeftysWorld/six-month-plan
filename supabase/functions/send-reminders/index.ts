// send-reminders: called every 15 minutes by pg_cron (see supabase/cron.sql).
// For each push subscription it works out the owner's local date and time and sends:
//   * a morning summary once per local day, at or after their reminder time
//     (within MORNING_WINDOW_MIN, so turning reminders on at night doesn't send a stale "morning" push);
//   * an evening "streak saver" once per local day at or after 21:00, only if they haven't checked in.
// Subscriptions the push service says are gone (404/410) are deleted.
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...) and CRON_SECRET with `supabase secrets set`.
// Deploy: supabase functions deploy send-reminders --no-verify-jwt
// (the function checks the CRON_SECRET / service role key itself).

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import webpushModule from 'npm:web-push@3.6.7';

interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
interface WebPush {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    target: PushTarget,
    payload: string,
    options?: { TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string },
  ): Promise<{ statusCode: number }>;
}
const webpush = webpushModule as unknown as WebPush;

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  last_morning_on: string | null;
  last_evening_on: string | null;
  last_review_on: string | null;
}
interface ProfileRow {
  user_id: string;
  timezone: string | null;
  reminder_time: string | null;
  evening_reminder: boolean | null;
  review_reminder: boolean | null;
}
interface SessionRow {
  title: string;
  status: string;
  priority: boolean;
  slot: number;
  created_at: string;
}
interface Payload {
  title: string;
  body: string;
  url: string;
  tag: string;
  badge?: number;
}

const EVENING_MINUTES = 21 * 60;
// Sunday from 18:00 local: "two minutes to review" (the weekly review opens Saturday).
const REVIEW_MINUTES = 18 * 60;
const MORNING_WINDOW_MIN = 180;
const DEFAULT_TZ = 'America/New_York';
const CHECKED_IN = new Set(['done', 'partial', 'minimum']);
const NOT_A_TASK = new Set(['moved', 'skipped']);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Constant-time-ish string comparison so the secret can't be guessed by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Local calendar date (YYYY-MM-DD) and minutes since midnight in an IANA time zone. */
function localNow(timeZone: string, now: Date): { date: string; minutes: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    return localNow(DEFAULT_TZ, now); // unknown zone name: fall back rather than skip the user
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute) };
}

/** "08:00" or "08:00:00" → 480. */
function timeToMinutes(value: string | null | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  if (!m) return fallback;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

async function sessionsOn(sb: SupabaseClient, userId: string, date: string): Promise<SessionRow[]> {
  const { data, error } = await sb
    .from('sessions')
    .select('title, status, priority, slot, created_at')
    .eq('user_id', userId)
    .eq('date', date);
  if (error) throw new Error(`sessions: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

function morningPayload(sessions: SessionRow[], date: string): Payload {
  const tasks = sessions.filter((s) => !NOT_A_TASK.has(s.status));
  const planned = tasks
    .filter((s) => s.status === 'planned')
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.slot - b.slot || a.created_at.localeCompare(b.created_at));
  const n = tasks.length;
  const first = planned[0];
  return {
    title: `Today: ${n} ${n === 1 ? 'task' : 'tasks'}`,
    body: first ? `Start with ${first.title}` : n > 0 ? 'All done already. Nice.' : 'Nothing planned — add one thing',
    url: '/#/today',
    tag: `morning-${date}`,
    badge: planned.length,
  };
}

function reviewPayload(date: string): Payload {
  return { title: 'Two minutes to review', body: 'Your week in a few lines, then next week’s plan.', url: '/#/review/weekly', tag: `review-${date}` };
}

function eveningPayload(date: string): Payload {
  return { title: 'Keep your streak going', body: 'One small task counts.', url: '/#/today', tag: `evening-${date}` };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

  if (!supabaseUrl || !serviceKey) return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);

  // Only the scheduler (or you, with the service role key) may run this.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const allowed = token.length > 0 && ((cronSecret !== '' && safeEqual(token, cronSecret)) || safeEqual(token, serviceKey));
  if (!allowed) return json({ error: 'Unauthorized' }, 401);

  if (!vapidPublic || !vapidPrivate) return json({ error: 'Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY' }, 500);
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const result = { checked: 0, sent: 0, removed: 0, errors: [] as string[] };

  const { data: subData, error: subError } = await sb
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, last_morning_on, last_evening_on, last_review_on');
  if (subError) return json({ error: `push_subscriptions: ${subError.message}` }, 500);
  const subs = (subData ?? []) as SubscriptionRow[];
  if (subs.length === 0) return json(result);

  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const { data: profData, error: profError } = await sb
    .from('profiles')
    .select('user_id, timezone, reminder_time, evening_reminder, review_reminder')
    .in('user_id', userIds);
  if (profError) return json({ error: `profiles: ${profError.message}` }, 500);
  const profiles = new Map<string, ProfileRow>(((profData ?? []) as ProfileRow[]).map((p) => [p.user_id, p]));

  for (const userId of userIds) {
    const profile = profiles.get(userId);
    const local = localNow(profile?.timezone || DEFAULT_TZ, now);
    const morningAt = timeToMinutes(profile?.reminder_time, 8 * 60);
    const eveningOn = profile?.evening_reminder ?? true;
    const userSubs = subs.filter((s) => s.user_id === userId);
    result.checked += userSubs.length;

    const morningDue = local.minutes >= morningAt && local.minutes < morningAt + MORNING_WINDOW_MIN;
    const eveningDue = eveningOn && local.minutes >= EVENING_MINUTES;
    const wantMorning = morningDue ? userSubs.filter((s) => s.last_morning_on !== local.date) : [];
    const wantEvening = eveningDue
      ? userSubs.filter((s) => s.last_evening_on !== local.date && !wantMorning.includes(s))
      : [];
    // Sunday review nudge: weekday from the local date (0 = Sunday).
    const sunday = new Date(`${local.date}T12:00:00Z`).getUTCDay() === 0;
    const reviewDue = sunday && (profile?.review_reminder ?? true) && local.minutes >= REVIEW_MINUTES && local.minutes < EVENING_MINUTES;
    const wantReview = reviewDue ? userSubs.filter((s) => s.last_review_on !== local.date && !wantMorning.includes(s)) : [];
    if (wantMorning.length === 0 && wantEvening.length === 0 && wantReview.length === 0) continue;

    let sessions: SessionRow[];
    try {
      sessions = await sessionsOn(sb, userId, local.date);
    } catch (e) {
      result.errors.push((e as Error).message);
      continue;
    }
    const checkedIn = sessions.some((s) => CHECKED_IN.has(s.status));

    const jobs: { sub: SubscriptionRow; payload: Payload; field: 'last_morning_on' | 'last_evening_on' | 'last_review_on' }[] = [];
    for (const sub of wantMorning) jobs.push({ sub, payload: morningPayload(sessions, local.date), field: 'last_morning_on' });
    for (const sub of wantReview) jobs.push({ sub, payload: reviewPayload(local.date), field: 'last_review_on' });
    if (!checkedIn) {
      for (const sub of wantEvening) jobs.push({ sub, payload: eveningPayload(local.date), field: 'last_evening_on' });
    }

    for (const { sub, payload, field } of jobs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 4 * 60 * 60, urgency: 'normal' },
        );
        result.sent++;
        const { error } = await sb.from('push_subscriptions').update({ [field]: local.date }).eq('id', sub.id);
        if (error) result.errors.push(`update ${sub.id}: ${error.message}`);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await sb.from('push_subscriptions').delete().eq('id', sub.id);
          result.removed++;
        } else {
          result.errors.push(`push ${sub.id}: ${status ?? ''} ${(e as Error).message}`.trim());
        }
      }
    }
  }

  return json(result);
});
