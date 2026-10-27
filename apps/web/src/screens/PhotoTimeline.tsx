import { useEffect, useMemo, useRef, useState } from 'react';
import { dateIn, daysBetween, shortDate, type Attachment, type Goal, type ISODate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { fmt } from '../data/derive.ts';
import { readingOn } from '../data/connect.ts';
import { BackLink, Empty, Icon } from '../components/ui.tsx';

/**
 * The photo timeline: every progress photo on a goal, oldest to newest, with that day's number
 * under each. Scrub through them, pick two to compare side by side, and save a before/after image.
 * It is the most shareable thing a season produces, and the one that proves the chart.
 */
interface Shot {
  file: Attachment;
  day: ISODate;
  value: number | null;
}

const isImage = (mime: string) => mime.startsWith('image/');

export function photosOnGoal(data: ReturnType<typeof useStore>['data'], goal: Goal): Shot[] {
  const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  return data.attachments
    .filter((a) => isImage(a.mime_type) && ((a.action_id && actionIds.has(a.action_id)) || actionIds.has(sessions.get(a.session_id)?.action_id ?? '')))
    .map((a) => {
      const day = sessions.get(a.session_id)?.date ?? dateIn(data.profile.timezone, a.created_at);
      return { file: a, day, value: readingOn(data, goal.measurement_type_id, day) ?? nearestReading(data, goal.measurement_type_id, day) };
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

export function PhotoTimeline({ goalId }: { goalId: string }) {
  const { data } = useStore();
  const view = useView();
  const goal = view.goal(goalId);
  const shots = useMemo(() => (goal ? photosOnGoal(data, goal) : []), [data, goal]);
  const urls = useUrls(shots.map((s) => s.file.path));
  const [at, setAt] = useState(Math.max(0, shots.length - 1));
  const [compare, setCompare] = useState<number | null>(shots.length > 1 ? 0 : null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => setAt(Math.max(0, shots.length - 1)), [shots.length]);

  if (!goal) return <Empty title="Goal not found." />;
  const unit = goal.unit ?? '';
  const cur = shots[at];
  const cmp = compare != null ? shots[compare] : undefined;
  const label = (s: Shot) => `${shortDate(s.day)}${s.value != null ? ` · ${fmt(s.value)} ${unit}` : ''}`.trim();

  async function saveBeforeAfter() {
    if (!cmp || !cur || !goal) return;
    setSaving(true);
    try {
      const [a, b] = await Promise.all([loadImage(urls[cmp.file.path] ?? ''), loadImage(urls[cur.file.path] ?? '')]);
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
      ctx.fillText(label(cmp), pad, h + pad + 20);
      const right = label(cur);
      ctx.fillText(right, pad + wa + gap + wb - ctx.measureText(right).width, h + pad + 20);
      if (cmp.value != null && cur.value != null) {
        const diff = cur.value - cmp.value;
        const mid = `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} ${unit} · ${daysBetween(cmp.day, cur.day)} days`;
        ctx.fillStyle = '#bbb';
        ctx.font = '500 26px -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.fillText(mid, canvas.width / 2 - ctx.measureText(mid).width / 2, h + pad + 26);
      }
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${goal.title.replace(/[^\w]+/g, '-').toLowerCase()}-${cmp.day}-vs-${cur.day}.jpg`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } finally {
      setSaving(false);
    }
  }

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
      {shots.length > 0 && cur && (
        <>
          <section className="card stack-sm" aria-label="Compare">
            <div className={`photo-compare ${cmp ? 'two' : ''}`}>
              {cmp && (
                <figure>
                  {urls[cmp.file.path] ? <img src={urls[cmp.file.path]} alt={`Photo ${label(cmp)}`} /> : <span className="photo-blank" />}
                  <figcaption>
                    <b>{shortDate(cmp.day)}</b>
                    {cmp.value != null && <span className="num"> {fmt(cmp.value)} {unit}</span>}
                  </figcaption>
                </figure>
              )}
              <figure>
                {urls[cur.file.path] ? <img src={urls[cur.file.path]} alt={`Photo ${label(cur)}`} /> : <span className="photo-blank" />}
                <figcaption>
                  <b>{shortDate(cur.day)}</b>
                  {cur.value != null && <span className="num"> {fmt(cur.value)} {unit}</span>}
                </figcaption>
              </figure>
            </div>
            {cmp && cmp.value != null && cur.value != null && (
              <span className="small" style={{ textAlign: 'center' }}>
                {cur.value - cmp.value > 0 ? '+' : '−'}
                {fmt(Math.abs(cur.value - cmp.value))} {unit} in {daysBetween(cmp.day, cur.day)} days
              </span>
            )}
            <div className="stack-sm" style={{ gap: 4 }}>
              <label className="xsmall muted" htmlFor="photo-scrub">
                Scrub: {label(cur)}
              </label>
              <input id="photo-scrub" type="range" min={0} max={shots.length - 1} value={at} onChange={(e) => setAt(Number(e.target.value))} />
            </div>
            <div className="row-start no-print" style={{ gap: 8, flexWrap: 'wrap' }}>
              {shots.length > 1 && (
                <button className="btn small" onClick={() => setCompare(compare == null ? 0 : null)}>
                  {compare == null ? 'Compare with the first' : 'Hide the comparison'}
                </button>
              )}
              {cmp && (
                <button className="btn small" onClick={() => setCompare(at)} disabled={compare === at}>
                  Use this one as “before”
                </button>
              )}
              {cmp && (
                <button className="btn small primary" onClick={saveBeforeAfter} disabled={saving || !urls[cmp.file.path] || !urls[cur.file.path]}>
                  <Icon name="camera" size={14} /> {saving ? 'Saving…' : 'Save before / after'}
                </button>
              )}
            </div>
          </section>
          <section className="card stack-sm" aria-label="All photos">
            <span className="label">Every photo</span>
            <div className="photo-strip">
              {shots.map((s, i) => (
                <button key={s.file.id} type="button" className={`photo-cell ${i === at ? 'current' : ''} ${i === compare ? 'before' : ''}`} onClick={() => setAt(i)} aria-label={label(s)} aria-pressed={i === at}>
                  {urls[s.file.path] ? <img src={urls[s.file.path]} alt="" loading="lazy" /> : <span className="photo-blank" />}
                  <span className="xsmall">{shortDate(s.day).replace(/^(\w+) /, '$1 ')}</span>
                  {s.value != null && <span className="xsmall muted">{fmt(s.value)}</span>}
                </button>
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
