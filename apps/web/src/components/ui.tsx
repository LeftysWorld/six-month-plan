import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { PACE_TEXT, type PaceLabel, type Progress } from '@six/core';
import { createPortal } from 'react-dom';
import { fmt } from '../data/derive.ts';
import { goBack } from '../router.ts';

// ---------- Icons (inline stroke SVG, inherit currentColor) ----------

const paths: Record<string, ReactNode> = {
  home: <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </>
  ),
  plans: (
    <>
      <path d="M12 3.5l8.5 4.7L12 13 3.5 8.2z" />
      <path d="M3.5 12.6L12 17.4l8.5-4.8" />
    </>
  ),
  review: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M8.5 13.5l2.5 2.5 4.5-5" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  gift: (
    <>
      <path d="M4 12h16v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M3 8h18v4H3zM12 8v13" />
      <path d="M12 8c-1.5-3-3.5-4-5-3s-.5 3 5 3M12 8c1.5-3 3.5-4 5-3s.5 3-5 3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  camera: (
    <>
      <path d="M4 8h3.2l1.8-2.5h6l1.8 2.5H20v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12l5 5 9-10" />,
  minus: <path d="M6 12h12" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  alert: <path d="M12 7v6M12 17h.01" />,
  sync: <path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4" />,
  roadmap: (
    <>
      <path d="M4 6.5h9" />
      <path d="M8 12h11" />
      <path d="M6 17.5h7" />
      <circle cx="16.5" cy="6.5" r="1.6" />
      <circle cx="16.5" cy="17.5" r="1.6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  list: <path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
    </>
  ),
  habit: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4.5V9h-4.5" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
};

export function Icon({ name, size = 20, stroke = 2 }: { name: keyof typeof paths | string; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

// ---------- Pace ----------

export function PacePill({ label, text }: { label: PaceLabel; text?: string }) {
  const icon = label === 'ahead' ? 'up' : label === 'behind' ? 'alert' : label === 'on_track' ? 'check' : null;
  return (
    <span className={`pill ${label}`}>
      {icon && <Icon name={icon} size={12} stroke={3} />}
      {text ?? PACE_TEXT[label]}
    </span>
  );
}

/** A bar showing actual vs planned, with a tick where you should be by now. */
export function PaceBar({ progress }: { progress: Progress }) {
  const total = Math.max(progress.planned, 1);
  const fill = Math.min(100, (progress.actual / total) * 100);
  const tick = Math.min(100, (progress.expected / total) * 100);
  return (
    <div className="bar" role="img" aria-label={`${fmt(progress.actual)} done of ${progress.planned}; ${fmt(progress.expected)} expected by now`}>
      <div className={`fill ${progress.label === 'behind' ? 'behind' : ''}`} style={{ width: `${fill}%` }} />
      <div className="tick" style={{ left: `calc(${tick}% - 1px)` }} />
    </div>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <div className="fill" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  );
}

// ---------- Page bits ----------

export function BackLink({ label, fallback }: { label: string; fallback: string }) {
  return (
    <button type="button" className="back" onClick={() => goBack(fallback)}>
      <Icon name="back" />
      {label}
    </button>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <h3 style={{ marginBottom: 6, color: 'var(--ink)' }}>{title}</h3>
      {children}
    </div>
  );
}

// ---------- Sheet (accessible modal) ----------

let pageLocks = 0;
let lockedScrollY = 0;

/**
 * Hold the page still while a sheet is open, so only the sheet scrolls. iPhone Safari (and the
 * home-screen app) ignores overflow: hidden on the body for touch scrolling, so the body is pinned
 * in place with position: fixed at the current scroll offset and put back where it was on close.
 * Counted, so a sheet opened over another sheet keeps the page locked until the last one closes.
 */
function lockPageScroll(): () => void {
  if (pageLocks === 0) {
    lockedScrollY = window.scrollY;
    const body = document.body.style;
    body.position = 'fixed';
    body.top = `-${lockedScrollY}px`;
    body.left = '0';
    body.right = '0';
    body.width = '100%';
    body.overflow = 'hidden';
  }
  pageLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pageLocks -= 1;
    if (pageLocks > 0) return;
    const body = document.body.style;
    body.position = '';
    body.top = '';
    body.left = '';
    body.right = '';
    body.width = '';
    body.overflow = '';
    window.scrollTo(0, lockedScrollY);
  };
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, so the effect below runs once per sheet and never re-focuses mid-typing.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    const focusable = () =>
      [...(el?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])].filter(
        (x) => x.offsetParent !== null,
      );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      // Keep Tab inside the sheet.
      if (e.key === 'Tab' && el) {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // Only the sheet scrolls while it's open; the page behind it stays where it was.
    const unlock = lockPageScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      unlock();
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  // Render at the top of the page: a card with backdrop-filter traps fixed children inside its own layer.
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="grabber" />
        <div className="row-between">
          <h2>{title}</h2>
          <button type="button" className="link-btn" aria-label="Close" onClick={onClose} style={{ width: 44, height: 44, color: 'var(--muted)' }}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toast with Undo ----------

interface ToastState {
  message: string;
  undo?: () => void;
}

const ToastContext = createContext<(message: string, undo?: () => void) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((message: string, undo?: () => void) => {
    setToast({ message, undo });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------- Small form helpers ----------

export function NumberInput({
  value,
  onChange,
  label,
  step = 'any',
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        inputMode="decimal"
        type="number"
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  );
}

export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Goal colours: clear on graphite and on white, no yellow or lime.
export const GOAL_COLORS = ['#5B8CFF', '#22B07D', '#FF7A45', '#E8559B', '#8B6CF6', '#3FB6C9'];

export const OBSTACLES = ['Time', 'Energy', 'Schedule', 'Unclear task'];
