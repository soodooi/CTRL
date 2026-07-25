// useTheme — synchronized React view of the shared theme store.
// Every consumer observes the same persisted preference and effective theme;
// lib/theme.ts owns the single OS appearance listener.

import { useEffect, useState } from 'react';
import {
  getStoredTheme,
  resolveEffectiveTheme,
  setTheme,
  subscribeTheme,
  type ThemePreference,
} from '@/lib/theme';

interface UseTheme {
  theme: ThemePreference;
  effectiveTheme: 'light' | 'dark';
  setTheme: (next: ThemePreference) => void;
}

export const useTheme = (): UseTheme => {
  const initialTheme = getStoredTheme();
  const [theme, setLocalTheme] = useState<ThemePreference>(initialTheme);
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    () => resolveEffectiveTheme(initialTheme),
  );

  useEffect(() => subscribeTheme((next) => {
    setLocalTheme(next);
    setEffectiveTheme(resolveEffectiveTheme(next));
  }), []);

  return { theme, effectiveTheme, setTheme };
};
