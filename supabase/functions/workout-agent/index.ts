// workout-agent: the only door the workout coach agent has into your data.
//
//   GET  /functions/v1/workout-agent/history?as_of=2026-10-30&months=6&format=json|md
//        Your workout history up to a date: the snapshot (JSON) the coach reads, or the same thing
//        as the report you read (Markdown). Workouts only: plans and their history, logged sets,
//        notes, body weight (unless turned off in Settings) and past coach decisions. Nothing else.
//   POST /functions/v1/workout-agent/reports
//        Save one coach report. That's the only thing it can write.
//
// Who can call it:
//   - the coach agent, with header `x-agent-key: <WORKOUT_AGENT_KEY>`; it acts for WORKOUT_AGENT_USER_ID only
//   - you, signed in (Authorization: Bearer <your session token>), for your own data
//
// Deploy:   supabase functions deploy workout-agent --no-verify-jwt
// Secrets:  supabase secrets set WORKOUT_AGENT_KEY=<long random string> WORKOUT_AGENT_USER_ID=<your user id>
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. The service key stays in
// here: every query below is filtered to one user, and the agent never sees the key.)

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { buildSnapshot, renderReport, SCHEMA_VERSION, type Decision, type HistoryInput } from '../_shared/workout_history.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REPORT_CHARS = 200_000;
const MAX_REPORTS_PER_DAY = 5;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-agent-key, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

/** Compare two secrets without leaking how much of them matched. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Who is calling: the agent (by key) or you (by sign-in). Null when neither checks out. */
async function caller(req: Request, sb: SupabaseClient): Promise<{ userId: string; who: 'agent' | 'user' } | null> {
  const agentKey = req.headers.get('x-agent-key');
  const expected = Deno.env.get('WORKOUT_AGENT_KEY') ?? '';
  const agentUser = Deno.env.get('WORKOUT_AGENT_USER_ID') ?? '';
  if (agentKey) {
    if (expected.length >= 32 && agentUser && sameSecret(agentKey, expected)) return { userId: agentUser, who: 'agent' };
    return null;
  }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, who: 'user' };
}

/** Today in a time zone, as YYYY-MM-DD. */
function todayIn(timeZone: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Every row of a query, 1,000 at a time. */
async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Load one user's workout data, and only that. */
async function loadInput(sb: SupabaseClient, userId: string, from: string, asOf: string): Promise<HistoryInput> {
  const { data: profile, error: pe } = await sb.from('profiles').select('units, timezone, coach_share_bodyweight').eq('user_id', userId).maybeSingle();
  if (pe) throw new Error(`profiles: ${pe.message}`);
  const actions = await all((a, b) => sb.from('actions').select('id, title, kind, planned_minutes, archived_at, workout_plan, details').eq('user_id', userId).range(a, b));
  const workoutIds = new Set(actions.filter((x: { kind: string; workout_plan: unknown }) => x.kind === 'workout' || (Array.isArray(x.workout_plan) && x.workout_plan.length > 0)).map((x: { id: string }) => x.id));
  const schedules = await all((a, b) => sb.from('action_schedules').select('action_id, rule, days, per_week, effective_from, effective_to').eq('user_id', userId).range(a, b));
  const sessions = (
    await all((a, b) =>
      sb.from('sessions').select('id, action_id, date, week_start, title, status, planned_minutes, actual_minutes, note, origin').eq('user_id', userId).gte('date', from).lte('date', asOf).range(a, b),
    )
  ).filter((s: { action_id: string | null }) => s.action_id && workoutIds.has(s.action_id));
  const ids = sessions.map((s: { id: string }) => s.id);
  const sets: HistoryInput['sets'] = [];
  for (let i = 0; i < ids.length; i += 200) {
    sets.push(...(await all((a, b) => sb.from('workout_sets').select('session_id, exercise, set_no, weight, reps, done, rir, pain').eq('user_id', userId).in('session_id', ids.slice(i, i + 200)).range(a, b))));
  }
  const planVersions = await all((a, b) => sb.from('workout_plan_versions').select('action_id, plan, details, effective_on, source, reason, created_at').eq('user_id', userId).lte('effective_on', asOf).range(a, b));
  const share = profile?.coach_share_bodyweight !== false;
  const measurementTypes = share ? await all((a, b) => sb.from('measurement_types').select('id, name, unit, archived_at').eq('user_id', userId).range(a, b)) : [];
  const weightTypes = measurementTypes.filter((t: { name: string }) => /weight/i.test(t.name)).map((t: { id: string }) => t.id);
  const measurements = share && weightTypes.length
    ? await all((a, b) => sb.from('measurements').select('type_id, value, measured_on').eq('user_id', userId).in('type_id', weightTypes).gte('measured_on', from).lte('measured_on', asOf).range(a, b))
    : [];
  const reports = await all((a, b) =>
    sb.from('workout_reports').select('id, as_of, created_at, recommendation, change_level, decision, user_status, user_note').eq('user_id', userId).eq('kind', 'coach').lte('as_of', asOf).order('as_of').range(a, b),
  );
  return {
    profile: { units: profile?.units ?? 'lb', timezone: profile?.timezone ?? 'America/New_York', coach_share_bodyweight: share },
    actions: actions.filter((x: { id: string }) => workoutIds.has(x.id)) as HistoryInput['actions'],
    schedules: (schedules as HistoryInput['schedules']).filter((s) => workoutIds.has(s.action_id)),
    sessions: sessions as HistoryInput['sessions'],
    sets: sets.map((s) => ({ ...s, weight: s.weight == null ? null : Number(s.weight) })),
    planVersions: planVersions as HistoryInput['planVersions'],
    measurementTypes: measurementTypes as HistoryInput['measurementTypes'],
    measurements: (measurements as { type_id: string; value: number; measured_on: string }[]).map((m) => ({ ...m, value: Number(m.value) })),
    reports: reports as HistoryInput['reports'],
  };
}

/** Check a coach report before it's saved. Returns the problems (empty when it's fine). */
function checkReport(body: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (typeof body.as_of !== 'string' || !ISO.test(body.as_of)) problems.push('as_of must be YYYY-MM-DD');
  if (typeof body.content_md !== 'string' || body.content_md.trim().length < 50) problems.push('content_md is missing or too short');
  else if (body.content_md.length > MAX_REPORT_CHARS) problems.push(`content_md is longer than ${MAX_REPORT_CHARS} characters`);
  const d = body.decision as Partial<Decision> | undefined;
  if (!d || typeof d !== 'object') problems.push('decision is missing');
  else {
    if (!['hold', 'change', 'none'].includes(String(d.recommendation))) problems.push('decision.recommendation must be hold, change or none');
    if (!Number.isInteger(d.change_level) || (d.change_level as number) < 0 || (d.change_level as number) > 6) problems.push('decision.change_level must be 0–6');
    if (typeof d.summary !== 'string' || !d.summary.trim()) problems.push('decision.summary is missing');
    if (!Array.isArray(d.changes) || d.changes.length > 30) problems.push('decision.changes must be a list of at most 30');
    else if (d.changes.some((c) => !c || typeof c.workout !== 'string' || typeof c.exercise !== 'string' || typeof c.type !== 'string')) problems.push('every change needs workout, exercise and type');
    if (d.recommendation === 'hold' && d.change_level !== 0) problems.push('a hold is change level 0');
  }
  for (const f of ['model', 'prompt_version', 'snapshot_hash', 'schema_version']) if (body[f] != null && typeof body[f] !== 'string') problems.push(`${f} must be text`);
  return problems;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, '').split('/').pop();
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const who = await caller(req, sb);
  if (!who) return json({ error: 'Not allowed' }, 401);

  try {
    const { data: prof } = await sb.from('profiles').select('timezone').eq('user_id', who.userId).maybeSingle();
    const today = todayIn(prof?.timezone ?? 'America/New_York');

    if (req.method === 'GET' && route === 'history') {
      const asOf = url.searchParams.get('as_of') ?? today;
      if (!ISO.test(asOf) || asOf > today) return json({ error: 'as_of must be YYYY-MM-DD and not after today' }, 400);
      const months = Math.min(24, Math.max(1, Number(url.searchParams.get('months') ?? 6) || 6));
      const fromDate = new Date(`${asOf}T00:00:00Z`);
      fromDate.setUTCMonth(fromDate.getUTCMonth() - months);
      const input = await loadInput(sb, who.userId, fromDate.toISOString().slice(0, 10), asOf);
      const snapshot = buildSnapshot(input, { asOf, months });
      if (url.searchParams.get('format') === 'md') {
        return new Response(renderReport(snapshot), { headers: { ...CORS, 'Content-Type': 'text/markdown; charset=utf-8' } });
      }
      return json(snapshot);
    }

    if (req.method === 'POST' && route === 'reports') {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return json({ error: 'Send the report as JSON' }, 400);
      const problems = checkReport(body);
      if (problems.length) return json({ error: 'The report was not saved', problems }, 422);
      const asOf = body.as_of as string;
      if (asOf > today) return json({ error: 'as_of is after today' }, 422);
      // A handful a day at most, so a runaway loop can't fill the table.
      const { count } = await sb.from('workout_reports').select('id', { count: 'exact', head: true }).eq('user_id', who.userId).gte('created_at', `${today}T00:00:00Z`);
      if ((count ?? 0) >= MAX_REPORTS_PER_DAY) return json({ error: `At most ${MAX_REPORTS_PER_DAY} reports a day` }, 429);
      // One report per as-of date: a re-run replaces it, unless you've already marked it.
      const { data: existing } = await sb.from('workout_reports').select('id, user_status').eq('user_id', who.userId).eq('kind', 'coach').eq('as_of', asOf).maybeSingle();
      if (existing?.user_status) return json({ error: `You've already marked the ${asOf} report as ${existing.user_status}; it isn't replaced` }, 409);
      // Was it made from the data as it is now? Stored either way; the answer goes back to the agent.
      const months = Math.min(24, Math.max(1, Number(body.months ?? 6) || 6));
      const fromDate = new Date(`${asOf}T00:00:00Z`);
      fromDate.setUTCMonth(fromDate.getUTCMonth() - months);
      const current = buildSnapshot(await loadInput(sb, who.userId, fromDate.toISOString().slice(0, 10), asOf), { asOf, months }).meta.fingerprint;
      const decision = body.decision as Decision;
      const row = {
        user_id: who.userId,
        kind: 'coach',
        as_of: asOf,
        months,
        schema_version: String(body.schema_version ?? SCHEMA_VERSION),
        snapshot_hash: String(body.snapshot_hash ?? ''),
        content_md: body.content_md as string,
        decision,
        recommendation: decision.recommendation,
        change_level: decision.change_level,
        model: String(body.model ?? ''),
        prompt_version: String(body.prompt_version ?? ''),
      };
      const { data: saved, error } = existing
        ? await sb.from('workout_reports').update(row).eq('id', existing.id).select('id').single()
        : await sb.from('workout_reports').insert(row).select('id').single();
      if (error) return json({ error: error.message }, 500);
      return json({ id: saved.id, replaced: !!existing, stale: !!row.snapshot_hash && row.snapshot_hash !== current, current_fingerprint: current }, existing ? 200 : 201);
    }

    return json({ error: 'Use GET /history or POST /reports' }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
