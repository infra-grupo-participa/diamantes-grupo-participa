'use client';

// PrefsProvider — aplica as preferências do usuário (tema, fuso, idioma) no app.
//
// • Tema: lê 'light' | 'dark' | 'auto', resolve contra prefers-color-scheme
//   quando 'auto', aplica data-theme no <html> e persiste em localStorage
//   (evita flash junto com o script anti-FOUC em app/layout.tsx).
// • Fuso/Idioma: persistidos em localStorage e expostos via contexto + helpers
//   globais (getUserTimezone/getUserLocale) que lib/format.ts lê sem React.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  THEME_KEY,
  DEFAULT_TIMEZONE,
  DEFAULT_LOCALE,
  getUserTimezone,
  getUserLocale,
  persistTimezone,
  persistLocale,
  resolveTheme,
  applyTheme,
  readStoredTheme,
  type ThemePref,
  type ResolvedTheme,
} from '@/lib/prefs';

// Re-exporta os helpers/constantes (compat com importadores antigos de '@/lib/theme').
export {
  THEME_KEY,
  TZ_KEY,
  LOCALE_KEY,
  DEFAULT_TIMEZONE,
  DEFAULT_LOCALE,
  getUserTimezone,
  getUserLocale,
} from '@/lib/prefs';
export type { ThemePref, ResolvedTheme } from '@/lib/prefs';

// ─────────────────────────────────────────────────────────────
// Contexto
// ─────────────────────────────────────────────────────────────

interface PrefsContextValue {
  theme: ThemePref;
  resolvedTheme: ResolvedTheme;
  timezone: string;
  locale: string;
  setTheme: (t: ThemePref) => void;
  setTimezone: (tz: string) => void;
  setLocale: (l: string) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>('light');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const [timezone, setTimezoneState] = useState<string>(DEFAULT_TIMEZONE);
  const [locale, setLocaleState] = useState<string>(DEFAULT_LOCALE);

  // Hidrata do que o script anti-FOUC já aplicou / do localStorage.
  useEffect(() => {
    const t = readStoredTheme();
    setThemeState(t);
    const resolved = resolveTheme(t);
    setResolvedTheme(resolved);
    applyTheme(resolved);

    const tz = getUserTimezone();
    const loc = getUserLocale();
    persistTimezone(tz);
    persistLocale(loc);
    setTimezoneState(tz);
    setLocaleState(loc);
  }, []);

  // Em 'auto', acompanha mudanças do sistema em tempo real.
  useEffect(() => {
    if (theme !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const resolved: ResolvedTheme = mq.matches ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore */
    }
    const resolved = resolveTheme(t);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  const setTimezone = useCallback((tz: string) => {
    const next = tz || DEFAULT_TIMEZONE;
    persistTimezone(next);
    setTimezoneState(next);
  }, []);

  const setLocale = useCallback((l: string) => {
    const next = l || DEFAULT_LOCALE;
    persistLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo<PrefsContextValue>(
    () => ({ theme, resolvedTheme, timezone, locale, setTheme, setTimezone, setLocale }),
    [theme, resolvedTheme, timezone, locale, setTheme, setTimezone, setLocale],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    throw new Error('usePrefs precisa estar dentro de <PrefsProvider>.');
  }
  return ctx;
}

/**
 * Sincroniza as preferências vindas do banco (perfil) com o provider/localStorage.
 * Chamado quando o perfil carrega, para alinhar o que está salvo no Supabase
 * com o que o app aplica localmente. Não dispara writes no banco.
 */
export function syncPrefsFromServer(p: {
  theme?: string;
  timezone?: string;
  language?: string;
}) {
  if (typeof window === 'undefined') return;
  if (p.theme === 'light' || p.theme === 'dark' || p.theme === 'auto') {
    try {
      window.localStorage.setItem(THEME_KEY, p.theme);
    } catch {
      /* ignore */
    }
    applyTheme(resolveTheme(p.theme));
  }
  if (p.timezone) persistTimezone(p.timezone);
  if (p.language) persistLocale(p.language);
}
