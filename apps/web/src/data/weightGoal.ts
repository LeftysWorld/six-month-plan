import { isWeightType, rollingAverage, valueOnPath, weighInStatus, type Goal, type Measurement, type PathPoint } from '@six/core';
import type { AppData } from './model.ts';

/**
 * A weight goal: a number goal with a weigh-in task (the Weight task type), or one that tracks a
 * weight measurement. These get the weight page. Where they stand is judged by the 7-day average
 * (the trend), not one morning's weigh-in, which water alone can move a couple of pounds.
 */
export function isWeightGoal(data: AppData, goal: Goal): boolean {
  if (goal.type !== 'number') return false;
  const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
  if (data.actions.some((a) => !a.archived_at && a.kind === 'weight' && actionIds.has(a.id))) return true;
  const type = data.measurementTypes.find((t) => t.id === goal.measurement_type_id);
  return !!type && isWeightType(type);
}

/**
 * Where a weight goal stands: the 7-day average at the latest weigh-in (on or before today) against
 * the path on that day. `status` is judged on the average; `latest` is the morning's own reading.
 */
export function weighInNow(goal: Goal, start: PathPoint, path: PathPoint[], readings: Measurement[], today: string) {
  const upToToday = readings.filter((r) => r.measured_on <= today);
  const latest = upToToday.at(-1) ?? null;
  if (!latest || goal.target_value == null) return null;
  const direction = Math.sign(goal.target_value - start.value) || -1;
  const pathValue = valueOnPath(start, path, latest.measured_on);
  const trend = rollingAverage(upToToday, latest.measured_on) ?? Number(latest.value);
  return { latest, trend, pathValue, direction, status: weighInStatus(trend, pathValue, direction, goal.unit ?? '') };
}
