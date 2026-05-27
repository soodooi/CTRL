// useTheme — React wrapper around `lib/theme.ts`. Reads the stored
// preference once at mount, applies it, re-applies whenever the OS
// `prefers-color-scheme` flips while preference = 'system'.

import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  getStoredTheme,
  setTheme as persistTheme,
  watchSystemTheme,
  type ThemePreference,
} from '@/lib/theme';

interface UseTheme {
  theme: ThemePreference;
  setTheme: (next: ThemePreference) => void;
}

export const useTheme = (): UseTheme => {
  const [theme, setLocalTheme] = useState<ThemePreference>(() =>
    getStoredTheme(),
  );

  // Apply on mount (covers the case where the boot script in main.tsx
  // hasn't run yet, e.g. SSR / dev HMR remounts) and on every change.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // While preference = 'system', re-evaluate when OS theme flips.
  useEffect(() => {
    if (theme !== 'system') return undefined;
    return watchSystemTheme(() => applyTheme('system'));
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference): void => {
    persistTheme(next);
    setLocalTheme(next);
  }, []);

  return { theme, setTheme };
};
