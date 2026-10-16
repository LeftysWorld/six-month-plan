import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { PACE_TEXT, type PaceLabel, type Progress } from '@six/core';
import { fmt } from '../data/derive.ts';
import { goBack } from '../router.ts';

// ---------- Icons (inline stroke SVG, inherit currentColor) ----------

const paths: Record<string, ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  plans: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  review: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M8 14l3 3 5-6" />
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

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [onClose]);
  return (
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
    </div>
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

export const GOAL_COLORS = ['#2B63A6', '#0E6B61', '#B04A1E', '#A0336A', '#6A4AA0', '#7A6416'];

export const OBSTACLES = ['Time', 'Energy', 'Schedule', 'Unclear task'];
