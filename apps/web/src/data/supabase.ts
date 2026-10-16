import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Db } from './db.ts';
import { SaveError } from './db.ts';
import { COLLECTIONS, TABLES, defaultProfile, emptyData, type AppData, type Op } from './model.ts';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

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
  measurements: ['value'],
  workout_sets: ['weight'],
  reviews: ['actions_done'],
};

/** A network failure is worth retrying; a database refusal is not. */
function toSaveError(error: { message: string; code?: string } | null): SaveError | null {
  if (!error) return null;
  const retryable = !error.code || /fetch|network|timeout/i.test(error.message);
  return new SaveError(error.message, retryable);
}

export function createSupabaseDb(sb: SupabaseClient, userId: string): Db {
  return {
    mode: 'supabase',

    async loadAll(): Promise<AppData> {
      const data = emptyData();
      const results = await Promise.all(COLLECTIONS.map((key) => selectAll(sb, TABLES[key])));
      COLLECTIONS.forEach((key, i) => {
        const table = TABLES[key];
        const rows = numeric(results[i] ?? [], NUMERIC_FIELDS[table] ?? []);
        (data as unknown as Record<string, unknown>)[key] = rows;
      });
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
      return data;
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
  };
}
