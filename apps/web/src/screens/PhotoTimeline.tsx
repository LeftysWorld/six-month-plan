import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { addDays, dateIn, daysBetween, isoWeekday, rollingAverage, shortDate, type Attachment, type Goal, type ISODate, type PhotoAlign } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { fmt } from '../data/derive.ts';
import { readingOn } from '../data/connect.ts';
import { boxOf, clampFit, fitTo, NO_FIT, place, type Fit, type Marks } from '../data/photoAlign.ts';
import { findMarks, loadPoseModel } from '../data/poseDetect.ts';
import { BackLink, Empty, Icon, useToast } from '../components/ui.tsx';

/**
 * The photo timeline: every progress photo on a goal, oldest to newest, with that day's number.
 *   Side by side: a before and an after, and how much the 7-day average moved between them.
 *   Timeline: one photo at a time; scrub, step or play through them, with a ghost of the first.
 *   Overlay: the after over the before; drag the white line to wipe between them. Only here are
 *     photos lined up (zoomed and moved so the body sits in the same place), automatically or by hand.
 *   Month by month: the first photo of each month.
 * It is the most shareable thing a season produces, and the one that proves the chart.
 */
interface Shot {
  file: Attachment;
  day: ISODate;
  value: number | null;
  /** The 7-day average on the photo's day. */
  trend: number | null;
}

type Mode = 'side' | 'timeline' | 'overlay' | 'months';
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const isImage = (mime: string) => mime.startsWith('image/');
const fmt1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

export function photosOnGoal(data: ReturnType<typeof useStore>['data'], goal: Goal): Shot[] {
  const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const readings = goal.measurement_type_id ? data.measurements.filter((m) => m.type_id === goal.measurement_type_id).sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1)) : [];
  return data.attachments
    .filter((a) => isImage(a.mime_type) && ((a.action_id && actionIds.has(a.action_id)) || actionIds.has(sessions.get(a.session_id)?.action_id ?? '')))
    .map((a) => {
      const day = sessions.get(a.session_id)?.date ?? dateIn(data.profile.timezone, a.created_at);
      return {
        file: a,
        day,
        value: readingOn(data, goal.measurement_type_id, day) ?? nearestReading(data, goal.measurement_type_id, day),
        trend: readings.length ? rollingAverage(readings.filter((m) => m.measured_on <= day), day) : null,
      };
    })
    .sort((a, b) => (a.day === b.day ? (a.file.created_at < b.file.created_at ? -1 : 1) : a.day < b.day ? -1 : 1));
}

/** The reading closest to a day (within three days), for photos taken on a day without one. */
function nearestReading(data: ReturnType<typeof useStore>['data'], typeId: string | null, day: ISODate): number | null {
  if (!typeId) return null;
  let best: { d: number; v: number } | null = null;
  for (const m of data.measurements) {
    if (m.type_id !== typeId) continue;
    const d = Math.abs(daysBetween(m.measured_on, day));
    if (d <= 3 && (!best || d < best.d)) best = { d, v: Number(m.value) };
  }
  return best?.v ?? null;
}

function useUrls(paths: string[]): Record<string, string> {
  const { db } = useStore();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join('|');
  useEffect(() => {
    let live = true;
    Promise.all(paths.map((p) => db.files.url(p).then((u) => [p, u] as const, () => [p, ''] as const))).then((pairs) => {
      if (live) setUrls(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [db, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return urls;
}

const span = (n: number) => (n < 14 ? `${n} day${n === 1 ? '' : 's'}` : `${Math.round(n / 7)} weeks`);
const weekday = (d: ISODate) => WD[isoWeekday(d) - 1]!;

export function PhotoTimeline({ goalId }: { goalId: string }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const goal = view.goal(goalId);
  const shots = useMemo(() => (goal ? photosOnGoal(data, goal) : []), [data, goal]);
  const urls = useUrls(shots.map((s) => s.file.path));
  const last = shots.length - 1;

  const [mode, setMode] = useState<Mode>('side');
  const [at, setAt] = useState(Math.max(0, last)); // the After photo (the one you scrub)
  const [before, setBefore] = useState(0);
  const [active, setActive] = useState<'before' | 'after'>('after');
  const [playing, setPlaying] = useState(false);
  const [ghost, setGhost] = useState(false);
  const [wipe, setWipe] = useState(50);
  const [strip, setStrip] = useState<'daily' | 'weekly'>('daily');
  const [lined, setLined] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editView, setEditView] = useState<'adjust' | 'first'>('adjust');
  const [guides, setGuides] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Fit>>({}); // unsaved hand fits, by attachment id
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timer = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; w: number; h: number; fit: Fit; id: string } | null>(null);
  const wiping = useRef<{ left: number; w: number; offset: number } | null>(null);

  useEffect(() => {
    setAt(Math.max(0, shots.length - 1));
    setBefore((b) => (b >= shots.length ? 0 : b));
  }, [shots.length]);
  useEffect(() => () => stopPlay(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!goal) return <Empty title="Goal not found." />;
  const unit = goal.unit ?? '';
  const ai = Math.min(at, Math.max(0, last));
  const bi = Math.min(before, Math.max(0, last));
  const A = shots[ai];
  const B = shots[bi];
  const label = (s: Shot) => `${shortDate(s.day)}${s.value != null ? ` · ${fmt(s.value)} ${unit}` : ''}`.trim();

  // ---------- Lining up (Overlay only) ----------
  const overlay = mode === 'overlay';
  const fitOf = (s: Shot | undefined): Fit | null => (s ? drafts[s.file.id] ?? s.file.align?.fit ?? null : null);
  const shownFit = (s: Shot | undefined) => (overlay && lined ? fitOf(s) ?? NO_FIT : NO_FIT);
  const alignedCount = shots.filter((s) => fitOf(s)).length;
  const byHand = shots.filter((s) => drafts[s.file.id] || s.file.align?.fit?.manual).length;
  const saveAlign = (s: Shot, patch: PhotoAlign) => commit([{ kind: 'update', collection: 'attachments', id: s.file.id, patch: { align: { ...(s.file.align ?? {}), ...patch } } }]);

  async function autoAlign() {
    const first = shots[0];
    if (!first) return;
    setBusy('Finding your eyes and hips…');
    setNote('');
    try {
      // Only fetch the model when a photo still needs finding; a load failure is reported as such.
      if (shots.some((s) => !s.file.align?.marks)) await loadPoseModel();
      const marks = new Map<string, Marks>();
      for (const s of shots) {
        const known = s.file.align?.marks;
        if (known) {
          marks.set(s.file.id, known);
          continue;
        }
        const url = urls[s.file.path];
        if (!url) continue;
        const found = await findMarks(url).catch(() => null);
        if (found) {
          marks.set(s.file.id, found);
          saveAlign(s, { marks: found });
        }
      }
      const ref = marks.get(first.file.id);
      if (!ref) {
        setNote(`Couldn’t find you in the first photo (${shortDate(first.day)}), so nothing was lined up. You can still adjust each photo by hand.`);
        return;
      }
      // The first photo stays put (or where you put it); the others meet its eyes and hips.
      const refFit = fitOf(first) ?? NO_FIT;
      const target: Marks = { eyes: place(ref.eyes, refFit), hips: place(ref.hips, refFit) };
      let done = 0;
      const kept: string[] = [];
      const missed: string[] = [];
      for (const s of shots.slice(1)) {
        if (s.file.align?.fit?.manual) {
          kept.push(shortDate(s.day));
          continue;
        }
        const m = marks.get(s.file.id);
        if (!m) {
          missed.push(shortDate(s.day));
          continue;
        }
        saveAlign(s, { marks: m, fit: { ...clampFit(fitTo(target, m)), manual: false } });
        done++;
      }
      setLined(true);
      setNote(
        `Lined up ${done} photo${done === 1 ? '' : 's'} to ${shortDate(first.day)} by your eyes and hips.` +
          (kept.length ? ` Kept your own adjustment${kept.length === 1 ? '' : 's'} on ${kept.join(', ')}.` : '') +
          (missed.length ? ` Couldn’t find you on ${missed.join(', ')}: adjust ${missed.length === 1 ? 'it' : 'them'} by hand.` : ''),
      );
    } catch {
      setNote('Auto-align couldn’t load (it needs a connection the first time). You can still adjust each photo by hand.');
    } finally {
      setBusy('');
    }
  }

  // The photo being adjusted: the After, or the first photo (the one the others line up to).
  const refShot = shots[0];
  const editShot = editView === 'first' ? refShot : A;
  const editFit = (editShot && (drafts[editShot.file.id] ?? editShot.file.align?.fit)) || NO_FIT;
  const setDraft = (s: Shot, f: Fit) => setDrafts((d) => ({ ...d, [s.file.id]: clampFit(f) }));
  const nudge = (dx: number, dy: number, ds: number) => () => editShot && setDraft(editShot, { s: editFit.s + ds, tx: editFit.tx + dx, ty: editFit.ty + dy });
  function finishEdit() {
    for (const s of shots) {
      const d = drafts[s.file.id];
      if (d) saveAlign(s, { fit: { ...d, manual: true } });
    }
    setDrafts({});
    setEditing(false);
    setNote('Saved. Only the Overlay uses it; Side by side and Timeline show your photos as taken.');
  }
  function resetPhoto() {
    if (!editShot) return;
    setDrafts(({ [editShot.file.id]: _gone, ...rest }) => rest);
    if (editShot.file.align?.fit) saveAlign(editShot, { fit: null });
  }
  function resetAll() {
    setDrafts({});
    for (const s of shots) if (s.file.align?.fit) saveAlign(s, { fit: null });
    setNote('');
  }
  // Guides: where the first photo's eyes and hips sit in the frame.
  const refMarks = refShot?.file.align?.marks ?? null;
  const refFit = (refShot && (drafts[refShot.file.id] ?? refShot.file.align?.fit)) || NO_FIT;
  const guideLines = refMarks
    ? [
        { y: place(refMarks.eyes, refFit).y, label: 'Eyes' },
        { y: place(refMarks.hips, refFit).y, label: 'Hips' },
      ]
    : [
        { y: 33.3, label: '' },
        { y: 66.7, label: '' },
      ];

  function onEditDown(e: PointerEvent<HTMLDivElement>) {
    if (!editShot) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, fit: editFit, id: editShot.file.id };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onEditMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const s = d && shots.find((x) => x.file.id === d.id);
    if (!d || !s) return;
    setDraft(s, { s: d.fit.s, tx: d.fit.tx + ((e.clientX - d.x) / d.w) * 100, ty: d.fit.ty + ((e.clientY - d.y) / d.h) * 100 });
  }

  // ---------- The wipe line (Overlay) ----------
  function onWipeDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault(); // no image or text selection while dragging
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    // Grabbed on the line (anywhere up its height): it moves from where you took hold. Elsewhere: it jumps there.
    const near = (Math.abs(x - wipe) / 100) * r.width <= 22;
    wiping.current = { left: r.left, w: r.width, offset: near ? wipe - x : 0 };
    if (!near) setWipe(Math.max(0, Math.min(100, x)));
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onWipeMove(e: PointerEvent<HTMLDivElement>) {
    const w = wiping.current;
    if (w) setWipe(Math.max(0, Math.min(100, ((e.clientX - w.left) / w.w) * 100 + w.offset)));
  }
  function onWipeKey(e: KeyboardEvent<HTMLButtonElement>) {
    const step = e.shiftKey ? 10 : 2;
    const next = e.key === 'ArrowLeft' ? wipe - step : e.key === 'ArrowRight' ? wipe + step : e.key === 'Home' ? 0 : e.key === 'End' ? 100 : null;
    if (next == null) return;
    e.preventDefault();
    setWipe(Math.max(0, Math.min(100, next)));
  }

  // ---------- Playback ----------
  function stopPlay() {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  }
  function play() {
    stopPlay();
    let i = ai >= last ? 0 : ai;
    setAt(i);
    setPlaying(true);
    timer.current = window.setInterval(
      () => {
        i += 1;
        if (i > last) return stopPlay();
        setAt(i);
      },
      shots.length > 30 ? 160 : 650,
    );
  }

  // ---------- Picking photos ----------
  const pick = (i: number) => {
    stopPlay();
    if (mode !== 'timeline' && active === 'before') {
      setBefore(i);
      setActive('after');
    } else setAt(i);
    if (mode === 'months') setMode('side');
  };
  const idxOnOrBefore = (day: ISODate) => shots.reduce((k, s, i) => (s.day <= day ? i : k), 0);
  const totalDays = shots.length > 1 ? daysBetween(shots[0]!.day, shots[last]!.day) : 0;
  const quick = (
    [
      ['First vs latest', 1, null],
      ['Last week', 7, 7],
      ['4 weeks', 28, 28],
      ['12 weeks', 84, 84],
    ] as const
  )
    .filter(([, need]) => totalDays >= need)
    .map(([text, , back]) => ({ text, b: back == null ? 0 : idxOnOrBefore(addDays(shots[last]!.day, -back)) }));

  // ---------- The result, on the 7-day average ----------
  const result =
    B && A && bi !== ai && B.trend != null && A.trend != null
      ? (() => {
          const d = A.trend! - B.trend!;
          const gap = daysBetween(B.day, A.day);
          return {
            head: `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))} ${unit}`.trim(),
            when: `in ${span(gap)} · 7-day average`,
            sub: `Trend ${fmt1(B.trend!)} → ${fmt1(A.trend!)}${B.value != null && A.value != null ? ` · scale those mornings ${fmt1(B.value)} → ${fmt1(A.value)}` : ''}`,
            pace: gap >= 7 ? `About ${fmt(Math.abs(d) / (gap / 7))} ${unit} a week` : '',
            good: d * Math.sign((goal.target_value ?? 0) - (B.trend ?? 0)) >= 0,
          };
        })()
      : null;

  // ---------- The strip, newest week first ----------
  const weeks: { monday: ISODate; items: number[] }[] = [];
  shots.forEach((s, i) => {
    const monday = addDays(s.day, 1 - isoWeekday(s.day));
    const w = weeks.at(-1);
    if (w && w.monday === monday) w.items.push(i);
    else weeks.push({ monday, items: [i] });
  });
  const rows =
    strip === 'weekly'
      ? [{ title: 'One a week · the last photo of each week', items: weeks.map((w) => w.items.at(-1)!) }]
      : [...weeks].reverse().map((w) => {
          const vs = w.items.map((i) => shots[i]!.value).filter((v): v is number => v != null);
          return { title: `Week of ${shortDate(w.monday)}${vs.length ? ` · avg ${fmt1(vs.reduce((a, b) => a + b, 0) / vs.length)}` : ''}`, items: w.items };
        });

  // ---------- Month by month ----------
  const monthIdx: number[] = [];
  shots.forEach((s, i) => {
    const prev = monthIdx.at(-1);
    if (prev == null || shots[prev]!.day.slice(0, 7) !== s.day.slice(0, 7)) monthIdx.push(i);
  });
  if (monthIdx.length && monthIdx.at(-1) !== last) monthIdx.push(last);
  const canMonths = monthIdx.length >= 3;

  async function saveBeforeAfter() {
    if (!B || !A || !goal) return;
    setSaving(true);
    try {
      const [a, b] = await Promise.all([loadImage(urls[B.file.path] ?? ''), loadImage(urls[A.file.path] ?? '')]);
      const h = 1200;
      const wa = Math.round((a.width / a.height) * h);
      const wb = Math.round((b.width / b.height) * h);
      const gap = 24;
      const pad = 40;
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvas.width = wa + wb + gap + pad * 2;
      canvas.height = h + pad * 2 + 90;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(a, pad, pad, wa, h);
      ctx.drawImage(b, pad + wa + gap, pad, wb, h);
      ctx.fillStyle = '#fff';
      ctx.font = '600 34px -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(label(B), pad, h + pad + 20);
      const right = label(A);
      ctx.fillText(right, pad + wa + gap + wb - ctx.measureText(right).width, h + pad + 20);
      if (result) {
        ctx.fillStyle = '#bbb';
        ctx.font = '500 26px -apple-system, Segoe UI, Roboto, sans-serif';
        const mid = `${result.head} · ${span(daysBetween(B.day, A.day))}`;
        ctx.fillText(mid, canvas.width / 2 - ctx.measureText(mid).width / 2, h + pad + 26);
      }
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${goal.title.replace(/[^\w]+/g, '-').toLowerCase()}-${B.day}-vs-${A.day}.jpg`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch {
      toast('Couldn’t make the image. Try again once the photos have loaded.');
    } finally {
      setSaving(false);
    }
  }

  const img = (s: Shot | undefined, fit: Fit | null, extra?: CSSProperties) =>
    s && urls[s.file.path] ? <img src={urls[s.file.path]} alt={`Photo ${label(s)}`} draggable={false} style={{ ...boxOf(fit), ...extra }} /> : null;
  const modes: [Mode, string][] = [
    ['side', 'Side by side'],
    ['timeline', 'Timeline'],
    ['overlay', 'Overlay'],
    ...(canMonths ? ([['months', 'Month by month']] as [Mode, string][]) : []),
  ];
  const slot = (which: 'before' | 'after', s: Shot | undefined) => (
    <button type="button" className={`pt-slot${active === which ? ' on' : ''}`} aria-pressed={active === which} onClick={() => setActive(which)}>
      <span className="pt-thumb">{s && urls[s.file.path] ? <img src={urls[s.file.path]} alt="" draggable={false} /> : null}</span>
      <span className="stack-sm" style={{ gap: 1, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--accent-ink)' }}>{which === 'before' ? 'Before' : 'After'}</span>
        <b className="small">{s ? `${weekday(s.day)} ${shortDate(s.day)}` : '—'}</b>
        <span className="xsmall muted">{s?.trend != null ? `avg ${fmt1(s.trend)} ${unit}` : 'no weigh-in'}</span>
        <span className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{active === which ? 'Tap a photo below to change' : 'Tap to pick'}</span>
      </span>
    </button>
  );

  return (
    <div className="stack rise">
      <BackLink label={goal.title} fallback={`/goals/${goal.id}`} />
      <div className="stack-sm" style={{ gap: 2 }}>
        <h1 style={{ margin: 0 }}>Photos</h1>
        <span className="small muted">
          {goal.title} · {shots.length} photo{shots.length === 1 ? '' : 's'}
          {shots.length > 1 ? ` · ${shortDate(shots[0]!.day)} → ${shortDate(shots.at(-1)!.day)}` : ''}
        </span>
      </div>
      {shots.length === 0 && <Empty title="No photos on this goal yet. Add a progress photo on Today (camera button in Today’s numbers) and they collect here, oldest to newest." />}
      {shots.length > 0 && A && B && (
        <>
          <div className="pt-layout">
            <section className="card stack-sm pt-viewer" aria-label="Photos">
              <div className="seg pt-modes" role="group" aria-label="View">
                {modes.map(([m, text]) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => {
                      stopPlay();
                      setEditing(false);
                      setNote('');
                      setMode(m);
                      if (m === 'timeline') setActive('after');
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>

              {!editing && mode === 'side' && (
                <div className="pt-pair">
                  <div className="pt-frame">
                    {img(B, null)}
                    <span className="pt-tag">Before · {shortDate(B.day)}</span>
                  </div>
                  <div className="pt-frame">
                    {img(A, null)}
                    <span className="pt-tag">After · {shortDate(A.day)}</span>
                  </div>
                </div>
              )}

              {!editing && mode === 'timeline' && (
                <div className="pt-frame pt-one">
                  {img(A, null)}
                  {ghost && ai !== 0 && img(shots[0], null, { opacity: 0.35 })}
                  <span className="pt-tag">
                    {weekday(A.day)} {shortDate(A.day)}
                  </span>
                  {A.value != null && (
                    <span className="pt-tag bottom">
                      {fmt1(A.value)} {unit}
                      {A.trend != null ? ` · avg ${fmt1(A.trend)}` : ''}
                    </span>
                  )}
                </div>
              )}

              {!editing && mode === 'overlay' && (
                <div className="pt-frame pt-one" style={{ touchAction: 'none', cursor: 'ew-resize' }} onPointerDown={onWipeDown} onPointerMove={onWipeMove} onPointerUp={() => (wiping.current = null)} onPointerCancel={() => (wiping.current = null)}>
                  {img(B, shownFit(B))}
                  <div className="pt-clip" style={{ clipPath: `inset(0 0 0 ${wipe}%)` }}>
                    {img(A, shownFit(A))}
                  </div>
                  <span className="pt-wipe" style={{ left: `${wipe}%` }} aria-hidden="true">
                    <span />
                  </span>
                  <button type="button" className="pt-knob" role="slider" aria-label="Before and after divider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(wipe)} aria-valuetext={`${Math.round(100 - wipe)}% after`} style={{ left: `${wipe}%` }} onKeyDown={onWipeKey}>
                    <span aria-hidden="true">
                      <svg width="16" height="10" viewBox="0 0 16 10">
                        <path d="M5 1.5 1.5 5 5 8.5M11 1.5 14.5 5 11 8.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  <span className="pt-tag">Before · {shortDate(B.day)}</span>
                  <span className="pt-tag right">After · {shortDate(A.day)}</span>
                </div>
              )}

              {!editing && mode === 'months' && canMonths && (
                <div className="pt-months">
                  {monthIdx.map((i, k) => {
                    const s = shots[i]!;
                    const p = k ? shots[monthIdx[k - 1]!]! : null;
                    const ch = p && p.trend != null && s.trend != null ? s.trend - p.trend : null;
                    return (
                      <figure key={s.file.id}>
                        <div className="pt-frame">{img(s, null)}</div>
                        <b className="small">{shortDate(s.day)}</b>
                        <span className="xsmall muted">{s.trend != null ? `avg ${fmt1(s.trend)}` : ''}</span>
                        <span className="xsmall" style={{ fontWeight: 650, color: ch == null ? 'var(--muted)' : 'var(--blue-ink)' }}>{ch == null ? 'Start' : `${ch < 0 ? '−' : '+'}${fmt(Math.abs(ch))} ${unit}`}</span>
                      </figure>
                    );
                  })}
                </div>
              )}

              {editing && editShot && (
                <>
                  <div className="pt-frame pt-one" style={{ touchAction: 'none', cursor: 'move' }} onPointerDown={onEditDown} onPointerMove={onEditMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)} aria-label="Drag to move the photo">
                    {img(editShot, editFit)}
                    <span className="pt-center" aria-hidden="true" />
                    {guides &&
                      guideLines.map((g) => (
                        <span key={g.y} className="pt-guide" style={{ top: `${g.y}%` }}>
                          {g.label && <span>{g.label}</span>}
                        </span>
                      ))}
                    <span className="pt-tag" style={editView === 'first' ? { background: 'var(--accent-ink)' } : undefined}>
                      {editView === 'first' ? `Adjusting the first photo: ${shortDate(editShot.day)}` : `Adjusting: ${shortDate(editShot.day)}`}
                    </span>
                  </div>
                  <div className="stack-sm pt-tools">
                    <span className="small" style={{ lineHeight: 1.45 }}>
                      {editView === 'first'
                        ? `Moving the first photo moves the guide lines with it. Put the lines on your eyes and hips here, then switch to ${shortDate(A.day)} and line it up on them.`
                        : 'Drag the photo until your eyes and hips sit on the dashed lines and zoom until your shoulders match, then switch to the first photo to check.'}
                    </span>
                    <label className="pt-zoom">
                      <span className="xsmall muted">Zoom</span>
                      <input type="range" min={50} max={250} value={Math.round(editFit.s * 100)} onChange={(e) => editShot && setDraft(editShot, { ...editFit, s: Number(e.target.value) / 100 })} />
                      <b className="xsmall">{Math.round(editFit.s * 100)}%</b>
                    </label>
                    <div className="row-start" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn small pt-icon" aria-label="Move left" onClick={nudge(-0.5, 0, 0)}>←</button>
                      <button type="button" className="btn small pt-icon" aria-label="Move up" onClick={nudge(0, -0.5, 0)}>↑</button>
                      <button type="button" className="btn small pt-icon" aria-label="Move down" onClick={nudge(0, 0.5, 0)}>↓</button>
                      <button type="button" className="btn small pt-icon" aria-label="Move right" onClick={nudge(0.5, 0, 0)}>→</button>
                      <button type="button" className="btn small pt-icon" aria-label="Zoom out" onClick={nudge(0, 0, -0.02)}>−</button>
                      <button type="button" className="btn small pt-icon" aria-label="Zoom in" onClick={nudge(0, 0, 0.02)}>+</button>
                      <button type="button" className="btn small" aria-pressed={guides} onClick={() => setGuides(!guides)}>
                        Guides
                      </button>
                    </div>
                    <div className="stack-sm" style={{ gap: 4 }}>
                      <span className="xsmall muted">Show and adjust</span>
                      <div className="seg" role="group" aria-label="Show and adjust" style={{ alignSelf: 'flex-start' }}>
                        <button type="button" aria-pressed={editView === 'first'} onClick={() => setEditView('first')}>
                          {shortDate(shots[0]!.day)} · first photo
                        </button>
                        <button type="button" aria-pressed={editView === 'adjust'} onClick={() => setEditView('adjust')}>
                          {shortDate(A.day)} · adjusting
                        </button>
                      </div>
                    </div>
                    <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn primary" style={{ flex: 1 }} onClick={finishEdit}>
                        Done
                      </button>
                      <button type="button" className="btn" onClick={resetPhoto}>
                        Reset this photo
                      </button>
                    </div>
                  </div>
                </>
              )}

              {!editing && mode !== 'months' && (
                <div className="stack-sm pt-scrub">
                  <div className="row-between" style={{ alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <label className="xsmall muted" htmlFor="photo-scrub">
                      {mode === 'timeline' ? 'Scrub through every photo' : 'Scrub the After photo'}
                    </label>
                    <b className="small">
                      {weekday(A.day)} {label(A)}
                    </b>
                  </div>
                  <input
                    id="photo-scrub"
                    type="range"
                    min={0}
                    max={last}
                    value={ai}
                    onChange={(e) => {
                      stopPlay();
                      setAt(Number(e.target.value));
                    }}
                  />
                  <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn small pt-icon" aria-label="Previous photo" onClick={() => (stopPlay(), setAt(Math.max(0, ai - 1)))}>
                      ‹
                    </button>
                    {playing ? (
                      <button type="button" className="btn small" onClick={stopPlay}>
                        Pause
                      </button>
                    ) : (
                      <button type="button" className="btn small" onClick={play} disabled={shots.length < 2}>
                        ▶ Play
                      </button>
                    )}
                    <button type="button" className="btn small pt-icon" aria-label="Next photo" onClick={() => (stopPlay(), setAt(Math.min(last, ai + 1)))}>
                      ›
                    </button>
                    {mode === 'timeline' && (
                      <button type="button" className="btn small" aria-pressed={ghost} onClick={() => setGhost(!ghost)} style={{ marginLeft: 'auto' }}>
                        Ghost of the first photo
                      </button>
                    )}
                  </div>
                  {mode === 'overlay' && <span className="xsmall muted">Drag the white line on the photo to wipe between before and after.</span>}
                </div>
              )}
            </section>

            <aside className="card stack-sm pt-side" aria-label="Before and after">
              {result && (
                <div className="stack-sm" style={{ gap: 2 }}>
                  <div className="row-start" style={{ alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <b className="pt-result num" style={{ color: result.good ? 'var(--blue-ink)' : 'var(--amber-ink)' }}>
                      {result.head}
                    </b>
                    <span className="small" style={{ fontWeight: 600 }}>
                      {result.when}
                    </span>
                  </div>
                  <span className="xsmall muted">{result.sub}</span>
                  {result.pace && <span className="xsmall muted">{result.pace}</span>}
                </div>
              )}
              {!result && bi !== ai && mode !== 'timeline' && <span className="small muted">No weigh-ins around these days, so no change to show.</span>}
              {bi === ai && mode !== 'timeline' && <span className="small muted">Before and after are the same photo. Pick another one below.</span>}

              {mode !== 'timeline' && (
                <div className="stack-sm" style={{ gap: 6 }}>
                  <div className="pt-slots">
                    {slot('before', B)}
                    {slot('after', A)}
                  </div>
                  <button
                    type="button"
                    className="link-btn xsmall"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => {
                      setBefore(ai);
                      setAt(bi);
                    }}
                  >
                    Swap before and after
                  </button>
                </div>
              )}

              {overlay && (
                <div className="pt-lineup">
                  <div className="row-between" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b className="small">Line up for the overlay</b>
                    <span className="pt-chip" style={alignedCount ? { background: 'var(--blue-soft)', color: 'var(--blue-ink)' } : { background: 'var(--amber-soft)', color: 'var(--amber-ink)' }}>
                      {alignedCount ? `Lined up ${alignedCount} of ${shots.length}${byHand ? ` · ${byHand} by hand` : ''}` : 'Not lined up yet'}
                    </span>
                  </div>
                  {alignedCount === 0 ? (
                    <span className="small" style={{ lineHeight: 1.45, color: 'var(--ink-2)' }}>
                      Your distance from the mirror and the angle change from day to day, so the photos don’t sit on top of each other. Lining up is only used here in the overlay; Side by side and Timeline always show your photos as taken.
                    </span>
                  ) : (
                    <div className="seg" role="group" aria-label="Show photos" style={{ alignSelf: 'flex-start' }}>
                      <button type="button" aria-pressed={!lined} onClick={() => (setLined(false), setEditing(false))}>
                        Original
                      </button>
                      <button type="button" aria-pressed={lined} onClick={() => setLined(true)}>
                        Lined up
                      </button>
                    </div>
                  )}
                  {busy && <span className="xsmall muted">{busy}</span>}
                  {note && <span className="xsmall" style={{ color: 'var(--blue-ink)', lineHeight: 1.45 }}>{note}</span>}
                  <div className="row-start" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn small primary" onClick={autoAlign} disabled={!!busy || shots.length < 2}>
                      Auto-align all
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        stopPlay();
                        setLined(true);
                        setEditView('adjust');
                        setEditing(true);
                      }}
                    >
                      Adjust {shortDate(A.day)}
                    </button>
                    {alignedCount > 0 && (
                      <button type="button" className="link-btn xsmall" onClick={resetAll}>
                        Reset all
                      </button>
                    )}
                  </div>
                </div>
              )}

              {quick.length > 0 && (
                <div className="stack-sm" style={{ gap: 6 }}>
                  <span className="xsmall muted">Quick picks</span>
                  <div className="row-start" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {quick.map((q) => (
                      <button
                        key={q.text}
                        type="button"
                        className="btn small"
                        aria-pressed={bi === q.b && ai === last && mode !== 'timeline' && mode !== 'months'}
                        onClick={() => {
                          stopPlay();
                          setBefore(q.b);
                          setAt(last);
                          if (mode === 'timeline' || mode === 'months') setMode('side');
                        }}
                      >
                        {q.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button className="btn primary no-print" onClick={saveBeforeAfter} disabled={saving || bi === ai || !urls[B.file.path] || !urls[A.file.path]}>
                <Icon name="camera" size={14} /> {saving ? 'Saving…' : 'Save before / after'}
              </button>
            </aside>
          </div>

          <section className="card stack-sm" aria-label="Every photo">
            <div className="row-between" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="label">Every photo</span>
              <div className="seg" role="group" aria-label="Show">
                <button type="button" aria-pressed={strip === 'daily'} onClick={() => setStrip('daily')}>
                  By week
                </button>
                <button type="button" aria-pressed={strip === 'weekly'} onClick={() => setStrip('weekly')}>
                  One a week
                </button>
              </div>
            </div>
            <span className="xsmall muted">
              Tap a photo to show it, or to fill the highlighted slot when comparing. Newest week first.
              {overlay ? ' In Overlay, a teal dot means lined up automatically and a purple dot means adjusted by you.' : ''}
            </span>
            <div className="pt-rows">
              {rows.map((r) => (
                <div key={r.title} className="stack-sm" style={{ gap: 4 }}>
                  <span className="xsmall" style={{ fontWeight: 600 }}>{r.title}</span>
                  <div className="pt-grid">
                    {r.items.map((i) => {
                      const s = shots[i]!;
                      const isA = i === ai;
                      const isB = i === bi && mode !== 'timeline';
                      const f = s.file.align?.fit;
                      const dot = !overlay ? null : drafts[s.file.id] || f?.manual ? 'var(--accent-ink)' : f ? 'var(--blue)' : null;
                      return (
                        <button key={s.file.id} type="button" className={`pt-cell${isA ? ' after' : isB ? ' before' : ''}`} onClick={() => pick(i)} aria-label={`${weekday(s.day)} ${label(s)}${isB ? ', before' : ''}${isA ? ', after' : ''}`} aria-pressed={isA || isB}>
                          <span className="pt-thumb">{urls[s.file.path] ? <img src={urls[s.file.path]} alt="" loading="lazy" draggable={false} /> : null}</span>
                          {(isA || isB) && <span className={`pt-badge${isA ? '' : ' b'}`}>{isA && isB ? 'B·A' : isA ? (mode === 'timeline' ? 'Now' : 'After') : 'Before'}</span>}
                          <span className="xsmall pt-cell-day">
                            {dot && <i style={{ background: dot }} />}
                            {strip === 'weekly' ? shortDate(s.day) : `${weekday(s.day).charAt(0)} ${s.day.slice(8).replace(/^0/, '')}`}
                          </span>
                          {s.value != null && <span className="xsmall muted">{fmt1(s.value)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}
