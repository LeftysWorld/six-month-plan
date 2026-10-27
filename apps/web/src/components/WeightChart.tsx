import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { addDays, daysBetween, shortDate, valueOnPath, weekdayName, type DateRange, type ISODate, type Measurement, type PathPoint } from '@six/core';
import { fmt } from '../data/derive.ts';
import { lastDaysWindow, panWindow, windowLabel, xTicks, zoomWindow } from './chartZoom.ts';

interface Props {
  start: PathPoint;
  path: PathPoint[];
  readings: Measurement[];
  /** The whole span the chart can show; the zoom window lives inside it. */
  range: DateRange;
  today: ISODate;
  unit: string;
  color?: string;
  /** Extra labelled points, e.g. the 3-month checkpoint and the goal. */
  markers?: { date: ISODate; label: string }[];
  /** Show the 1W / 1M / 3M / All quick ranges above the chart (default on). Pinch, drag and scroll zoom always work. */
  controls?: boolean;
  /** The window to open with: a number of days ending today, or 'all' for the whole range (default). */
  initial?: number | 'all';
}

const W = 340;
const H = 178;
const LEFT = 30;
const RIGHT = 330;
const TOP = 16;
const BOTTOM = 146;

const QUICK: { label: string; days: number | 'all' }[] = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 91 },
  { label: 'All', days: 'all' },
];

/**
 * The weight path: dashed plan line, daily readings, 7-day trend and a "today" marker.
 * Zoomable like a scale app's chart: quick ranges, pinch or scroll to zoom, drag to pan, tap a day for its readout.
 * The y-axis fits whatever is in view, so a week of readings fills the chart instead of sitting on a flat line.
 */
export function WeightChart({ start, path, readings, range, today, unit, color = '#5B8CFF', markers = [], controls = true, initial = 'all' }: Props) {
  const full = useMemo(() => (daysBetween(range.start, range.end) < 1 ? { start: range.start, end: addDays(range.start, 1) } : range), [range.start, range.end]);
  const anchor = readings.length && readings[readings.length - 1]!.measured_on > today ? readings[readings.length - 1]!.measured_on : today;
  const openWith = (d: number | 'all') => (d === 'all' ? full : lastDaysWindow(d, anchor, full));

  const [win, setWin] = useState<DateRange>(() => openWith(initial));
  const [picked, setPicked] = useState<ISODate | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    pointers: Map<number, number>;
    startWin: DateRange;
    startX: number;
    startSpread: number;
    moved: boolean;
  } | null>(null);

  // A new full range (the Progress tabs, another goal) resets the window.
  useEffect(() => {
    setWin(openWith(initial));
    setPicked(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full.start, full.end]);

  const span = Math.max(1, daysBetween(win.start, win.end));
  const x = (d: ISODate) => LEFT + ((RIGHT - LEFT) * daysBetween(win.start, d)) / span;
  /** The ISO date under a client x position, clamped to the window. */
  const dateAtClientX = (clientX: number): ISODate => {
    const el = svgRef.current;
    if (!el) return win.start;
    const box = el.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    const frac = Math.min(1, Math.max(0, (vx - LEFT) / (RIGHT - LEFT)));
    return addDays(win.start, Math.round(frac * span));
  };
  const fracAtClientX = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return 0.5;
    const box = el.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    return Math.min(1, Math.max(0, (vx - LEFT) / (RIGHT - LEFT)));
  };
  const pxPerDay = (RIGHT - LEFT) / span;

  const planAt = (d: ISODate) => valueOnPath(start, path, d);
  const visible = readings.filter((r) => r.measured_on >= win.start && r.measured_on <= win.end);
  const planValues = [planAt(win.start), planAt(win.end), ...path.filter((p) => p.date >= win.start && p.date <= win.end).map((p) => p.value)];
  // Zoomed out, the scale fits the whole plan. Zoomed in (about two months or less), it fits the readings in view,
  // and the plan only widens it when it is close by, so a week of weights fills the chart instead of sitting on a flat line.
  const readingValues = visible.map((r) => Number(r.value));
  const zoomedIn = span <= 62;
  let values = [...planValues, ...readingValues];
  if (zoomedIn && readingValues.length >= 2) {
    const rLo = Math.min(...readingValues);
    const rHi = Math.max(...readingValues);
    const near = Math.max(1.5, (rHi - rLo) * 1.5);
    values = [...readingValues, ...planValues.filter((v) => v >= rLo - near && v <= rHi + near)];
  }
  // When the plan is too far from the readings to share the scale, say where it is instead of drawing it on the edge.
  const planOffScale = values.length > 0 && !planValues.some((v) => v >= Math.min(...values) && v <= Math.max(...values));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max(0.5, (hi - lo) * 0.12);
  lo -= pad;
  hi += pad;
  const y = (v: number) => TOP + ((BOTTOM - TOP) * (hi - v)) / (hi - lo || 1);
  const yClamp = (v: number) => Math.min(BOTTOM + 6, Math.max(TOP - 6, y(v)));

  // Plan line: sample at every path point inside the window plus the window ends.
  const planDates = [win.start, ...path.map((p) => p.date).filter((d) => d > win.start && d < win.end), win.end];
  const planLine = planDates.map((d) => `${x(d).toFixed(1)},${yClamp(planAt(d)).toFixed(1)}`).join(' ');

  // 7-day trend through each reading date (over all readings, so the window edge doesn't bend it).
  const trendAt = (date: ISODate) => {
    const from = addDays(date, -6);
    const window = readings.filter((m) => m.measured_on >= from && m.measured_on <= date);
    if (!window.length) return null;
    return window.reduce((s, m) => s + Number(m.value), 0) / window.length;
  };
  const trend = visible.map((r) => ({ date: r.measured_on, value: trendAt(r.measured_on)! }));
  const trendLine = trend.map((t) => `${x(t.date).toFixed(1)},${y(t.value).toFixed(1)}`).join(' ');
  // Zoomed in, the readings themselves are joined so each day's change shows.
  const showRawLine = zoomedIn;
  const rawLine = visible.map((r) => `${x(r.measured_on).toFixed(1)},${y(Number(r.value)).toFixed(1)}`).join(' ');
  const dotR = span <= 14 ? 3.5 : span <= 45 ? 2.6 : 1.8;
  const latest = visible[visible.length - 1];

  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  const labels = xTicks(win);
  const todayInRange = today >= win.start && today <= win.end;
  const zoomed = win.start !== full.start || win.end !== full.end;

  // The picked day: its reading (if any), trend and plan.
  const pickedReading = picked ? readings.find((r) => r.measured_on === picked) : undefined;
  const pickedTrend = picked ? trendAt(picked) : null;
  const pickedPlan = picked ? planAt(picked) : null;

  const pickNearest = (date: ISODate) => {
    // Snap to the nearest reading within a couple of days; otherwise the day itself.
    let best: Measurement | undefined;
    let bestGap = Infinity;
    for (const r of visible) {
      const gap = Math.abs(daysBetween(date, r.measured_on));
      if (gap < bestGap) {
        best = r;
        bestGap = gap;
      }
    }
    // Zoomed in (a day is wide), snap only to the day itself or its neighbour; zoomed out, within three days.
    setPicked(best && bestGap <= (pxPerDay >= 12 ? 1 : 3) ? best.measured_on : date);
  };

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
      g.startWin = win;
      g.startX = (a + b) / 2;
    } else {
      g.startWin = win;
      g.startX = e.clientX;
    }
    gesture.current = g;
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const el = svgRef.current;
    if (!g || !el || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, e.clientX);
    const box = el.getBoundingClientRect();
    const daysPerPx = daysBetween(g.startWin.start, g.startWin.end) / (box.width * ((RIGHT - LEFT) / W));
    if (g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()] as [number, number];
      const spread = Math.abs(a - b) || 1;
      const factor = spread / g.startSpread;
      const mid = (a + b) / 2;
      const at = Math.min(1, Math.max(0, ((((g.startX - box.left) / box.width) * W - LEFT) / (RIGHT - LEFT))));
      const zoomedWin = zoomWindow(g.startWin, factor, at, full);
      const shift = Math.round(-(mid - g.startX) * daysPerPx * (daysBetween(zoomedWin.start, zoomedWin.end) / daysBetween(g.startWin.start, g.startWin.end)));
      g.moved = true;
      setWin(panWindow(zoomedWin, shift, full));
      return;
    }
    const dx = e.clientX - g.startX;
    if (!g.moved && Math.abs(dx) < 6) return;
    g.moved = true;
    if (!zoomed && daysBetween(full.start, full.end) <= daysBetween(win.start, win.end)) {
      // Nothing to pan: a drag scrubs the readout instead.
      pickNearest(dateAtClientX(e.clientX));
      return;
    }
    setWin(panWindow(g.startWin, Math.round(-dx * daysPerPx), full));
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const wasTap = !g.moved && g.pointers.size === 1;
    g.pointers.delete(e.pointerId);
    if (wasTap) pickNearest(dateAtClientX(e.clientX));
    if (g.pointers.size === 0) gesture.current = null;
    else {
      // One finger left after a pinch: restart the pan from here.
      g.startWin = win;
      g.startX = [...g.pointers.values()][0]!;
      g.moved = true;
    }
  };
  // Scroll with Ctrl/⌘ (or a trackpad pinch) zooms; a horizontal scroll pans. Plain vertical scrolling is left to the page.
  // A native listener, because React's onWheel is passive and can't stop the page from zooming or scrolling.
  const wheelState = useRef({ full, span });
  wheelState.current = { full, span };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      const { full: f, span: s } = wheelState.current;
      const box = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, ((((e.clientX - box.left) / box.width) * W - LEFT) / (RIGHT - LEFT))));
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
  const onDoubleClick = (e: MouseEvent<SVGSVGElement>) => {
    setWin((w) => (daysBetween(w.start, w.end) <= 7 ? full : zoomWindow(w, 2, fracAtClientX(e.clientX), full)));
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = Math.max(1, Math.round(span / 7));
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (picked && e.shiftKey) {
        const prev = [...readings].reverse().find((r) => r.measured_on < picked);
        if (prev) setPicked(prev.measured_on);
      } else setWin((w) => panWindow(w, -step, full));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (picked && e.shiftKey) {
        const next = readings.find((r) => r.measured_on > picked);
        if (next) setPicked(next.measured_on);
      } else setWin((w) => panWindow(w, step, full));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setWin((w) => zoomWindow(w, 1.5, 0.5, full));
    } else if (e.key === '-') {
      e.preventDefault();
      setWin((w) => zoomWindow(w, 1 / 1.5, 0.5, full));
    } else if (e.key === 'Escape') {
      setPicked(null);
    }
  };

  const description = `${unit} over ${shortDate(win.start)} to ${shortDate(win.end)}. Plan ${fmt(planAt(win.start))} to ${fmt(planAt(win.end))}.${
    latest ? ` Latest reading ${fmt(Number(latest.value))} on ${shortDate(latest.measured_on)}.` : ' No readings in view.'
  } Drag to pan, pinch or Ctrl-scroll to zoom, tap a day for its reading.`;

  const activeQuick = QUICK.find((q) => {
    const w = openWith(q.days);
    return w.start === win.start && w.end === win.end;
  });

  return (
    <div className="stack-sm" style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
      {controls && (
        <div className="row-between" style={{ gap: 8 }}>
          <span className="xsmall muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {windowLabel(win)}
          </span>
          <div className="seg" role="tablist" aria-label="Zoom" style={{ padding: 3 }}>
            {QUICK.map((q) => (
              <button
                key={q.label}
                role="tab"
                aria-selected={activeQuick?.label === q.label}
                style={{ minHeight: 30, padding: '0 10px', fontSize: 12.5 }}
                onClick={() => {
                  setWin(openWith(q.days));
                  setPicked(null);
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={description}
        tabIndex={0}
        style={{ display: 'block', touchAction: 'pan-y', cursor: zoomed ? 'grab' : 'crosshair', userSelect: 'none', outline: 'none', borderRadius: 12 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={LEFT} x2={RIGHT} y1={y(t)} y2={y(t)} style={{ stroke: i === 2 ? 'var(--line)' : 'var(--line-2)' }} />
            <text x={0} y={y(t) + 3} fontSize="10" style={{ fill: 'var(--muted)' }}>
              {fmt(t, hi - lo < 4 ? 1 : 0)}
            </text>
          </g>
        ))}
        {span <= 45 &&
          labels
            .filter((l) => l.major)
            .map((l) => <line key={`g${l.date}`} x1={x(l.date)} x2={x(l.date)} y1={TOP} y2={BOTTOM} style={{ stroke: 'var(--line-2)' }} />)}
        {!planOffScale && <polyline points={planLine} fill="none" stroke={color} strokeWidth="2" strokeDasharray="5 4" opacity="0.6" />}
        {planOffScale && (
          <text x={RIGHT} y={planAt(win.end) < lo ? BOTTOM - 4 : TOP + 10} fontSize="10" fontWeight="600" textAnchor="end" style={{ fill: 'var(--blue-ink)' }} opacity="0.8">
            plan {fmt(planAt(win.end))} {planAt(win.end) < lo ? '↓' : '↑'}
          </text>
        )}
        {markers
          .filter((m) => m.date >= win.start && m.date <= win.end && !planOffScale)
          .map((m) => (
            <g key={m.date}>
              <circle cx={x(m.date)} cy={yClamp(planAt(m.date))} r="5" style={{ fill: 'var(--surface)' }} stroke={color} strokeWidth="2" />
              <text
                x={x(m.date) > RIGHT - 70 ? x(m.date) - 6 : x(m.date) + 7}
                y={yClamp(planAt(m.date)) - 7}
                fontSize="10"
                fontWeight="600"
                style={{ fill: 'var(--blue-ink)' }}
                textAnchor={x(m.date) > RIGHT - 70 ? 'end' : 'start'}
              >
                {m.label}
              </text>
            </g>
          ))}
        {showRawLine && visible.length > 1 && <polyline points={rawLine} fill="none" stroke={color} strokeWidth="1.2" opacity="0.45" strokeLinejoin="round" />}
        <g fill={color} opacity={showRawLine ? 0.7 : 0.35}>
          {visible.map((r) => (
            <circle key={r.id} cx={x(r.measured_on)} cy={y(Number(r.value))} r={dotR} />
          ))}
        </g>
        {trend.length > 1 && <polyline points={trendLine} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {todayInRange && (
          <>
            <line x1={x(today)} x2={x(today)} y1={6} y2={BOTTOM + 4} style={{ stroke: 'var(--ink)' }} strokeDasharray="2 3" />
            <text x={x(today) + (x(today) > RIGHT - 40 ? -4 : 4)} y={11} fontSize="10" fontWeight="600" style={{ fill: 'var(--ink)' }} textAnchor={x(today) > RIGHT - 40 ? 'end' : 'start'}>
              Today
            </text>
          </>
        )}
        {latest && !picked && <circle cx={x(latest.measured_on)} cy={y(Number(latest.value))} r="5" fill={color} style={{ stroke: 'var(--surface)' }} strokeWidth="2" />}
        {picked && picked >= win.start && picked <= win.end && (
          <g>
            <line x1={x(picked)} x2={x(picked)} y1={TOP - 4} y2={BOTTOM + 4} style={{ stroke: 'var(--ink)' }} strokeWidth="1" opacity="0.7" />
            {pickedReading && <circle cx={x(picked)} cy={y(Number(pickedReading.value))} r="6" fill={color} style={{ stroke: 'var(--surface)' }} strokeWidth="2.5" />}
            {pickedPlan != null && <circle cx={x(picked)} cy={yClamp(pickedPlan)} r="3.5" style={{ fill: 'var(--surface)' }} stroke={color} strokeWidth="1.5" strokeDasharray="2 2" />}
          </g>
        )}
        {labels.map((l) => (
          <text
            key={l.date}
            x={Math.min(Math.max(x(l.date), LEFT), RIGHT - (span <= 45 ? 0 : 14))}
            y={H - 6}
            fontSize={span <= 14 ? 9.5 : 10}
            fontWeight={l.major ? 600 : 400}
            style={{ fill: l.major ? 'var(--ink)' : 'var(--muted)' }}
            textAnchor="middle"
          >
            {l.label}
          </text>
        ))}
      </svg>
      <div className="row-between small" style={{ minHeight: 22, gap: 8, alignItems: 'baseline' }}>
        {picked ? (
          <>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>
              {picked === today ? 'Today' : `${weekdayName(picked).slice(0, 3)} ${shortDate(picked)}`}
            </span>
            <span className="num" style={{ textAlign: 'right' }}>
              {pickedReading ? `${fmt(Number(pickedReading.value))} ${unit}` : <span className="muted" style={{ fontFamily: 'var(--body)', fontWeight: 400 }}>No reading</span>}
              {pickedTrend != null && pickedPlan != null && (
                <span className="xsmall muted" style={{ fontFamily: 'var(--body)', fontWeight: 400 }}>
                  {' '}
                  · 7-day {fmt(pickedTrend)} · plan {fmt(pickedPlan)} ({pickedTrend - pickedPlan > 0 ? '+' : ''}
                  {fmt(pickedTrend - pickedPlan)})
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="xsmall muted">
            {zoomed ? 'Drag to move · pinch or double-tap to zoom · tap a day' : 'Pinch or double-tap to zoom in · tap a day for its reading'}
            {zoomed && (
              <>
                {' · '}
                <button className="link-btn xsmall" style={{ minHeight: 0 }} onClick={() => setWin(full)}>
                  Show all
                </button>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
