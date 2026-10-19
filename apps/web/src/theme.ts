/** Appearance: follow the device, or always dark / always light. Stored per browser. */
export type Theme = 'system' | 'dark' | 'light';

const KEY = 'six.theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme = getTheme()): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
  applyTheme(theme);
}
