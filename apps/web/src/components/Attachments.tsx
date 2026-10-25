import { useEffect, useRef, useState } from 'react';
import { shortDate, type Attachment, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { opsAddAttachment, opsRemoveAttachment } from '../data/ops.ts';
import { Icon, useToast } from './ui.tsx';

/** Supabase's free plan caps one file at 50 MB. */
const MAX_BYTES = 50 * 1024 * 1024;
/** Photos are scaled down to this many pixels on the long side before upload. */
const MAX_SIDE = 2048;

const isImage = (mime: string) => mime.startsWith('image/');

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot > name.length - 7 ? name.slice(dot + 1).toUpperCase() : 'FILE';
}

/**
 * Shrink a phone photo (often 3–8 MB) to a JPEG of at most 2048 px so storage lasts.
 * GIFs, SVGs and anything the browser can't decode are kept as they are.
 */
async function shrinkImage(file: File): Promise<{ blob: Blob; name: string; type: string }> {
  const keep = { blob: file as Blob, name: file.name, type: file.type || 'application/octet-stream' };
  if (!isImage(file.type) || /gif|svg/.test(file.type)) return keep;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return keep;
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg' };
  } catch {
    return keep;
  }
}

/** A short-lived link to a stored file. */
function useFileUrl(path: string): string | null {
  const { db } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    db.files.url(path).then(
      (u) => live && setUrl(u),
      () => live && setUrl(null),
    );
    return () => {
      live = false;
    };
  }, [db, path]);
  return url;
}

/** One attachment: a photo thumbnail, or a tile with the file type. Tap to open it. */
export function FileThumb({ file, caption, onRemove }: { file: Attachment; caption?: string; onRemove?: () => void }) {
  const url = useFileUrl(file.path);
  const image = isImage(file.mime_type);
  return (
    <div className="file-thumb">
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={`file-face ${image ? 'image' : ''}`}
        aria-label={`Open ${file.name}`}
        title={`${file.name} · ${sizeText(file.size_bytes)}`}
        onClick={(e) => !url && e.preventDefault()}
      >
        {image && url ? <img src={url} alt={file.name} loading="lazy" /> : <span className="file-ext">{image ? '…' : extension(file.name)}</span>}
      </a>
      <span className="file-name">{caption ?? file.name}</span>
      {onRemove && (
        <button type="button" className="file-remove" aria-label={`Remove ${file.name}`} onClick={onRemove}>
          <Icon name="x" size={12} stroke={2.6} />
        </button>
      )}
    </div>
  );
}

/**
 * Upload picked files to a session: photos are shrunk first; each file that uploads is recorded
 * right away. Returns how many were added. `uploading` counts files still on their way.
 */
export function useAddFiles() {
  const { db, commit } = useStore();
  const toast = useToast();
  const [uploading, setUploading] = useState(0);
  async function addFiles(session: Session, list: FileList | File[] | null, opts: { quiet?: boolean } = {}): Promise<number> {
    const picked = [...(list ?? [])];
    if (picked.length === 0) return 0;
    setUploading((n) => n + picked.length);
    let added = 0;
    for (const file of picked) {
      try {
        const { blob, name, type } = await shrinkImage(file);
        if (blob.size > MAX_BYTES) throw new Error(`${file.name} is over 50 MB`);
        const id = crypto.randomUUID();
        const path = await db.files.upload(id, name, blob.type ? blob : new Blob([blob], { type }));
        commit(opsAddAttachment(session, { id, path, name, mime_type: type, size_bytes: blob.size }));
        added++;
      } catch (e) {
        toast(`Couldn't add ${file.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (added > 0 && !opts.quiet) toast(added === 1 ? 'File added' : `${added} files added`);
    return added;
  }
  return { addFiles, uploading };
}

/** Photos and files on one task: add from the camera roll, the camera or files; tap to open; × to remove. */
export function SessionFiles({ session, title = 'Photos and files', accept, cta = 'Add a photo or file', hideEmpty = false }: { session: Session; title?: string; accept?: string; cta?: string; hideEmpty?: boolean }) {
  const { data, db, commit } = useStore();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const { addFiles, uploading } = useAddFiles();
  const files = data.attachments.filter((a) => a.session_id === session.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  async function add(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (input.current) input.current.value = '';
    await addFiles(session, picked);
  }

  function remove(file: Attachment) {
    commit(opsRemoveAttachment(file));
    void db.files.remove([file.path]).catch(() => {});
    toast(`Removed ${file.name}`);
  }

  // In the workout log the camera button sits at the top, so an empty photo section isn't shown.
  if (hideEmpty && files.length === 0 && uploading === 0) return null;
  return (
    <div className="stack-sm">
      <div className="xsmall muted">{title}</div>
      {(files.length > 0 || uploading > 0) && (
        <div className="file-grid">
          {files.map((f) => (
            <FileThumb key={f.id} file={f} onRemove={() => remove(f)} />
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <div key={`up-${i}`} className="file-thumb" aria-label="Uploading">
              <div className="file-face uploading">
                <span className="file-ext">…</span>
              </div>
              <span className="file-name">Uploading</span>
            </div>
          ))}
        </div>
      )}
      <input ref={input} type="file" accept={accept} multiple hidden onChange={(e) => void add(e.target.files)} />
      <button type="button" className="btn small" onClick={() => input.current?.click()} disabled={uploading > 0}>
        <Icon name="plus" size={16} stroke={2.2} /> {uploading > 0 ? 'Uploading…' : cta}
      </button>
    </div>
  );
}

/** Every photo and file on a goal's tasks, newest first, labelled with the day it was logged. */
export function GoalFiles({ actionIds }: { actionIds: Set<string> }) {
  const { data } = useStore();
  const [all, setAll] = useState(false);
  const sessions = new Map(data.sessions.map((s) => [s.id, s]));
  const files = data.attachments
    .filter((a) => (a.action_id && actionIds.has(a.action_id)) || actionIds.has(sessions.get(a.session_id)?.action_id ?? ''))
    .map((a) => ({ file: a, day: sessions.get(a.session_id)?.date ?? a.created_at.slice(0, 10) }))
    .sort((a, b) => (a.day === b.day ? (a.file.created_at < b.file.created_at ? 1 : -1) : a.day < b.day ? 1 : -1));
  if (files.length === 0) return null;
  const shown = all ? files : files.slice(0, 9);
  return (
    <div className="card stack-sm">
      <div className="row-between">
        <span className="label">Photos and files</span>
        <span className="small muted">{files.length}</span>
      </div>
      <div className="file-grid">
        {shown.map(({ file, day }) => (
          <FileThumb key={file.id} file={file} caption={shortDate(day)} />
        ))}
      </div>
      {files.length > shown.length && (
        <button className="link-btn small" onClick={() => setAll(true)}>
          Show all {files.length}
        </button>
      )}
    </div>
  );
}
