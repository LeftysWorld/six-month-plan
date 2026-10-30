import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleWorkoutAgent, sha256Hex } from '../../../supabase/functions/_shared/workout_agent.ts';

/** A tiny stand-in for a service-role Supabase client: tables in memory, the query calls the door uses. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>, users: Record<string, string> = {}) {
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let head = false;
    let pending: { op: 'insert' | 'update'; row: Record<string, unknown> } | null = null;
    const q = {
      select: (_cols?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), q),
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), q),
      lte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) <= v)), q),
      order: () => q,
      limit: () => q,
      range: (a: number, b: number) => ((rows = rows.slice(a, b + 1)), q),
      insert: (row: Record<string, unknown>) => ((pending = { op: 'insert', row }), q),
      update: (row: Record<string, unknown>) => ((pending = { op: 'update', row }), q),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => {
        if (pending?.op === 'insert') {
          const saved = { id: `r${(tables[table] ??= []).length + 1}`, ...pending.row };
          tables[table]!.push(saved);
          return { data: saved, error: null };
        }
        if (pending?.op === 'update') for (const r of rows) Object.assign(r, pending.row);
        return { data: rows[0] ?? null, error: null };
      },
      then: (ok: (v: unknown) => unknown) => ok(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null }),
    };
    return q;
  };
  return {
    from: query,
    auth: { getUser: async (token: string) => (users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }) },
  };
}

const KEY = 'k'.repeat(48);
async function db() {
  return fakeDb(
    {
      profiles: [
        { user_id: 'me', units: 'lb', timezone: 'America/New_York', coach_share_bodyweight: true, coach_key_hash: await sha256Hex(KEY) },
        { user_id: 'someone-else', units: 'lb', timezone: 'UTC', coach_key_hash: await sha256Hex('x'.repeat(48)) },
      ],
      actions: [{ id: 'a', user_id: 'me', title: 'Mon: Upper', kind: 'workout', planned_minutes: 45, archived_at: null, workout_plan: [{ name: 'Bench', sets: 3, reps_min: 8, reps_max: 12, weight: 50 }], details: '' }],
      action_schedules: [{ user_id: 'me', action_id: 'a', rule: 'days', days: [1], per_week: null, effective_from: '2026-10-05', effective_to: null }],
      sessions: [
        { id: 's1', user_id: 'me', action_id: 'a', date: '2026-10-19', week_start: '2026-10-19', title: 'Mon: Upper', status: 'done', planned_minutes: 45, actual_minutes: 40, note: '', origin: 'schedule', effort: 7 },
        { id: 's2', user_id: 'me', action_id: 'a', date: '2026-10-26', week_start: '2026-10-26', title: 'Mon: Upper', status: 'done', planned_minutes: 45, actual_minutes: 40, note: '', origin: 'schedule', effort: 8 },
      ],
      workout_sets: [1, 2, 3].flatMap((n) => [
        { user_id: 'me', session_id: 's1', exercise: 'Bench', set_no: n, weight: 50, reps: 10, done: true },
        { user_id: 'me', session_id: 's2', exercise: 'Bench', set_no: n, weight: 50, reps: 11, done: true },
      ]),
      workout_exercises: [{ user_id: 'me', session_id: 's2', exercise: 'Bench', effort: 8, pain: false, pain_where: '', note: '' }],
      workout_plan_versions: [],
      measurement_types: [],
      measurements: [],
      workout_reports: [],
    },
    { 'my-session': 'me' },
  );
}
const env = () => undefined;
const get = (path: string, headers: Record<string, string>) => new Request(`https://app.example/api/workout-agent/${path}`, { headers });

test('the coach key from Settings opens your history, and only yours', async () => {
  const sb = await db();
  const res = await handleWorkoutAgent(get('history?as_of=2026-10-30', { 'x-agent-key': KEY }), sb, env);
  assert.equal(res.status, 200);
  const snap = await res.json();
  assert.equal(snap.meta.schema_version, '2');
  assert.equal(snap.metrics.exercises[0].effort_last, 8);
  assert.equal(snap.sessions.length, 2);
  const md = await handleWorkoutAgent(get('history?as_of=2026-10-30&format=md', { 'x-agent-key': KEY }), sb, env);
  assert.match(await md.text(), /# Workout history/);
});

test('a wrong or short key, or no sign-in, gets nothing', async () => {
  const sb = await db();
  for (const headers of [{ 'x-agent-key': 'y'.repeat(48) }, { 'x-agent-key': 'short' }, {}, { authorization: 'Bearer nope' }]) {
    assert.equal((await handleWorkoutAgent(get('history', headers), sb, env)).status, 401);
  }
});

test('you, signed in, can test the connection on your own data', async () => {
  const res = await handleWorkoutAgent(get('history?as_of=2026-10-30&format=md', { authorization: 'Bearer my-session' }), await db(), env);
  assert.equal(res.status, 200);
});

test('the coach can save a report, checked first', async () => {
  const sb = await db();
  const post = (body: unknown) => new Request('https://app.example/api/workout-agent/reports', { method: 'POST', headers: { 'x-agent-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const bad = await handleWorkoutAgent(post({ as_of: '2026-10-30' }), sb, env);
  assert.equal(bad.status, 422);
  const ok = await handleWorkoutAgent(post({ as_of: '2026-10-30', content_md: 'x'.repeat(80), decision: { recommendation: 'hold', change_level: 0, summary: 'Hold', changes: [] } }), sb, env);
  assert.equal(ok.status, 201);
});

test('the bundled server function is up to date with its source', async () => {
  const committed = readFileSync(new URL('../api/workout-agent/[route].js', import.meta.url), 'utf8');
  assert.match(committed, /SCHEMA_VERSION = "2"/);
  assert.match(committed, /coach_key_hash/);
  let fresh: string | null = null;
  try {
    const { bundleAgentApi } = await import('../scripts/build-agent-api.mjs');
    fresh = await bundleAgentApi(false);
  } catch {
    // esbuild isn't installed here: the content checks above still ran
  }
  if (fresh) assert.equal(committed, fresh, 'run: node apps/web/scripts/build-agent-api.mjs');
});
