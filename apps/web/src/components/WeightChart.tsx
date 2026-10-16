import {
  addDays,
  daysBetween,
  monthName,
  parseISO,
  shortDate,
  valueOnPath,
  type DateRange,
  type ISODate,
  type Measurement,
  type PathPoint,
} from '@six/core';
import { fmt } from '../data/derive.ts';

interface Props {
  start: PathPoint;
  path: PathPoint[];
  readings: Measurement[];
  range: DateRange;
  today: ISODate;
  unit: string;
  color?: string;
  /** Extra labelled points, e.g. the 3-month checkpoint and the goal. */
  markers?: { date: ISODate; label: string }[];
}

const W = 340;
const H = 178;
const LEFT = 30;
const RIGHT = 330;
const TOP = 16;
const BOTTOM = 146;

/** The weight path: dashed plan line, daily readings, 7-day trend and a "today" marker. */
export function WeightChart({ start, path, readings, range, today, unit, color = '#2B63A6', markers = [] }: Props) {
  const span = Math.max(1, daysBetween(range.start, range.end));
  const x = (d: ISODate) => LEFT + ((RIGHT - LEFT) * daysBetween(range.start, d)) / span;

  const visible = readings.filter((r) => r.measured_on >= range.start && r.measured_on <= range.end);
  const planAt = (d: ISODate) => valueOnPath(start, path, d);
  const planValues = [planAt(range.start), planAt(range.end), ...path.filter((p) => p.date >= range.start && p.date <= range.end).map((p) => p.value)];
  const values = [...planValues, ...visible.map((r) => Number(r.value))];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max(0.5, (hi - lo) * 0.12);
  lo -= pad;
  hi += pad;
  const y = (v: number) => TOP + ((BOTTOM - TOP) * (hi - v)) / (hi - lo || 1);

  // Plan line: sample at every path point inside the range plus the range ends.
  const planDates = [range.start, ...path.map((p) => p.date).filter((d) => d > range.start && d < range.end), range.end];
  const planLine = planDates.map((d) => `${x(d).toFixed(1)},${y(planAt(d)).toFixed(1)}`).join(' ');

  // 7-day trend through each reading date.
  const trend = visible.map((r) => {
    const from = addDays(r.measured_on, -6);
    const window = readings.filter((m) => m.measured_on >= from && m.measured_on <= r.measured_on);
    const avg = window.reduce((s, m) => s + Number(m.value), 0) / window.length;
    return { date: r.measured_on, value: avg };
  });
  const trendLine = trend.map((t) => `${x(t.date).toFixed(1)},${y(t.value).toFixed(1)}`).join(' ');
  const latest = visible[visible.length - 1];

  // Gridlines: three evenly spaced values.
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];

  // Month labels inside the range.
  const months: { date: ISODate; label: string }[] = [];
  const startMs = parseISO(range.start);
  const first = new Date(startMs);
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    const iso = d.toISOString().slice(0, 10);
    if (iso < range.start) continue;
    if (iso > range.end) break;
    months.push({ date: iso, label: monthName(d.getUTCMonth()) });
  }
  if (months.length < 2) {
    months.splice(0, months.length, { date: range.start, label: shortDate(range.start) }, { date: range.end, label: shortDate(range.end) });
  }

  const todayInRange = today >= range.start && today <= range.end;
  const description = `${unit} over ${shortDate(range.start)} to ${shortDate(range.end)}. Plan ${fmt(planAt(range.start))} to ${fmt(planAt(range.end))}.${
    latest ? ` Latest reading ${fmt(Number(latest.value))} on ${shortDate(latest.measured_on)}.` : ' No readings yet.'
  }`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description} style={{ display: 'block', maxWidth: 520, margin: '0 auto' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={LEFT} x2={RIGHT} y1={y(t)} y2={y(t)} stroke={i === 2 ? '#E2E5DF' : '#EEF0EC'} />
          <text x={0} y={y(t) + 3} fontSize="10" fill="#55605A">
            {fmt(t, 0)}
          </text>
        </g>
      ))}
      <polyline points={planLine} fill="none" stroke={color} strokeWidth="2" strokeDasharray="5 4" opacity="0.6" />
      {markers
        .filter((m) => m.date >= range.start && m.date <= range.end)
        .map((m) => (
          <g key={m.date}>
            <circle cx={x(m.date)} cy={y(planAt(m.date))} r="5" fill="#fff" stroke={color} strokeWidth="2" />
            <text
              x={x(m.date) > RIGHT - 70 ? x(m.date) - 6 : x(m.date) + 7}
              y={y(planAt(m.date)) - 7}
              fontSize="10"
              fontWeight="600"
              fill="#244F86"
              textAnchor={x(m.date) > RIGHT - 70 ? 'end' : 'start'}
            >
              {m.label}
            </text>
          </g>
        ))}
      <g fill={color} opacity="0.35">
        {visible.map((r) => (
          <circle key={r.id} cx={x(r.measured_on)} cy={y(Number(r.value))} r="1.8" />
        ))}
      </g>
      {trend.length > 1 && (
        <polyline points={trendLine} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {todayInRange && (
        <>
          <line x1={x(today)} x2={x(today)} y1={6} y2={BOTTOM + 4} stroke="#17201C" strokeDasharray="2 3" />
          <text x={x(today) + (x(today) > RIGHT - 40 ? -4 : 4)} y={11} fontSize="10" fontWeight="600" fill="#17201C" textAnchor={x(today) > RIGHT - 40 ? 'end' : 'start'}>
            Today
          </text>
        </>
      )}
      {latest && <circle cx={x(latest.measured_on)} cy={y(Number(latest.value))} r="5" fill={color} stroke="#fff" strokeWidth="2" />}
      {months.map((m) => (
        <text key={m.date} x={Math.min(x(m.date), RIGHT - 14)} y={H - 6} fontSize="10" fill="#55605A" textAnchor="middle">
          {m.label}
        </text>
      ))}
    </svg>
  );
}
