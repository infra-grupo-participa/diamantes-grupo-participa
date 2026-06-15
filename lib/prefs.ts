// Helpers de preferências (tema, fuso, idioma) — SSR-safe e SEM React.
//
// IMPORTANTE: este módulo NÃO tem 'use client'. Ele é importado por código que
// roda no servidor (ex.: lib/format.ts usado em Server Components). Por isso os
// helpers do PrefsProvider (lib/theme.tsx) vivem aqui — chamar uma função
// exportada de um módulo 'use client' durante o render do servidor estoura.

export type ThemePref = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'diamantes.theme';
export const TZ_KEY = 'diamantes.timezone';
export const LOCALE_KEY = 'diamantes.locale';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_LOCALE = 'pt-BR';

// Espelho em memória + localStorage. SSR-safe (no servidor usa só o espelho).
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

export function persistTimezone(tz: string) {
  memTimezone = tz || DEFAULT_TIMEZONE;
  try {
    window.localStorage.setItem(TZ_KEY, memTimezone);
  } catch {
    /* ignore */
  }
}

export function persistLocale(locale: string) {
  memLocale = locale || DEFAULT_LOCALE;
  try {
    window.localStorage.setItem(LOCALE_KEY, memLocale);
  } catch {
    /* ignore */
  }
}

// ── Tema ───────────────────────────────────────────────────────
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

export function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function readStoredTheme(): ThemePref {
  if (typeof window === 'undefined') return 'light';
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}
