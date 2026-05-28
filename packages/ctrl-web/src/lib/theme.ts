// theme — Light / Dark / System preference persisted in localStorage.
//
// Per bao 2026-05-25 ("try a bright color") + 2026-05-26 ("change it to a white theme"):
// light is the product default. Dark is opt-in via `[data-theme='dark']`
// on the root element. System lets the OS preference decide.
//
// This module owns the single source of truth for the active theme. The
// `applyTheme` side effect runs once at boot (from main.tsx) and again
// whenever `setTheme` is called from Settings. No React state lives
// here — the hook in `hooks/useTheme.ts` wraps the same key.

const STORAGE_KEY = 'ctrl.theme';
const DARK_ATTR = 'dark';

export type ThemePreference = 'light' | 'dark' | 'system';

const isValid = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

export const getStoredTheme = (): ThemePreference => {
  if (typeof window === 'undefined') return 'light';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isValid(raw) ? raw : 'light';
  } catch {
    return 'light';
  }
};

const resolveEffective = (pref: ThemePreference): 'light' | 'dark' => {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
};

export const applyTheme = (pref: ThemePreference): void => {
  if (typeof document === 'undefined') return;
  const effective = resolveEffective(pref);
  const root = document.documentElement;
  if (effective === 'dark') {
    root.setAttribute('data-theme', DARK_ATTR);
  } else {
    root.removeAttribute('data-theme');
  }
};

export const setTheme = (pref: ThemePreference): void => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // localStorage disabled / quota — non-fatal, theme stays in-memory only.
    }
  }
  applyTheme(pref);
};

/** Subscribe to OS preference changes — call once at boot. The returned
 *  unsubscribe is provided for symmetry but boot-time subscription
 *  lives for the app's lifetime. */
export const watchSystemTheme = (onChange: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (): void => onChange();
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
};
