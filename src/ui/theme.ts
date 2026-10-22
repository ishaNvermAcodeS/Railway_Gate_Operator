import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'hex86.theme';

/** Stored preference, else the OS preference, else dark (index.html applies the same rule before first paint). */
function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch {
    /* storage unavailable */
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useThemeState() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = useCallback(
    () =>
      setTheme((t) => {
        const next = t === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          /* storage unavailable: the theme still switches for this visit */
        }
        return next;
      }),
    [],
  );
  return { theme, toggle };
}

export const ThemeContext = createContext<{ theme: Theme; toggle(): void }>({ theme: 'dark', toggle: () => {} });

export const useTheme = () => useContext(ThemeContext);
