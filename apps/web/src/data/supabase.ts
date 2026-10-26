import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Db } from './db.ts';
import { SaveError } from './db.ts';
import { COLLECTIONS, TABLES, defaultProfile, emptyData, normalizeData, type AppData, type Op } from './model.ts';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Every migration after the initial schema, with the table it creates or the newest column it adds.
 * The app checks these once when it loads and names the first missing one in a banner; a save that
 * fails on one of these columns or tables names the same file.
 */
const MIGRATIONS: { file: string; table: string; columns: string[]; creates?: boolean }[] = [
  { file: '20261019000000_goal_breakdown.sql', table: 'plan_steps', columns: [], creates: true },
  { file: '20261021000000_reminders_and_cues.sql', table: 'actions', columns: ['cue'] },
  { file: '20261025000000_review_overhaul.sql', table: 'reviews', columns: ['commitment_kept', 'goal_results', 'goal_decisions', 'carry_forward', 'minutes_planned', 'minutes_done'] },
  { file: '20261026000000_goal_backlog.sql', table: 'goal_ideas', columns: [], creates: true },
  { file: '20261027000000_completed_goals_and_readiness.sql', table: 'goals', columns: ['completed_at', 'completion_note'] },
  { file: '20261028000000_idea_prep.sql', table: 'goal_ideas', columns: ['prep'] },
  { file: '20261029000000_batches_and_own_clocks.sql', table: 'plans', columns: ['solo'] },
  { file: '20261030000000_attachments.sql', table: 'attachments', columns: [], creates: true },
  { file: '20261031000000_connected_goals.sql', table: 'actions', columns: ['measurement_type_id'] },
  { file: '20261101000000_goal_groups.sql', table: 'goal_groups', columns: [], creates: true },
  { file: '20261102000000_task_details.sql', table: 'actions', columns: ['details'] },
  { file: '20261103000000_measure_on_today.sql', table: 'measurement_types', columns: ['on_today'] },
  { file: '20261104000000_workout_plans.sql', table: 'actions', columns: ['workout_plan'] },
  { file: '20261105000000_group_outcomes.sql', table: 'goals', columns: ['after_goal_id'] },
  { file: '20261106000000_goal_start_dates.sql', table: 'goals', columns: ['start_date'] },
  { file: '20261107000000_review_fixes.sql', table: 'goals', columns: ['reflection'] },
];

/** Tables that exist only once their migration has run. */
const CREATED_TABLES = new Map(MIGRATIONS.filter((m) => m.creates).map((m) => [m.table, m]));

function looksMissing(message: string): boolean {
  return /does not exist|could not find|schema cache|relation .* does not exist/i.test(message);
}

/** The migration a "missing column or table" error points at, if it does. */
function migrationFor(message: string, table?: string): (typeof MIGRATIONS)[number] | null {
  if (!looksMissing(message)) return null;
  for (const m of MIGRATIONS) {
    if (m.creates && (m.table === table || new RegExp(`\\b${m.table}\\b`).test(message))) return m;
    if (m.columns.some((c) => message.includes(c))) return m;
  }
  // Measure and photo tasks need the connected-goals migration (it widens the allowed task kinds).
  if (/actions_kind_check/.test(message)) return MIGRATIONS.find((m) => m.file.includes('connected_goals')) ?? null;
  return null;
}

function runText(m: { file: string }): string {
  return `In Supabase → SQL Editor, run supabase/migrations/${m.file}, then reload.`;
}

/** Set when the database is missing a newer migration; the app shows it as a banner. */
export let schemaWarning: string | null = null;

let client: SupabaseClient | null = null;

/** The shared Supabase client (null when not configured). */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

/** Fetch every row of a table, 1,000 at a time. */
async function selectAll(sb: SupabaseClient, table: string): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb.from(table).select('*').range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

/** Postgres numeric columns can arrive as strings; turn them into numbers. */
function numeric(rows: Record<string, unknown>[], fields: string[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out = { ...r };
    for (const f of fields) {
      if (out[f] != null) out[f] = Number(out[f]);
    }
    return out;
  });
}

const NUMERIC_FIELDS: Record<string, string[]> = {
  goals: ['baseline_value', 'target_value'],
  goal_targets: ['target_value'],
  plan_steps: ['target_value'],
  measurements: ['value'],
  workout_sets: ['weight'],
  reviews: ['actions_done', 'minutes_planned', 'minutes_done'],
  goal_ideas: ['rank'],
};

/** A network failure is worth retrying; a database refusal is not. */
function toSaveError(error: { message: string; code?: string } | null): SaveError | null {
  if (!error) return null;
  const m = migrationFor(error.message);
  if (m) return new SaveError(`${error.message}. ${runText(m)}`, false);
  const retryable = !error.code || /fetch|network|timeout/i.test(error.message);
  return new SaveError(error.message, retryable);
}

const BUCKET = 'attachments';

/** Storage keys allow a limited character set; keep the name readable but safe. */
function safeName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'file';
}

export function createSupabaseDb(sb: SupabaseClient, userId: string): Db {
  const urlCache = new Map<string, { url: string; until: number }>();
  return {
    mode: 'supabase',
    userId,
    schemaWarning: () => schemaWarning,

    files: {
      async upload(id, name, file) {
        // The first folder must be the user's id: the storage policies check it.
        const path = `${userId}/${id}/${safeName(name)}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (error) throw new Error(error.message);
        return path;
      },
      async url(path) {
        const hit = urlCache.get(path);
        if (hit && hit.until > Date.now()) return hit.url;
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
        if (error || !data) throw new Error(error?.message ?? 'No link for this file');
        urlCache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 });
        return data.signedUrl;
      },
      async remove(paths) {
        if (paths.length === 0) return;
        const { error } = await sb.storage.from(BUCKET).remove(paths);
        if (error) throw new Error(error.message);
        for (const p of paths) urlCache.delete(p);
      },
    },

    async loadAll(): Promise<AppData> {
      const data = emptyData();
      schemaWarning = null;
      const results = await Promise.all(
        COLLECTIONS.map((key) =>
          selectAll(sb, TABLES[key]).catch((e: Error) => {
            // A table a newer migration creates: the app still loads, that part just can't save yet.
            const m = CREATED_TABLES.get(TABLES[key]);
            if (m && looksMissing(e.message)) {
              schemaWarning ??= `Your database needs an update. ${runText(m)}`;
              return [];
            }
            throw e;
          }),
        ),
      );
      COLLECTIONS.forEach((key, i) => {
        const table = TABLES[key];
        const rows = numeric(results[i] ?? [], NUMERIC_FIELDS[table] ?? []);
        (data as unknown as Record<string, unknown>)[key] = rows;
      });
      // Columns added by later migrations: one small select per table, all at once. The first
      // migration found missing is the one to run (they're meant to be run in order).
      if (!schemaWarning) {
        const byTable = new Map<string, string[]>();
        for (const m of MIGRATIONS) if (m.columns.length) byTable.set(m.table, [...(byTable.get(m.table) ?? []), ...m.columns]);
        const probes = await Promise.all([...byTable].map(async ([table, cols]) => (await sb.from(table).select(cols.join(',')).limit(1)).error?.message ?? null));
        const missing = probes.map((msg) => (msg ? migrationFor(msg) : null)).filter((m): m is (typeof MIGRATIONS)[number] => !!m);
        const first = MIGRATIONS.find((m) => missing.includes(m));
        if (first) schemaWarning = `Your database needs an update. ${runText(first)}`;
      }
      const { data: profile, error } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`profiles: ${error.message}`);
      if (profile) {
        data.profile = { ...defaultProfile(), ...profile };
      } else {
        const fresh = defaultProfile();
        const { error: insertError } = await sb.from('profiles').insert({ ...fresh, user_id: userId });
        if (insertError) throw new Error(`profiles: ${insertError.message}`);
        data.profile = fresh;
      }
      return normalizeData(data);
    },

    async apply(op: Op): Promise<void> {
      let error: { message: string; code?: string } | null = null;
      switch (op.kind) {
        case 'insert':
          ({ error } = await sb.from(TABLES[op.collection]).insert(op.rows));
          break;
        case 'insertIgnore':
          ({ error } = await sb.from('sessions').upsert(op.rows, {
            onConflict: 'user_id,action_id,week_start,origin,slot',
            ignoreDuplicates: true,
          }));
          break;
        case 'update':
          ({ error } = await sb.from(TABLES[op.collection]).update(op.patch).eq('id', op.id));
          break;
        case 'delete':
          ({ error } = await sb.from(TABLES[op.collection]).delete().eq('id', op.id));
          break;
        case 'profile':
          ({ error } = await sb.from('profiles').upsert({ ...op.patch, user_id: userId }));
          break;
        case 'review':
          ({ error } = await sb.rpc('complete_weekly_review', { payload: op.payload }));
          break;
      }
      const saveError = toSaveError(error);
      if (saveError) throw saveError;
    },

    async importAll(incoming: AppData): Promise<void> {
      await this.wipeAll();
      const strip = (rows: unknown[]) => (rows as Record<string, unknown>[]).map(({ user_id: _u, ...r }) => r);
      const insert = async (table: string, rows: unknown[]) => {
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await sb.from(table).insert(strip(rows.slice(i, i + 500)));
          if (error) throw new Error(`${table}: ${error.message}`);
        }
      };
      const { error: pe } = await sb.from('profiles').upsert({ ...defaultProfile(), ...incoming.profile, user_id: userId });
      if (pe) throw new Error(`profiles: ${pe.message}`);
      await insert('plans', incoming.plans ?? []);
      await insert('goal_groups', incoming.groups ?? []);
      // Goals and their measurements point at each other: goals first without it, then the link.
      await insert('goals', (incoming.goals ?? []).map((g) => ({ ...g, measurement_type_id: null, ...(g.after_goal_id ? { after_goal_id: null } : {}) })));
      // "Starts after" points at another goal: linked once every goal exists.
      for (const g of incoming.goals ?? []) {
        if (!g.after_goal_id) continue;
        const { error } = await sb.from('goals').update({ after_goal_id: g.after_goal_id }).eq('id', g.id);
        if (error) throw new Error(`goals: ${error.message}`);
      }
      await insert('measurement_types', incoming.measurementTypes ?? []);
      for (const g of incoming.goals ?? []) {
        if (!g.measurement_type_id) continue;
        const { error } = await sb.from('goals').update({ measurement_type_id: g.measurement_type_id }).eq('id', g.id);
        if (error) throw new Error(`goals: ${error.message}`);
      }
      const rest: [string, unknown[] | undefined][] = [
        ['plan_goals', incoming.planGoals], ['goal_targets', incoming.goalTargets], ['plan_steps', incoming.planSteps], ['milestones', incoming.milestones],
        ['actions', incoming.actions], ['action_goals', incoming.actionGoals], ['action_schedules', incoming.schedules], ['sessions', incoming.sessions],
        ['workout_sets', incoming.workoutSets], ['measurements', incoming.measurements], ['week_plans', incoming.weekPlans], ['reviews', incoming.reviews],
        ['change_log', incoming.changeLog], ['goal_ideas', incoming.ideas],
      ];
      for (const [table, rows] of rest) if (rows?.length) await insert(table, rows);
    },

    async wipeAll(): Promise<void> {
      // The files themselves first: deleting the rows doesn't remove them from storage.
      const { data: files } = await sb.from('attachments').select('path').eq('user_id', userId);
      const paths = ((files ?? []) as { path: string }[]).map((f) => f.path);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      // Children first so nothing is left pointing at a deleted row (the foreign keys cascade anyway).
      const order = [
        'attachments', 'goal_ideas', 'change_log', 'reviews', 'week_plans', 'measurements', 'workout_sets', 'sessions',
        'action_goals', 'action_schedules', 'actions', 'milestones', 'goal_targets',
        'plan_steps', 'plan_goals', 'goals', 'goal_groups', 'plans', 'measurement_types',
      ];
      for (const table of order) {
        const { error } = await sb.from(table).delete().eq('user_id', userId);
        // An older database without the breakdown table has nothing to delete there.
        if (error && !(CREATED_TABLES.has(table) && looksMissing(error.message))) throw new Error(`${table}: ${error.message}`);
      }
    },
  };
}
