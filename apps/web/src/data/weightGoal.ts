import { isWeightType, valueOnPath, weighInStatus, type Goal, type Measurement, type PathPoint } from '@six/core';
import type { AppData } from './model.ts';

/**
 * A weight goal: a number goal with a weigh-in task (the Weight task type), or one that tracks a
 * weight measurement. These get the weight page and are judged by the weigh-in, not the average.
 */
export function isWeightGoal(data: AppData, goal: Goal): boolean {
  if (goal.type !== 'number') return false;
  const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
  if (data.actions.some((a) => !a.archived_at && a.kind === 'weight' && actionIds.has(a.id))) return true;
  const type = data.measurementTypes.find((t) => t.id === goal.measurement_type_id);
  return !!type && isWeightType(type);
}

/** The latest weigh-in on or before today against the path on its day. */
export function weighInNow(goal: Goal, start: PathPoint, path: PathPoint[], readings: Measurement[], today: string) {
  const latest = readings.filter((r) => r.measured_on <= today).at(-1) ?? null;
  if (!latest || goal.target_value == null) return null;
  const direction = Math.sign(goal.target_value - start.value) || -1;
  const pathValue = valueOnPath(start, path, latest.measured_on);
  return { latest, pathValue, direction, status: weighInStatus(Number(latest.value), pathValue, direction, goal.unit ?? '') };
}
