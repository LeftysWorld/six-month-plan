import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Db } from './db.ts';
import { SaveError } from './db.ts';
import { COLLECTIONS, TABLES, defaultProfile, emptyData, normalizeData, type AppData, type Op } from './model.ts';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

const BREAKDOWN_MIGRATION = 'supabase/migrations/20261019000000_goal_breakdown.sql, 20261021000000_reminders_and_cues.sql, 20261025000000_review_overhaul.sql, 20261026000000_goal_backlog.sql, 20261027000000_completed_goals_and_readiness.sql, 20261028000000_idea_prep.sql, 20261029000000_batches_and_own_clocks.sql and 20261030000000_attachments.sql';
const BACKLOG_MIGRATION = 'supabase/migrations/20261026000000_goal_backlog.sql';

/** Set when the database is missing a newer migration; the app shows it as a banner. */
export let schemaWarning: string | null = null;

function isMissingBreakdown(message: string): boolean {
  return /plan_steps|step_id|'cue'|\bcue\b|reminder_time|evening_reminder|calendar_token|push_subscriptions|commitment_kept|goal_results|goal_decisions|carry_forward|minutes_planned|minutes_done|goal_ideas|completion_note|done_means|goals\.completed_at|\bprep\b|\bsolo\b|attachments/i.test(message) && /does not exist|could not find|schema cache/i.test(message);
}

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
  if (isMissingBreakdown(error.message)) {
    return new SaveError(`${error.message}. Run ${BREAKDOWN_MIGRATION} in the Supabase SQL Editor, then reload.`, false);
  }
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
            // A database set up before the goal breakdown existed: keep the app usable and say what to run.
            if (key === 'planSteps' && isMissingBreakdown(e.message)) {
              schemaWarning = `Your database needs the goal breakdown update. In Supabase → SQL Editor, run ${BREAKDOWN_MIGRATION}, then reload.`;
              return [];
            }
            // A database without the backlog table still loads; the backlog just can't save yet.
            // A database without the attachments table still loads; files just can't be added yet.
            if (key === 'attachments' && isMissingBreakdown(e.message)) {
              schemaWarning ??= `Your database needs the attachments update. In Supabase → SQL Editor, run supabase/migrations/20261030000000_attachments.sql, then reload.`;
              return [];
            }
            if (key === 'ideas' && isMissingBreakdown(e.message)) {
              schemaWarning ??= `Your database needs the goal backlog update. In Supabase → SQL Editor, run ${BACKLOG_MIGRATION}, then reload.`;
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
      // A database without the review overhaul still loads; reviews just won't keep the new answers.
      if (!schemaWarning) {
        const probe = await sb.from('reviews').select('goal_results').limit(1);
        if (probe.error && isMissingBreakdown(probe.error.message)) {
          schemaWarning = `Your database needs the review update. In Supabase → SQL Editor, run supabase/migrations/20261025000000_review_overhaul.sql, then reload.`;
        }
      }
      // Completed goals and the backlog's "done looks like" need the newest migration.
      if (!schemaWarning) {
        const probe = await sb.from('goals').select('completed_at').limit(1);
        if (probe.error && isMissingBreakdown(probe.error.message)) {
          schemaWarning = `Your database needs the completed-goals update. In Supabase → SQL Editor, run supabase/migrations/20261027000000_completed_goals_and_readiness.sql, then reload.`;
        }
      }
      if (!schemaWarning) {
        const probe = await sb.from('goal_ideas').select('prep').limit(1);
        if (probe.error && isMissingBreakdown(probe.error.message)) {
          schemaWarning = `Your database needs the prepare-and-commit update. In Supabase → SQL Editor, run supabase/migrations/20261028000000_idea_prep.sql, then reload.`;
        }
      }
      if (!schemaWarning) {
        const probe = await sb.from('plans').select('solo').limit(1);
        if (probe.error && isMissingBreakdown(probe.error.message)) {
          schemaWarning = `Your database needs the batches update. In Supabase → SQL Editor, run supabase/migrations/20261029000000_batches_and_own_clocks.sql, then reload.`;
        }
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

    async wipeAll(): Promise<void> {
      // The files themselves first: deleting the rows doesn't remove them from storage.
      const { data: files } = await sb.from('attachments').select('path').eq('user_id', userId);
      const paths = ((files ?? []) as { path: string }[]).map((f) => f.path);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      // Children first so nothing is left pointing at a deleted row (the foreign keys cascade anyway).
      const order = [
        'attachments', 'goal_ideas', 'change_log', 'reviews', 'week_plans', 'measurements', 'workout_sets', 'sessions',
        'action_goals', 'action_schedules', 'actions', 'milestones', 'goal_targets',
        'plan_steps', 'plan_goals', 'goals', 'plans', 'measurement_types',
      ];
      for (const table of order) {
        const { error } = await sb.from(table).delete().eq('user_id', userId);
        // An older database without the breakdown table has nothing to delete there.
        if (error && !((table === 'plan_steps' || table === 'goal_ideas' || table === 'attachments') && isMissingBreakdown(error.message))) throw new Error(`${table}: ${error.message}`);
      }
    },
  };
}
