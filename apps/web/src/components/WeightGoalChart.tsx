import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { addDays, daysBetween, isoWeekday, shortDate, valueOnPath, type DateRange, type ISODate, type Measurement, type PathPoint } from '@six/core';
import { fmt } from '../data/derive.ts';
import { clampWindow, panWindow, windowLabel, xTicks, zoomWindow } from './chartZoom.ts';

export type WeightRange = 'week' | '2w' | '1m' | '3m' | 'all';

interface Props {
  start: PathPoint;
  path: PathPoint[];
  readings: Measurement[];
  /** The whole span: the goal's start to its target date. */
  range: DateRange;
  today: ISODate;
  unit: string;
  /** Half-width of the on-track zone around the path. */
  band: number;
  /** Change per day at the recent rate (negative when losing); null without one. */
  perDay: number | null;
  /** The path's target, where the projection stops. */
  target: number;
  /** When the projection reaches the target at the slower edge of the range (the path's own pace). */
  slowEta: ISODate | null;
  /** Round-number stops shown on the long views. */
  milestones: { value: number; atPace: ISODate | null }[];
  /** Rolling average per day (the trend line). */
  trendAt: (d: ISODate) => number | null;
  rangeId: WeightRange;
  onRange: (r: WeightRange) => void;
  picked: ISODate | null;
  onPick: (d: ISODate) => void;
}

const QUICK: { id: WeightRange; label: string; days: number | 'week' | 'all' }[] = [
  { id: 'week', label: 'Week', days: 'week' },
  { id: '2w', label: '2W', days: 14 },
  { id: '1m', label: '1M', days: 30 },
  { id: '3m', label: '3M', days: 91 },
  { id: 'all', label: 'All', days: 'all' },
];

/** The window a quick range opens: it starts no earlier than the goal, and runs forward from there. */
export function weightWindow(id: WeightRange, today: ISODate, full: DateRange, firstReading: ISODate | null): DateRange {
  const q = QUICK.find((x) => x.id === id)!;
  if (q.days === 'all') return full;
  if (q.days === 'week') {
    const monday = addDays(today, 1 - isoWeekday(today));
    // The week, trimmed to where your weigh-ins for this goal begin so the line starts at the left.
    const from = [monday, full.start, firstReading ?? monday].reduce((a, b) => (a > b ? a : b));
    return { start: from > today ? monday : from, end: addDays(monday, 6) };
  }
  const want = addDays(today, -(q.days - 1));
  const s = want < full.start ? full.start : want;
  return clampWindow({ start: s, end: addDays(s, q.days - 1) }, { start: full.start, end: full.end > addDays(today, q.days) ? full.end : addDays(today, q.days) });
}

/** A thin outline in the card's colour behind chart labels, so a line passing under them doesn't cut through. */
const halo = { stroke: 'var(--surface)', strokeWidth: 4, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const };

const C = {
  ink: 'var(--ink)',
  muted: 'var(--muted)',
  grid: 'var(--line-2)',
  band: 'rgba(15,143,138,0.13)',
  path: '#0f8f8a',
  trend: 'var(--accent-ink)',
  proj: '#7d6bff',
  cone: 'rgba(125,107,255,0.14)',
  water: 'var(--amber-ink)',
};

/**
 * The weight goal's chart: your weigh-ins joined day to day, the rolling average, the on-track zone
 * around the path, and where you're heading at your recent rate. Week, 2W, 1M, 3M and All start at
 * the goal (the line begins at the left); drag to pan, pinch or Ctrl-scroll to zoom, tap a day.
 */
export function WeightGoalChart(p: Props) {
  const { start, path, readings, range, today, unit, band, perDay, target, rangeId, onRange, picked, onPick } = p;
  const full = useMemo(() => (daysBetween(range.start, range.end) < 1 ? { start: range.start, end: addDays(range.start, 1) } : range), [range.start, range.end]);
  const first = readings.find((r) => r.measured_on >= full.start)?.measured_on ?? null;
  const [win, setWin] = useState<DateRange>(() => weightWindow(rangeId, today, full, first));
  useEffect(() => setWin(weightWindow(rangeId, today, full, first)), [rangeId, full.start, full.end, today, first]);

  // Draw at the size it's shown, so text stays readable on a phone and on a wide screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setW(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 480 ? 236 : 290;
  const LEFT = 38;
  const RIGHT = W - 12;
  const TOP = 22;
  const BOTTOM = H - 30;

  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ pointers: Map<number, number>; startWin: DateRange; startX: number; startSpread: number; moved: boolean } | null>(null);
  const span = Math.max(1, daysBetween(win.start, win.end));
  const x = (d: ISODate) => LEFT + ((RIGHT - LEFT) * daysBetween(win.start, d)) / span;
  const fracAt = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return 0.5;
    const b = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, ((((clientX - b.left) / b.width) * W - LEFT) / (RIGHT - LEFT))));
  };
  const dateAt = (clientX: number): ISODate => addDays(win.start, Math.round(fracAt(clientX) * span));

  const planAt = (d: ISODate) => valueOnPath(start, path, d);
  const visible = readings.filter((r) => r.measured_on >= win.start && r.measured_on <= win.end);
  const latest = readings.filter((r) => r.measured_on <= today).at(-1) ?? null;
  const long = span > 62;

  // Projection from the latest weigh-in at the recent rate, to the window's end or the target.
  const projTo = (() => {
    if (!latest || !perDay || win.end <= latest.measured_on) return null;
    const v0 = Number(latest.value);
    const daysToTarget = Math.ceil((target - v0) / perDay);
    if (!(daysToTarget > 0)) return null;
    const end = addDays(latest.measured_on, Math.min(daysToTarget, daysBetween(latest.measured_on, win.end)));
    return { date: end, value: v0 + perDay * daysBetween(latest.measured_on, end) };
  })();
  const showCone = rangeId === 'all' && latest && p.slowEta && projTo;

  // The scale: zoomed in it fits your weigh-ins and the zone near them; zoomed out, the whole path.
  const readingValues = visible.map((r) => Number(r.value));
  const bandValues = [planAt(win.start), planAt(win.end)].flatMap((v) => [v + band, v - band]);
  let values = long ? [...bandValues, ...readingValues, target] : [...readingValues, ...bandValues.filter((v) => !readingValues.length || (v >= Math.min(...readingValues) - 4 && v <= Math.max(...readingValues) + 4))];
  if (projTo && !long) values.push(projTo.value);
  if (!values.length) values = bandValues;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max(0.6, (hi - lo) * 0.1);
  lo -= pad;
  hi += pad;
  const y = (v: number) => TOP + ((BOTTOM - TOP) * (hi - v)) / (hi - lo || 1);
  const step = hi - lo > 30 ? 10 : hi - lo > 12 ? 4 : hi - lo > 5 ? 2 : 1;
  const grid: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid.push(v);

  const bandFrom = win.start < start.date ? start.date : win.start;
  const bandTo = win.end > full.end ? full.end : win.end;
  const pathDates = [bandFrom, ...path.map((q) => q.date).filter((d) => d > bandFrom && d < bandTo), bandTo];
  const bandPoly = [...pathDates.map((d) => `${x(d).toFixed(1)},${y(planAt(d) + band).toFixed(1)}`), ...[...pathDates].reverse().map((d) => `${x(d).toFixed(1)},${y(planAt(d) - band).toFixed(1)}`)].join(' ');
  const pathLine = pathDates.map((d) => `${x(d).toFixed(1)},${y(planAt(d)).toFixed(1)}`).join(' ');
  const weighLine = visible.map((r) => `${x(r.measured_on).toFixed(1)},${y(Number(r.value)).toFixed(1)}`).join(' ');
  const trendPts = visible.map((r) => ({ d: r.measured_on, v: p.trendAt(r.measured_on) })).filter((t): t is { d: ISODate; v: number } => t.v != null);
  const trendLine = trendPts.map((t) => `${x(t.d).toFixed(1)},${y(t.v).toFixed(1)}`).join(' ');
  const dotR = span <= 16 ? (W < 480 ? 4.5 : 5.5) : span <= 45 ? 3 : 2;
  const todayIn = today >= win.start && today <= win.end;
  const zoomed = rangeId === 'all' ? win.start !== full.start || win.end !== full.end : false;

  // Labels beside today's point flip to the left when today is near the right edge.
  const nearRight = latest ? x(latest.measured_on) > RIGHT - 110 : false;
  const lx = latest ? x(latest.measured_on) + (nearRight ? -12 : 12) : 0;
  const anchor = nearRight ? 'end' : 'start';
  const latestTrend = latest ? p.trendAt(latest.measured_on) : null;
  // The path's value on the latest weigh-in's day, labelled beside the trend so the three numbers read apart.
  const latestPath = latest ? valueOnPath(start, path, latest.measured_on) : null;
  // The biggest overnight jump in view gets a word about water (it isn't fat).
  const jump = (() => {
    if (long) return null;
    let best: { r: Measurement; d: number } | null = null;
    for (let i = 1; i < visible.length; i++) {
      const d = Number(visible[i]!.value) - Number(visible[i - 1]!.value);
      if (daysBetween(visible[i - 1]!.measured_on, visible[i]!.measured_on) === 1 && d * Math.sign(start.value - target) >= 1.2 && (!best || Math.abs(d) > Math.abs(best.d))) best = { r: visible[i]!, d };
    }
    return best;
  })();

  // --- Gestures: drag pans, two fingers zoom, a tap picks a day. ---
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const g = gesture.current ?? { pointers: new Map(), startWin: win, startX: e.clientX, startSpread: 0, moved: false };
    g.pointers.set(e.pointerId, e.clientX);
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()] as [number, number];
      g.startSpread = Math.abs(a - b) || 1;
      g.startX = (a + b) / 2;
    } else g.startX = e.clientX;
    g.startWin = win;
    gesture.current = g;
  };
  const panFull = { start: full.start, end: full.end > addDays(today, 14) ? full.end : addDays(today, 14) };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const el = svgRef.current;
    if (!g || !el || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, e.clientX);
    const b = el.getBoundingClientRect();
    const daysPerPx = daysBetween(g.startWin.start, g.startWin.end) / (b.width * ((RIGHT - LEFT) / W));
    if (g.pointers.size >= 2) {
      const [a, c] = [...g.pointers.values()] as [number, number];
      const factor = (Math.abs(a - c) || 1) / g.startSpread;
      const at = Math.min(1, Math.max(0, (((g.startX - b.left) / b.width) * W - LEFT) / (RIGHT - LEFT)));
      g.moved = true;
      setWin(zoomWindow(g.startWin, factor, at, panFull));
      return;
    }
    const dx = e.clientX - g.startX;
    if (!g.moved && Math.abs(dx) < 6) return;
    g.moved = true;
    setWin(panWindow(g.startWin, Math.round(-dx * daysPerPx), panFull));
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const wasTap = !g.moved && g.pointers.size === 1;
    g.pointers.delete(e.pointerId);
    if (wasTap) {
      const d = dateAt(e.clientX);
      const near = visible.reduce<Measurement | null>((best, r) => (!best || Math.abs(daysBetween(d, r.measured_on)) < Math.abs(daysBetween(d, best.measured_on)) ? r : best), null);
      onPick(near && Math.abs(daysBetween(d, near.measured_on)) <= (span <= 16 ? 0 : 3) ? near.measured_on : d);
    }
    if (g.pointers.size === 0) gesture.current = null;
    else {
      g.startWin = win;
      g.startX = [...g.pointers.values()][0]!;
      g.moved = true;
    }
  };
  const wheel = useRef({ panFull, span });
  wheel.current = { panFull, span };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      const { panFull: f, span: s } = wheel.current;
      const b = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (((e.clientX - b.left) / b.width) * el.viewBox.baseVal.width - LEFT) / (el.viewBox.baseVal.width - LEFT - 12)));
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setWin((w) => zoomWindow(w, Math.exp(-e.deltaY / 200), frac, f));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        setWin((w) => panWindow(w, Math.round((e.deltaX / 40) * Math.max(1, s / 30)), f));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onDoubleClick = (e: MouseEvent<SVGSVGElement>) => setWin((w) => (daysBetween(w.start, w.end) <= 7 ? full : zoomWindow(w, 2, fracAt(e.clientX), panFull)));
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const stepDays = Math.max(1, Math.round(span / 7));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (e.shiftKey) {
        const from = picked ?? today;
        const next = dir < 0 ? [...readings].reverse().find((r) => r.measured_on < from) : readings.find((r) => r.measured_on > from);
        if (next) onPick(next.measured_on);
      } else setWin((w) => panWindow(w, dir * stepDays, panFull));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setWin((w) => zoomWindow(w, 1.5, 0.5, panFull));
    } else if (e.key === '-') {
      e.preventDefault();
      setWin((w) => zoomWindow(w, 1 / 1.5, 0.5, panFull));
    }
  };

  const ticks = xTicks(win);
  const label = rangeId === 'week' ? `This week · ${shortDate(addDays(today, 1 - isoWeekday(today)))} – ${shortDate(addDays(today, 7 - isoWeekday(today)))}` : windowLabel(win);
  const description = `${unit} from ${shortDate(win.start)} to ${shortDate(win.end)}.${latest ? ` Latest weigh-in ${fmt(Number(latest.value))} on ${shortDate(latest.measured_on)}.` : ''} The on-track zone is the path plus or minus ${band} ${unit}. Drag to pan, pinch or Ctrl-scroll to zoom, tap a day.`;
  const ms = long ? p.milestones.filter((m) => m.atPace && m.atPace >= win.start && m.atPace <= win.end && m.value !== target && (!latest || Math.abs(x(m.atPace) - x(latest.measured_on)) > 70)) : [];

  return (
    <div className="stack-sm wgc" ref={box}>
      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="small muted" style={{ minWidth: 0 }}>
          {label}
        </span>
        <div className="seg" role="tablist" aria-label="Range" style={{ padding: 3 }}>
          {QUICK.map((q) => (
            <button key={q.id} role="tab" aria-selected={rangeId === q.id} style={{ minHeight: 32, padding: W < 380 ? '0 9px' : '0 12px', fontSize: 12.5 }} onClick={() => onRange(q.id)}>
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={description}
        tabIndex={0}
        style={{ display: 'block', touchAction: 'pan-y', cursor: 'grab', userSelect: 'none', outline: 'none', borderRadius: 12 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        {grid.map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} style={{ stroke: C.grid }} />
            <text x={LEFT - 8} y={y(v) + 4} fontSize="11" textAnchor="end" style={{ fill: C.muted }}>
              {fmt(v)}
            </text>
          </g>
        ))}
        {long && target >= lo && target <= hi && (
          <g>
            <line x1={LEFT} x2={RIGHT} y1={y(target)} y2={y(target)} style={{ stroke: C.ink }} strokeWidth="1.5" />
            <text x={LEFT - 8} y={y(target) + 4} fontSize="11" fontWeight="700" textAnchor="end" style={{ fill: C.ink }}>
              {fmt(target)}
            </text>
          </g>
        )}
        {bandTo > bandFrom && <polygon points={bandPoly} fill={C.band} />}
        {bandTo > bandFrom && <polyline points={pathLine} fill="none" stroke={C.path} strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />}
        {showCone && latest && (
          <polygon
            points={`${x(latest.measured_on)},${y(Number(latest.value))} ${x(projTo!.date)},${y(target)} ${x(p.slowEta! > win.end ? win.end : p.slowEta!)},${y(target)}`}
            fill={C.cone}
          />
        )}
        {picked && picked >= win.start && picked <= win.end && <line x1={x(picked)} x2={x(picked)} y1={TOP - 8} y2={BOTTOM + 4} stroke="rgba(83,64,224,0.14)" strokeWidth={Math.max(16, Math.min(40, ((RIGHT - LEFT) / span) * 0.6))} strokeLinecap="round" />}
        {todayIn && (
          <>
            <line x1={x(today)} x2={x(today)} y1={TOP - 8} y2={BOTTOM + 4} style={{ stroke: C.ink }} strokeDasharray="3 3" opacity="0.35" />
            <text x={x(today)} y={11} fontSize="11.5" fontWeight="650" textAnchor={x(today) > RIGHT - 20 ? 'end' : 'middle'} style={{ fill: C.ink }}>
              Today
            </text>
          </>
        )}
        {projTo && latest && <line x1={x(latest.measured_on)} y1={y(Number(latest.value))} x2={x(projTo.date)} y2={y(projTo.value)} stroke={C.proj} strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />}
        {trendPts.length > 1 && <polyline points={trendLine} fill="none" style={{ stroke: C.trend }} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
        {visible.length > 1 && <polyline points={weighLine} fill="none" style={{ stroke: C.ink }} strokeWidth={long ? 1.4 : 2} strokeLinejoin="round" strokeLinecap="round" opacity={long ? 0.6 : 1} />}
        {visible.map((r) => (
          <circle key={r.id} cx={x(r.measured_on)} cy={y(Number(r.value))} r={r === latest ? dotR + 1.5 : dotR} style={{ fill: r === latest ? C.ink : 'var(--surface)', stroke: r === latest ? 'var(--surface)' : C.ink }} strokeWidth="2" />
        ))}
        {ms.map((m) => (
          <g key={m.value}>
            <circle cx={x(m.atPace!)} cy={y(m.value)} r="4.5" style={{ fill: 'var(--surface)', stroke: C.trend }} strokeWidth="2" />
            <text x={x(m.atPace!) + 9} y={y(m.value) - 7} fontSize="11.5" style={{ fill: C.trend, ...halo }}>
              {fmt(m.value)} · {shortDate(m.atPace!)}
            </text>
          </g>
        ))}
        {showCone && projTo && (
          <>
            <text x={x(projTo.date)} y={y(target) + 18} fontSize="11.5" fontWeight="650" textAnchor="middle" style={{ fill: C.trend }}>
              {shortDate(projTo.date)}
            </text>
            <text x={RIGHT} y={y(target) + 18} fontSize="11.5" fontWeight="650" textAnchor="end" style={{ fill: C.ink }}>
              {shortDate(full.end)}
            </text>
          </>
        )}
        {jump && (
          <text x={x(jump.r.measured_on)} y={y(Number(jump.r.value)) - 12} fontSize="11.5" fontWeight="600" textAnchor="middle" style={{ fill: C.water, ...halo }}>
            {jump.d > 0 ? '+' : ''}
            {fmt(jump.d)} · water{W >= 480 ? ', not fat' : ''}
          </text>
        )}
        {latest && latest.measured_on >= win.start && latest.measured_on <= win.end && (
          <>
            <text x={lx} y={y(Number(latest.value)) + 4} fontSize="12" fontWeight="650" textAnchor={anchor} style={{ fill: C.ink, ...halo }}>
              {fmt(Number(latest.value))} {latest.measured_on === today ? 'today' : shortDate(latest.measured_on)}
            </text>
            {!long && latestTrend != null && Math.abs(y(latestTrend) - y(Number(latest.value))) > 12 && (
              <text x={lx} y={y(latestTrend) - 10} fontSize="12" fontWeight="650" textAnchor={anchor} style={{ fill: C.trend, ...halo }}>
                {fmt(latestTrend)} trend
              </text>
            )}
            {!long &&
              latestPath != null &&
              latestPath >= lo &&
              latestPath <= hi &&
              Math.abs(y(latestPath) - y(Number(latest.value))) > 14 &&
              (latestTrend == null || Math.abs(y(latestPath) - y(latestTrend)) > 14) && (
                <text x={lx} y={y(latestPath) + (latestTrend != null && y(latestPath) < y(latestTrend) ? -8 : 16)} fontSize="12" fontWeight="650" textAnchor={anchor} style={{ fill: 'var(--blue-ink)', ...halo }}>
                  {fmt(Math.round(latestPath * 10) / 10)} path
                </text>
              )}
          </>
        )}
        {projTo && !long && !showCone && x(projTo.date) - x(latest!.measured_on) > 120 && (
          <text x={x(projTo.date) - 4} y={y(projTo.value) + 18} fontSize="11.5" textAnchor="end" style={{ fill: C.trend }}>
            ~{fmt(projTo.value)} by {shortDate(projTo.date)}
          </text>
        )}
        {ticks.map((t) => (
          <text key={t.date} x={Math.min(Math.max(x(t.date), LEFT + 10), RIGHT - 10)} y={H - 8} fontSize="11" fontWeight={t.date === today ? 650 : t.major ? 600 : 400} textAnchor="middle" style={{ fill: t.date === today || t.major ? C.ink : C.muted }}>
            {rangeId === 'week' ? `${(W < 480 ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])[isoWeekday(t.date) - 1]} ${t.date.slice(8).replace(/^0/, '')}` : t.label}
          </text>
        ))}
      </svg>
      <ul className="wgc-legend" aria-label="Legend">
        <li>
          <svg width="22" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="21" y2="5" style={{ stroke: C.ink }} strokeWidth="2" />
            <circle cx="11" cy="5" r="3.5" style={{ fill: 'var(--surface)', stroke: C.ink }} strokeWidth="2" />
          </svg>
          Your weigh-ins
        </li>
        <li>
          <svg width="22" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="21" y2="5" style={{ stroke: C.trend }} strokeWidth="3.5" strokeLinecap="round" />
          </svg>
          Trend (7-day average)
        </li>
        <li>
          <svg width="22" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="21" y2="5" stroke={C.path} strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
          </svg>
          The path
        </li>
        <li>
          <svg width="22" height="10" aria-hidden="true">
            <rect width="22" height="10" rx="3" fill="rgba(15,143,138,0.22)" />
          </svg>
          On track (path ±{fmt(band)} {unit})
        </li>
        <li>
          <svg width="22" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="21" y2="5" stroke={C.proj} strokeWidth="2.5" strokeDasharray="5 4" />
          </svg>
          Where you're heading
        </li>
      </ul>
      <span className="xsmall muted">
        Drag to move · pinch or double-tap to zoom · tap a day
        {(zoomed || rangeId !== 'all') && (
          <>
            {' · '}
            <button className="link-btn xsmall" style={{ minHeight: 0 }} onClick={() => (rangeId === 'all' ? setWin(full) : onRange('all'))}>
              Show all
            </button>
          </>
        )}
      </span>
    </div>
  );
}
