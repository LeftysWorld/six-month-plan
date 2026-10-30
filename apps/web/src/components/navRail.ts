import { useEffect, useState } from 'react';

const KEY = 'six.nav.open';

/** Wider than this, the full menu pushes the page; narrower (iPad, small laptops) it floats over it. */
export const NAV_PUSH_MIN = 1200;

function matches(q: string): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : true;
}

/**
 * The side menu: a slim icon rail that expands to the full menu. On big screens the choice is
 * remembered and the page makes room; on iPad-sized screens it opens over the page and closes again.
 */
export function useNavRail() {
  const [wide, setWide] = useState(() => matches(`(min-width: ${NAV_PUSH_MIN}px)`));
  const [remembered, setRemembered] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === 'open';
    } catch {
      return false;
    }
  });
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(`(min-width: ${NAV_PUSH_MIN}px)`);
    const on = () => {
      setWide(m.matches);
      setFloating(false);
    };
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  useEffect(() => {
    if (!floating) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFloating(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [floating]);
  const open = wide ? remembered : floating;
  const toggle = () => {
    if (wide) {
      const next = !remembered;
      setRemembered(next);
      try {
        localStorage.setItem(KEY, next ? 'open' : 'closed');
      } catch {
        // storage blocked: just for now
      }
    } else setFloating((f) => !f);
  };
  return { open, floating: !wide && floating, toggle, close: () => setFloating(false) };
}
