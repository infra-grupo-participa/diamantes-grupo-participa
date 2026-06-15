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

export type ThemePref = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'diamantes.theme';
export const TZ_KEY = 'diamantes.timezone';
export const LOCALE_KEY = 'diamantes.locale';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_LOCALE = 'pt-BR';

// ─────────────────────────────────────────────────────────────
// Helpers globais (legíveis fora do React — ex.: lib/format.ts)
// Mantêm um espelho em memória + localStorage. SSR-safe.
// ─────────────────────────────────────────────────────────────

let memTimezone = DEFAULT_TIMEZONE;
let memLocale = DEFAULT_LOCALE;

export function getUserTimezone(): string {
  if (typeof window === 'undefined') return memTimezone;
  try {
    return window.localStorage.getItem(TZ_KEY) || memTimezone;
  } catch {
    return memTimezone;
  }
}

export function getUserLocale(): string {
  if (typeof window === 'undefined') return memLocale;
  try {
    return window.localStorage.getItem(LOCALE_KEY) || memLocale;
  } catch {
    return memLocale;
  }
}

function persistTimezone(tz: string) {
  memTimezone = tz || DEFAULT_TIMEZONE;
  try {
    window.localStorage.setItem(TZ_KEY, memTimezone);
  } catch {
    /* ignore */
  }
}

function persistLocale(locale: string) {
  memLocale = locale || DEFAULT_LOCALE;
  try {
    window.localStorage.setItem(LOCALE_KEY, memLocale);
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────
// Resolução de tema
// ─────────────────────────────────────────────────────────────

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

function readStoredTheme(): ThemePref {
  if (typeof window === 'undefined') return 'light';
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

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
    memTimezone = tz;
    memLocale = loc;
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
