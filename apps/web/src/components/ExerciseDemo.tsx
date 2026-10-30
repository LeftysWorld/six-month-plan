import { useEffect, useMemo, useRef, useState } from 'react';
import { bestMatch, cleanLink, linkKind, matchExercises, youtubeId, youtubeStart, type ExerciseDemo, type LibraryExercise } from '@six/core';
import { useStore } from '../data/store.tsx';
import { libraryImage, loadLibrary, opsSetDemo, savedDemo, type DemoKind } from '../data/demos.ts';
import { shrinkImage } from './Attachments.tsx';
import { Icon, Sheet, useToast } from './ui.tsx';

/**
 * "See how": what an exercise or a stretch looks like, without leaving the app. Opens a sheet with
 * the exercise's video or photos: the one you chose, else the closest match in the exercise library
 * (two photos played as a loop, with the steps), else ways to add one (a video link that plays here,
 * or your own photo or video).
 */

/** The button on an exercise or a hold. Saves to every task with the same exercise unless `onSave` is given (the plan editors). */
export function DemoButton({ name, kind, demo, onSave, compact = false }: { name: string; kind: DemoKind; demo?: ExerciseDemo | null; onSave?: (d: ExerciseDemo | null) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!name.trim()) return null;
  return (
    <>
      <button type="button" className={compact ? 'icon-btn demo-btn-compact' : 'demo-btn'} onClick={() => setOpen(true)} aria-label={`See how to do ${name}`} title="See how it's done">
        <Icon name="play" size={compact ? 15 : 14} stroke={2.2} />
        {!compact && <span>See how</span>}
      </button>
      {open && <DemoSheet name={name} kind={kind} demo={demo ?? null} onSave={onSave} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The library, once it's loaded: null while loading, an error message if it couldn't load. */
function useLibrary(): { library: LibraryExercise[] | null; error: string | null } {
  const [state, setState] = useState<{ library: LibraryExercise[] | null; error: string | null }>({ library: null, error: null });
  useEffect(() => {
    let live = true;
    loadLibrary().then(
      (library) => live && setState({ library, error: null }),
      (e: Error) => live && setState({ library: null, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

type Mode = 'view' | 'pick' | 'link';

export function DemoSheet({ name, kind, demo: given, onSave, onClose }: { name: string; kind: DemoKind; demo: ExerciseDemo | null; onSave?: (d: ExerciseDemo | null) => void; onClose: () => void }) {
  const { data, commit, db } = useStore();
  const toast = useToast();
  const { library, error } = useLibrary();
  const [demo, setDemo] = useState<ExerciseDemo | null>(given ?? (onSave ? null : savedDemo(data, name, kind)));
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const auto = useMemo(() => (library && !demo ? bestMatch(name, library, kind) : null), [library, demo, name, kind]);
  const chosen = demo?.kind === 'library' && library ? library.find((x) => x.id === demo.id) ?? null : null;
  const shown: LibraryExercise | null = chosen ?? auto?.exercise ?? null;

  function save(next: ExerciseDemo | null, message: string) {
    setDemo(next);
    setMode('view');
    if (onSave) onSave(next);
    else commit(opsSetDemo(data, name, kind, next));
    toast(message);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!/^(image|video)\//.test(file.type)) return toast('Pick a photo or a video.');
    setBusy(true);
    try {
      const { blob, name: fileName, type } = await shrinkImage(file);
      if (blob.size > 50 * 1024 * 1024) throw new Error('it is over 50 MB');
      const path = await db.files.upload(crypto.randomUUID(), fileName, blob.type ? blob : new Blob([blob], { type }));
      save({ kind: 'file', path, mime: type || file.type, name: fileName }, 'Your photo or video is saved for this one');
    } catch (e) {
      toast(`Couldn't add it: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={name} onClose={onClose}>
      <div className="stack demo-sheet">
        {mode === 'view' && (
          <>
            {demo?.kind === 'video' && <LinkMedia url={demo.url} title={name} />}
            {demo?.kind === 'file' && <FileMedia path={demo.path} mime={demo.mime} title={name} />}
            {(!demo || demo.kind === 'library') && (
              <>
                {!library && !error && <div className="demo-frame demo-loading">Loading…</div>}
                {error && <span className="small" style={{ color: 'var(--amber-ink)' }}>{error}. Check your connection and try again.</span>}
                {library && shown && (
                  <>
                    {!chosen && auto && !auto.confident && (
                      <div className="banner info demo-confirm">
                        <span>
                          Closest in the library: <b>{shown.name}</b>. Is this it?
                        </span>
                        <span className="row-start" style={{ gap: 6 }}>
                          <button type="button" className="btn small primary" onClick={() => save({ kind: 'library', id: shown.id }, `Using ${shown.name}`)}>
                            Yes
                          </button>
                          <button type="button" className="btn small" onClick={() => setMode('pick')}>
                            Pick another
                          </button>
                        </span>
                      </div>
                    )}
                    <LibraryMedia exercise={shown} />
                  </>
                )}
                {library && !shown && (
                  <div className="demo-empty">
                    <b>No picture for this one yet.</b>
                    <span className="small muted">The library doesn't have “{name}”. Add a video link (it plays here) or your own photo or video, once, and it shows every time.</span>
                  </div>
                )}
              </>
            )}
            <div className="demo-actions">
              <span className="label">{demo ? 'Change what shows' : 'Not right? Show something else'}</span>
              <div className="row-start" style={{ gap: 8 }}>
                <button type="button" className="btn small" onClick={() => setMode('pick')} disabled={!library}>
                  Pick from the library
                </button>
                <button type="button" className="btn small" onClick={() => setMode('link')}>
                  Add a video link
                </button>
                <button type="button" className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? 'Uploading…' : 'Use my own photo or video'}
                </button>
                {demo && (
                  <button type="button" className="link-btn small" onClick={() => save(null, 'Back to the library match')}>
                    Reset
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
            </div>
          </>
        )}
        {mode === 'pick' && library && <LibraryPicker name={name} kind={kind} library={library} onPick={(x) => save({ kind: 'library', id: x.id }, `Using ${x.name}`)} onBack={() => setMode('view')} />}
        {mode === 'link' && <LinkForm name={name} onSave={(url) => save({ kind: 'video', url }, 'Video saved for this one')} onBack={() => setMode('view')} />}
      </div>
    </Sheet>
  );
}

/** A library exercise: its two photos played as a loop (start and end of the movement), with the steps. */
function LibraryMedia({ exercise }: { exercise: LibraryExercise }) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frames = exercise.images.slice(0, 2);
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = window.setInterval(() => setFrame((f) => (f + 1) % frames.length), 1100);
    return () => window.clearInterval(t);
  }, [playing, frames.length]);
  return (
    <div className="stack-sm">
      <button type="button" className="demo-frame" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Tap to pause' : 'Tap to play'}>
        {frames.map((src, i) => (
          <img key={src} src={libraryImage(src)} alt={`${exercise.name}, ${i === 0 ? 'start' : 'end'} position`} style={{ opacity: i === frame ? 1 : 0 }} loading="eager" />
        ))}
        <span className="demo-frame-tag">{frames.length > 1 ? (frame === 0 ? 'Start' : 'End') : ''}</span>
        {!playing && (
          <span className="demo-frame-play" aria-hidden="true">
            <Icon name="play" size={22} />
          </span>
        )}
      </button>
      <span className="row-between xsmall muted" style={{ flexWrap: 'wrap' }}>
        <span>
          {exercise.name}
          {exercise.equipment && exercise.equipment !== 'other' ? ` · ${exercise.equipment}` : ''}
          {exercise.muscles.length ? ` · ${exercise.muscles.join(', ')}` : ''}
        </span>
        <span>Photos: free-exercise-db (public domain)</span>
      </span>
      {exercise.instructions.length > 0 && (
        <details className="stretch-how" open>
          <summary className="small">Steps</summary>
          <ol className="small demo-steps">
            {exercise.instructions.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** A saved link: a YouTube video plays in place; a video or picture file shows in place; anything else opens in a new tab. */
function LinkMedia({ url, title }: { url: string; title: string }) {
  const kind = linkKind(url);
  if (kind === 'youtube') {
    const id = youtubeId(url)!;
    const start = youtubeStart(url);
    const vertical = /\/shorts\//.test(url);
    return (
      <div className={`demo-video${vertical ? ' vertical' : ''}`}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&modestbranding=1${start ? `&start=${start}` : ''}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }
  if (kind === 'video') return <video className="demo-media" src={url} controls playsInline loop muted autoPlay />;
  if (kind === 'image') return <img className="demo-media" src={url} alt={title} />;
  return (
    <div className="demo-empty">
      <b>This link can't play inside the app.</b>
      <a className="btn small" href={url} target="_blank" rel="noreferrer">
        Open it
      </a>
      <span className="xsmall muted">YouTube links, video files and pictures play here. For others, a YouTube link of the same move works best.</span>
    </div>
  );
}

/** Your own photo or video, from your private file storage. */
function FileMedia({ path, mime, title }: { path: string; mime: string; title: string }) {
  const { db } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    db.files.url(path).then(
      (u) => live && setUrl(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [db, path]);
  if (failed) return <span className="small" style={{ color: 'var(--amber-ink)' }}>Couldn't open your file. Check your connection, or add it again.</span>;
  if (!url) return <div className="demo-frame demo-loading">Loading…</div>;
  return mime.startsWith('video/') ? <video className="demo-media" src={url} controls playsInline loop muted autoPlay /> : <img className="demo-media" src={url} alt={title} />;
}

function LibraryPicker({ name, kind, library, onPick, onBack }: { name: string; kind: DemoKind; library: LibraryExercise[]; onPick: (x: LibraryExercise) => void; onBack: () => void }) {
  const [q, setQ] = useState(name);
  const [all, setAll] = useState(false);
  const results = useMemo(() => matchExercises(q, library, 12, all ? undefined : kind), [q, library, all, kind]);
  return (
    <div className="stack-sm">
      <button type="button" className="back" onClick={onBack}>
        <Icon name="back" />
        Back
      </button>
      <label className="field">
        Search the library ({library.length} exercises)
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. hamstring stretch" />
      </label>
      <label className="row-start xsmall muted" style={{ gap: 8 }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Include {kind === 'stretch' ? 'strength exercises' : 'stretches'} too
      </label>
      {results.length === 0 && <span className="small muted">Nothing close. Try another word, or add a video link instead.</span>}
      <div className="demo-results">
        {results.map(({ exercise }) => (
          <button key={exercise.id} type="button" className="demo-result" onClick={() => onPick(exercise)}>
            {exercise.images[0] && <img src={libraryImage(exercise.images[0])} alt="" loading="lazy" />}
            <span className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
              <b className="small">{exercise.name}</b>
              <span className="xsmall muted">{[exercise.equipment, exercise.muscles.join(', ')].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LinkForm({ name, onSave, onBack }: { name: string; onSave: (url: string) => void; onBack: () => void }) {
  const [url, setUrl] = useState('');
  const clean = cleanLink(url);
  const kind = clean ? linkKind(clean) : null;
  return (
    <div className="stack-sm">
      <button type="button" className="back" onClick={onBack}>
        <Icon name="back" />
        Back
      </button>
      <label className="field">
        Video link
        <input autoFocus inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" />
        <span className="xsmall muted" style={{ fontWeight: 400 }}>
          YouTube (including Shorts and a start time) plays right here. So do links to a video file or a picture.
        </span>
      </label>
      {clean && kind && <LinkMedia url={clean} title={name} />}
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <a className="link-btn small" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} how to`)}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center' }}>
          Find one on YouTube ↗
        </a>
        <button type="button" className="btn primary small" disabled={!clean} onClick={() => clean && onSave(clean)}>
          Save the video
        </button>
      </div>
    </div>
  );
}
