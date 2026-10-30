import type { ISODate } from '@six/core';
import type { AppData } from './model.ts';
import { buildSnapshot, renderReport, type HistoryInput, type Snapshot } from '../../../../supabase/functions/_shared/workout_history.ts';

export { renderReport, type Snapshot } from '../../../../supabase/functions/_shared/workout_history.ts';
export type { Decision, DecisionChange } from '../../../../supabase/functions/_shared/workout_history.ts';

/**
 * The workout history from the data already in the app: the same builder the workout-agent Edge
 * Function uses, so the report you generate here is the one the coach reads.
 */
export function historyInput(data: AppData): HistoryInput {
  return {
    profile: { units: data.profile.units, timezone: data.profile.timezone, coach_share_bodyweight: data.profile.coach_share_bodyweight ?? true },
    actions: data.actions.map((a) => ({ id: a.id, title: a.title, kind: a.kind, planned_minutes: a.planned_minutes, archived_at: a.archived_at, workout_plan: a.workout_plan ?? null, details: a.details ?? '' })),
    schedules: data.schedules,
    sessions: data.sessions,
    sets: data.workoutSets,
    planVersions: data.planVersions ?? [],
    measurementTypes: data.measurementTypes,
    measurements: data.measurements,
    reports: (data.workoutReports ?? []).map((r) => ({ id: r.id, as_of: r.as_of, created_at: r.created_at, recommendation: r.recommendation, change_level: r.change_level, decision: r.decision, user_status: r.user_status, user_note: r.user_note })),
  };
}

export function workoutSnapshot(data: AppData, asOf: ISODate, months = 6): Snapshot {
  return buildSnapshot(historyInput(data), { asOf, months });
}

export function workoutReportMarkdown(data: AppData, asOf: ISODate, months = 6): { snapshot: Snapshot; markdown: string } {
  const snapshot = workoutSnapshot(data, asOf, months);
  return { snapshot, markdown: renderReport(snapshot) };
}
