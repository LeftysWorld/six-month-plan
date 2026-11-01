/**
 * Weight goals: the numbers behind the weight page. Your weigh-in is the headline and is what's
 * judged against the path; the rolling average and the 4-week rate sit beside it. Being within a
 * small band of the path counts as on track, so a salty morning never reads as failing.
 */
import { addDays, daysBetween, isoWeekday, type ISODate } from './dates.ts';
import { valueOnPath, type PathPoint } from './plan.ts';
import type { ActionKind, Measurement, MeasurementType } from './types.ts';

/** Task kinds whose check-off records a number: a general "log a number" task and a weigh-in. */
export const logsReading = (kind: ActionKind | null | undefined): boolean => kind === 'measure' || kind === 'weight';

/** A measurement that is body weight: named Weight (or Body weight), or anything with "weight" in lb or kg. */
export function isWeightType(t: Pick<MeasurementType, 'name' | 'unit'>): boolean {
  return /^(body\s*)?weight$/i.test(t.name.trim()) || (/weight/i.test(t.name) && /^(lb|lbs|kg)$/i.test(t.unit.trim()));
}

/** Half-width of the on-track zone around the path: 1.5 lb, or 0.7 kg. */
export const onTrackBand = (unit: string): number => (/kg/i.test(unit) ? 0.7 : 1.5);

const sorted = (readings: Measurement[]) => [...readings].sort((a, b) => (a.measured_on < b.measured_on ? -1 : a.measured_on > b.measured_on ? 1 : 0));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The average of the readings in the `days` days up to and including `date`; null without one. */
export function rollingAverage(readings: Measurement[], date: ISODate, days = 7): number | null {
  const from = addDays(date, -(days - 1));
  const inWindow = readings.filter((m) => m.measured_on >= from && m.measured_on <= date);
  if (!inWindow.length) return null;
  return r1(inWindow.reduce((s, m) => s + Number(m.value), 0) / inWindow.length);
}

export type WeighInZone = 'ahead' | 'on_track' | 'over';

export interface WeighInStatus {
  /** Positive = ahead of the path (in the goal's direction), in the goal's units. */
  aheadBy: number;
  zone: WeighInZone;
  /** "1.1 lb ahead of the path", "On track · 0.3 over the path", "2.1 lb over the path today". */
  text: string;
}

/**
 * A weigh-in against the path. Ahead when it's past the path in the goal's direction; on track
 * within the band on the wrong side; over beyond it.
 */
export function weighInStatus(weight: number, pathValue: number, direction: number, unit: string): WeighInStatus {
  const aheadBy = r1((pathValue - weight) * (direction < 0 ? 1 : -1));
  const band = onTrackBand(unit);
  const u = unit ? ` ${unit}` : '';
  const word = direction < 0 ? 'over' : 'under';
  if (aheadBy >= 0.05) return { aheadBy, zone: 'ahead', text: `${aheadBy.toFixed(1)}${u} ahead of the path` };
  if (-aheadBy <= band) return { aheadBy, zone: 'on_track', text: aheadBy > -0.05 ? 'On the path' : `On track · ${(-aheadBy).toFixed(1)} ${word} the path` };
  return { aheadBy, zone: 'over', text: `${(-aheadBy).toFixed(1)}${u} ${word} the path today` };
}

export interface WeightWeek {
  /** Monday of the week. */
  start: ISODate;
  end: ISODate;
  /** The week's last weigh-in, and its day. */
  last: number | null;
  lastOn: ISODate | null;
  average: number | null;
  count: number;
  /** Where the path is on the week's last day. */
  pathEnd: number;
  /** The last weigh-in against the path at its day (positive = ahead); null without one. */
  aheadBy: number | null;
  /** Change from the previous week's last weigh-in (or the goal's start for the first week). */
  change: number | null;
}

/** Each week (Monday to Sunday) from the goal's start through `untilWeekOf`, oldest first. */
export function weightWeeks(start: PathPoint, path: PathPoint[], readings: Measurement[], today: ISODate, untilWeekOf: ISODate, direction: number): WeightWeek[] {
  const all = sorted(readings).filter((m) => m.measured_on >= start.date);
  const monday = (d: ISODate) => addDays(d, 1 - isoWeekday(d));
  const out: WeightWeek[] = [];
  let prevLast: number | null = start.value;
  for (let wk = monday(start.date); wk <= monday(untilWeekOf); wk = addDays(wk, 7)) {
    const end = addDays(wk, 6);
    const inWeek = all.filter((m) => m.measured_on >= wk && m.measured_on <= end && m.measured_on <= today);
    const lastR = inWeek.at(-1) ?? null;
    const last = lastR ? Number(lastR.value) : null;
    const pathEnd = r1(valueOnPath(start, path, end));
    out.push({
      start: wk,
      end,
      last,
      lastOn: lastR?.measured_on ?? null,
      average: inWeek.length ? r1(inWeek.reduce((s, m) => s + Number(m.value), 0) / inWeek.length) : null,
      count: inWeek.length,
      pathEnd,
      aheadBy: lastR ? r1((valueOnPath(start, path, lastR.measured_on) - Number(lastR.value)) * (direction < 0 ? 1 : -1)) : null,
      change: last != null && prevLast != null ? r1(last - prevLast) : null,
    });
    if (last != null) prevLast = last;
  }
  return out;
}

export interface WeightMilestone {
  value: number;
  /** First morning at or past it, if reached. */
  reachedOn: ISODate | null;
  /** When it lands at the given rate from the latest weigh-in; null without a rate going the right way. */
  atPace: ISODate | null;
  /** First day the path is at or past it. */
  onPath: ISODate | null;
  /** Still to go from the latest weigh-in (0 once reached). */
  toGo: number;
}

/**
 * Round-number stops between where you started and the target (every 10 lb or 5 kg), plus the
 * target itself, each with the day you reached it, or when it lands at your pace and on the path.
 */
export function weightMilestones(start: PathPoint, path: PathPoint[], target: number, readings: Measurement[], latest: Measurement | null, perDay: number | null, unit: string): WeightMilestone[] {
  const step = /kg/i.test(unit) ? 5 : 10;
  const down = target < start.value;
  // Pounds stop on the 5s (185, 175 …); kilograms on multiples of 5 (85, 80 …).
  const off = step === 10 ? 5 : 0;
  const values: number[] = [];
  if (down) for (let v = Math.floor((start.value - off) / step) * step + off; v > target; v -= step) values.push(v);
  else for (let v = Math.ceil((start.value - off) / step) * step + off; v < target; v += step) values.push(v);
  const stops = [...values.filter((v) => (down ? v < start.value : v > start.value)), target];
  const past = (v: number, x: number) => (down ? x <= v : x >= v);
  const all = sorted(readings);
  const lastPathDay = path.length ? path[path.length - 1]!.date : start.date;
  return stops.map((value) => {
    const reached = all.find((m) => m.measured_on >= start.date && past(value, Number(m.value)));
    let atPace: ISODate | null = null;
    if (latest && perDay && perDay !== 0 && Math.sign(perDay) === (down ? -1 : 1)) {
      const days = Math.ceil((value - Number(latest.value)) / perDay);
      atPace = days <= 0 ? latest.measured_on : addDays(latest.measured_on, days);
    }
    let onPath: ISODate | null = null;
    const span = daysBetween(start.date, lastPathDay);
    for (let i = 0; i <= span; i++) {
      const d = addDays(start.date, i);
      if (past(value, valueOnPath(start, path, d) + (down ? -1e-9 : 1e-9))) {
        onPath = d;
        break;
      }
    }
    const toGo = latest ? Math.max(0, r1((Number(latest.value) - value) * (down ? 1 : -1))) : 0;
    return { value, reachedOn: reached?.measured_on ?? null, atPace: reached ? null : atPace, onPath, toGo: reached ? 0 : toGo };
  });
}

/** The steady range for a week's change: 0.5–1% of current weight, in its units (1–1.9 lb at 190 lb). */
export function steadyRange(weight: number): { low: number; high: number } {
  return { low: r1(weight * 0.005), high: r1(weight * 0.01) };
}

/** The day `remaining` is covered at `perWeek` from `from` (the date at which a pace would finish). */
export function etaAt(from: ISODate, remaining: number, perWeek: number): ISODate | null {
  if (!(perWeek > 0)) return null;
  return addDays(from, Math.ceil((Math.abs(remaining) / perWeek) * 7));
}
